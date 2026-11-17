// SPDX-FileCopyrightText: 2026 OVH SAS
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Retries of transient API failures. Same rules and limits as the Go SDK.
 *
 * Durations are in milliseconds, like every duration of the SDK.
 *
 * @module
 */

import { ConfigurationError } from "./errors.js";

// Retry limits. They are not options: they protect the API from clients that would retry too
// often or too fast. Client refuses a RetryPolicy outside them.

/** The most attempts a request may make, the first one included. */
export const MAX_RETRY_ATTEMPTS = 3;
/**
 * The shortest wait before a retry, in milliseconds. It applies to the backoff and to a
 * Retry-After header that asks for less.
 */
export const MIN_RETRY_DELAY = 3_000;
/** The longest single wait a policy may allow, in milliseconds. */
export const MAX_RETRY_DELAY = 60_000;
/** The longest total time one request may spend waiting between attempts, in milliseconds. */
export const MAX_RETRY_WAIT = 120_000;

const DEFAULT_BASE_DELAY = MIN_RETRY_DELAY;
const DEFAULT_MAX_DELAY = 30_000;

// The responses worth repeating: the server says it is overloaded or not available for now,
// not that the request was wrong.
const RETRYABLE_STATUS = new Set([429, 503, 504]);

// Only methods that read or delete. The API has PUTs that start tasks or place orders, so the
// HTTP idea of an idempotent PUT does not hold here.
const RETRYABLE_METHODS = new Set(["GET", "HEAD", "DELETE"]);

/**
 * How to retry transient API failures.
 *
 * The empty policy (`{}`) does not retry: retries are opt-in. Use `RETRY_DEFAULT`, or
 * `retry: true` on the client.
 *
 * Only responses that are safe to repeat are retried: status 429, 503 and 504, and only for
 * GET, HEAD and DELETE. POST, PUT and PATCH are never retried: on this API a PUT can start a
 * task or place an order. A DELETE that the server had already applied answers 404 on the
 * retry.
 *
 * A request that got no response (connection reset, timeout) is never retried: there is no
 * way to know whether the server applied it.
 */
export interface RetryPolicy {
  /** Total attempts, the first one included. 0 or 1 disables retries. At most 3. */
  readonly maxAttempts?: number | undefined;
  /** The first backoff step in milliseconds, doubled at each attempt. 0 means 3s. Else at least 3s. */
  readonly baseDelay?: number | undefined;
  /**
   * The longest single wait in milliseconds. 0 means 30s. Else between baseDelay and 60s. A
   * Retry-After header that asks for longer is not followed: the response goes back to the
   * caller.
   */
  readonly maxDelay?: number | undefined;
}

/** The recommended policy: up to 3 attempts, waiting 3s to 30s between them. */
export const RETRY_DEFAULT: RetryPolicy = Object.freeze({
  maxAttempts: MAX_RETRY_ATTEMPTS,
  baseDelay: DEFAULT_BASE_DELAY,
  maxDelay: DEFAULT_MAX_DELAY,
});

/** Throw ConfigurationError when the policy is outside the retry limits. */
export function validateRetry(p: RetryPolicy): void {
  const attempts = p.maxAttempts ?? 0;
  const base = p.baseDelay ?? 0;
  const max = p.maxDelay ?? 0;
  if (!Number.isInteger(attempts) || attempts < 0 || attempts > MAX_RETRY_ATTEMPTS) {
    throw new ConfigurationError(
      `retry: maxAttempts is ${attempts}: it must be between 0 and ${MAX_RETRY_ATTEMPTS}`,
    );
  }
  if (!(base >= 0) || (base > 0 && base < MIN_RETRY_DELAY)) {
    throw new ConfigurationError(
      `retry: baseDelay is ${base}ms: it must be 0 (default) or at least ${MIN_RETRY_DELAY}ms`,
    );
  }
  if (!(max >= 0) || (max > 0 && max < MIN_RETRY_DELAY) || max > MAX_RETRY_DELAY) {
    throw new ConfigurationError(
      `retry: maxDelay is ${max}ms: it must be 0 (default) or between ${MIN_RETRY_DELAY}ms and ${MAX_RETRY_DELAY}ms`,
    );
  }
  const [b, top] = retryBounds(p);
  if (b > top) {
    throw new ConfigurationError(`retry: baseDelay (${b}ms) is longer than maxDelay (${top}ms)`);
  }
}

/** The total attempt count, never below 1. */
export function retryAttempts(p: RetryPolicy): number {
  return Math.max(p.maxAttempts ?? 0, 1);
}

/** The delay bounds, with defaults for zero values. */
export function retryBounds(p: RetryPolicy): [number, number] {
  const base = (p.baseDelay ?? 0) > 0 ? p.baseDelay! : DEFAULT_BASE_DELAY;
  const top = (p.maxDelay ?? 0) > 0 ? p.maxDelay! : DEFAULT_MAX_DELAY;
  return [base, top];
}

/**
 * Whether a response may be attempted again. Request bodies are always bytes here, so they
 * can always be sent again.
 */
export function shouldRetry(method: string, status: number): boolean {
  return RETRYABLE_STATUS.has(status) && RETRYABLE_METHODS.has(method.toUpperCase());
}

/**
 * Read a Retry-After header: a delay in seconds, or an HTTP date. Return milliseconds, or
 * undefined when absent or not readable.
 */
export function parseRetryAfter(
  value: string | null,
  now: number = Date.now(),
): number | undefined {
  if (value === null) {
    return undefined;
  }
  const v = value.trim();
  if (!v) {
    return undefined;
  }
  // Like Go's strconv.Atoi: ASCII digits, an optional sign, a value that fits in 64 bits.
  if (/^[+-]?[0-9]+$/.test(v)) {
    const seconds = BigInt(v);
    if (seconds < -(2n ** 63n) || seconds >= 2n ** 63n) {
      return undefined;
    }
    return seconds <= 0n ? 0 : Number(seconds) * 1000;
  }
  // An HTTP date always names its time zone (GMT). Date.parse also reads dates without one,
  // in local time: those are not HTTP dates.
  if (!/\b(GMT|UTC|[+-]\d{4})$/.test(v)) {
    return undefined;
  }
  const when = Date.parse(v);
  if (Number.isNaN(when)) {
    return undefined;
  }
  return Math.max(when - now, 0);
}

/**
 * How long to wait before the attempt after this one, in milliseconds, or undefined to not
 * retry.
 *
 * A Retry-After header wins over the local backoff: the server knows its load. When it asks
 * for more than maxDelay, there is no retry: retrying sooner than asked would spend an attempt
 * to get another 429.
 *
 * Else the delay is exponential with equal jitter: half the backoff, plus a random part up to
 * the other half, so clients throttled by the same spike do not retry together.
 *
 * Either way the delay is never below MIN_RETRY_DELAY.
 */
export function retryDelay(
  policy: RetryPolicy,
  attempt: number,
  retryAfter: string | null,
  rand: () => number = Math.random,
): number | undefined {
  const [base, top] = retryBounds(policy);
  const asked = parseRetryAfter(retryAfter);
  if (asked !== undefined) {
    if (asked > top) {
      return undefined;
    }
    return Math.max(asked, MIN_RETRY_DELAY);
  }
  let backoff = base;
  for (let i = 1; i < attempt; i++) {
    if (backoff >= top) {
      break;
    }
    backoff *= 2;
  }
  backoff = Math.min(backoff, top);
  const half = backoff / 2;
  return Math.max(half + rand() * half, MIN_RETRY_DELAY);
}
