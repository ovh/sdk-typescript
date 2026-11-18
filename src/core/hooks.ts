// SPDX-FileCopyrightText: 2026 OVH SAS
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Request hooks and dry runs: the `beforeRequest`, `afterRequest` and `dryRun` options of
 * Client. Like the Go SDK's WithBeforeRequest, WithAfterRequest and WithDryRun.
 *
 * @module
 */

import { ConfigurationError } from "./errors.js";
import type { Operation } from "./registry.js";

/**
 * One API call, as the request hooks see it. It never holds the Authorization header or the
 * token. A hook must not change it.
 */
export interface CallInfo {
  /**
   * The operation called. undefined when the registry does not know the route: a raw call
   * (`client.get`) to a section the client does not know.
   */
  readonly operation: Operation | undefined;
  /** The HTTP method: "POST". */
  readonly method: string;
  /** The path with its parameters filled in: "/v1/vrack/pn-1/cloudProject". */
  readonly path: string;
  /**
   * The full query the call sends: the query parameters, and any query written in the path.
   * For a call refused before it was encoded (by the policy, or because it is malformed), it
   * is the query parameters only.
   */
  readonly query: URLSearchParams;
  /** The request body as the caller gave it, before JSON encoding. undefined: no body. */
  readonly body: unknown;
  /**
   * True for GET and HEAD: a call that only reads, which a dry run sends. The Go SDK has it
   * as Operation.ReadOnly(). Here it is on the call, so it works for an unknown route too.
   */
  readonly readOnly: boolean;
  /** The signal of the call, when the caller gave one. An async hook can stop on it. */
  readonly signal: AbortSignal | undefined;
}

/** What an after hook learns about how a call ended. */
export interface CallResult {
  /**
   * The HTTP status of the last response, or 0 when there was none: the call was refused
   * before it was sent, or the network failed.
   */
  readonly status: number;
  /**
   * The X-Ovh-Queryid header of the last response, which identifies the request to OVHcloud
   * support. "" when there was no response.
   */
  readonly queryId: string;
  /** The error the caller gets, or undefined on success. */
  readonly error: unknown;
  /** Milliseconds the whole call took, retries included. */
  readonly duration: number;
  /**
   * The number of times the request was sent: 0 when it was not sent, more than 1 when it was
   * retried (see the retry option).
   */
  readonly attempts: number;
}

/**
 * Runs before a call is sent. Throw to stop the call: nothing is sent, and the caller gets a
 * HookRefusedError whose `cause` is what the hook threw. It may be async: the call waits for
 * it.
 *
 * Calls made at the same time interleave: an async hook may run for one call while it waits
 * for another.
 */
export type BeforeRequestHook = (call: CallInfo) => void | Promise<void>;

/**
 * Runs once a call is over, whatever the outcome. It may be async: the call waits for it
 * before it returns or throws.
 *
 * A hook that throws replaces the result of the call with its error, and the hooks after it
 * do not run. Like a panic in a Go hook. Catch your own errors in a hook.
 */
export type AfterRequestHook = (call: CallInfo, result: CallResult) => void | Promise<void>;

/** Check a hook option: one function or a list of them. Return the list. */
export function checkHooks<T>(option: string, hooks: T | readonly T[] | undefined): readonly T[] {
  if (hooks === undefined) {
    return [];
  }
  const list = Array.isArray(hooks) ? (hooks as readonly T[]) : [hooks as T];
  for (const hook of list) {
    if (typeof hook !== "function") {
      throw new ConfigurationError(`${option}: a hook must be a function, not ${typeof hook}`);
    }
  }
  return Object.freeze([...list]);
}
