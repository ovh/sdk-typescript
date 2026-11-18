// SPDX-FileCopyrightText: 2026 OVH SAS
//
// SPDX-License-Identifier: Apache-2.0

/**
 * The machinery behind Client: build, authenticate, send, retry, log, decode.
 *
 * @module
 */

import type { TokenSource } from "./auth.js";
import { abortable } from "./auth.js";
import { dumpRequest, dumpResponse, isSensitiveHeader, type Logger, redactDump } from "./debug.js";
import {
  apiError,
  ConfigurationError,
  DecodeError,
  DryRunError,
  HookRefusedError,
  InvalidRequestError,
  RequestTimeoutError,
  ResponseTooLargeError,
  TransportError,
} from "./errors.js";
import type { AfterRequestHook, BeforeRequestHook, CallInfo, CallResult } from "./hooks.js";
import type { Policy } from "./policy.js";
import { isReadOnly, type Operation, type Registry } from "./registry.js";
import {
  buildHeaders,
  buildQuery,
  checkHeader,
  checkPath,
  encodeBody,
  escapeRawPath,
  isVersioned,
  type Pairs,
  type Request,
  readBody,
  tooLarge,
  unversioned,
} from "./request.js";
import {
  MAX_RETRY_WAIT,
  type RetryPolicy,
  retryAttempts,
  retryDelay,
  shouldRetry,
} from "./retry.js";
import { sleep } from "./wait.js";

export const SCHEMAS_VERSION_HEADER = "X-Schemas-Version";

// Headers the headers options cannot set: the SDK owns them.
const OWN_HEADERS: ReadonlyMap<string, string> = new Map([
  ["user-agent", "use the userAgent option"],
  ["x-schemas-version", "the SDK sends the version its types were generated from"],
]);

/** Options of one call: the last argument of every generated method. */
export interface RequestOptions {
  /** Stop the call when this signal aborts. The call then throws the signal's reason. */
  signal?: AbortSignal | undefined;
  /**
   * Milliseconds the call may take, from sending it to the end of the response body. Each
   * retry attempt has its own. Overrides the client's timeout.
   */
  timeout?: number | undefined;
  /** Headers sent with this call. They cannot set User-Agent or X-Schemas-Version. */
  headers?: Readonly<Record<string, string>> | undefined;
}

/** How generated code wants a 2xx response body. */
export type ResultKind =
  /** No result: the body is ignored. */
  | "none"
  /** JSON. A body that is not JSON is a DecodeError. */
  | "json"
  /** JSON, or the body itself when it is not JSON: some v1 routes answer a bare string. */
  | "string";

/** Everything a client needs to send a request. Frozen: withOptions makes a copy. */
export interface EngineConfig {
  readonly endpoint: string;
  readonly fetch: typeof fetch;
  readonly fetchOptions: RequestInit;
  readonly tokens: TokenSource;
  readonly userAgent: string;
  readonly headers: ReadonlyArray<readonly [string, string]>;
  readonly retry: RetryPolicy;
  readonly maxResponseBytes: number;
  readonly debug: boolean;
  readonly debugBodies: boolean;
  readonly logger: Logger;
  readonly policy: Policy;
  readonly registry: Registry;
  /** Milliseconds one attempt may take in all. 0: no limit. */
  readonly timeout: number;
  /** Waits between retry attempts. Tests replace it so they need not sleep. */
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Do not send calls that write: throw DryRunError instead. */
  readonly dryRun: boolean;
  /** Run before each call, in order. */
  readonly beforeRequest: readonly BeforeRequestHook[];
  /** Run after each call, in order. */
  readonly afterRequest: readonly AfterRequestHook[];
}

/** What a call learns while it sends: for the after hooks. */
interface Exchange {
  attempts: number;
  status: number;
  queryId: string;
}

/** Check the headers of an option and return them as pairs. */
export function checkHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(headers ?? {})) {
    const why = OWN_HEADERS.get(key.toLowerCase());
    if (why !== undefined) {
      throw new ConfigurationError(`headers cannot set ${key}: ${why}`);
    }
    try {
      checkHeader(key, value);
    } catch (err) {
      throw new ConfigurationError((err as Error).message);
    }
    out.push([key, value]);
  }
  return out;
}

/** Check a timeout option. */
export function checkTimeout(timeout: number | undefined): number {
  if (timeout === undefined) {
    return 0;
  }
  if (!(timeout > 0) || !Number.isFinite(timeout)) {
    throw new ConfigurationError(
      `timeout must be a positive number of milliseconds, not ${timeout}`,
    );
  }
  return timeout;
}

/** Sends requests for a client. */
export class Engine {
  readonly config: EngineConfig;

  constructor(config: EngineConfig) {
    this.config = Object.freeze({ ...config });
  }

  /** An engine like this one, with some settings changed. */
  with(changes: Partial<EngineConfig>): Engine {
    return new Engine({ ...this.config, ...changes });
  }

  // --- what generated code calls --------------------------------------------------------

  /** Call one operation and decode its result. */
  async call(
    req: Request,
    kind: ResultKind,
    options: RequestOptions | undefined,
  ): Promise<unknown> {
    const [body] = await this.send(req, options);
    if (kind === "none") {
      return undefined;
    }
    return decode(body, kind === "string");
  }

  // --- sending --------------------------------------------------------------------------

  /**
   * Send a request: policy, hooks, dry run, token, retries, size cap. Return the body and
   * headers of a 2xx response. Throw ApiError for any other status.
   *
   * The steps run in this order, as in the Go SDK: find the operation, check the request and
   * the policy (readOnly, allowedOperations), encode it, run the before hooks, stop there in a
   * dry run, then get a token and send it. The after hooks see every outcome, refusals too.
   */
  async send(req: Request, options?: RequestOptions): Promise<[Uint8Array, Headers]> {
    const after = this.config.afterRequest;
    if (after.length === 0) {
      return this.#send(req, options, { call: undefined }, { attempts: 0, status: 0, queryId: "" });
    }
    const start = performance.now();
    const seen: { call: CallInfo | undefined } = { call: undefined };
    const exchange: Exchange = { attempts: 0, status: 0, queryId: "" };
    let failed = false;
    let error: unknown;
    try {
      return await this.#send(req, options, seen, exchange);
    } catch (err) {
      failed = true;
      error = err;
      throw err;
    } finally {
      const call = seen.call ?? callInfo(req, undefined, queryOf("", req.query), options);
      const result: CallResult = Object.freeze({
        status: exchange.status,
        queryId: exchange.queryId,
        error: failed ? error : undefined,
        duration: performance.now() - start,
        attempts: exchange.attempts,
      });
      for (const hook of after) {
        await hook(call, result);
      }
    }
  }

  async #send(
    req: Request,
    options: RequestOptions | undefined,
    seen: { call: CallInfo | undefined },
    exchange: Exchange,
  ): Promise<[Uint8Array, Headers]> {
    const c = this.config;
    const hooked = c.beforeRequest.length > 0 || c.afterRequest.length > 0;
    const op: Operation | undefined = req.operation ?? (await this.#match(req.method, req.path));
    if (hooked) {
      seen.call = callInfo(req, op, queryOf("", req.query), options);
    }
    // First the path: the policy must check the route that is really sent.
    checkPath(req.path, req.method, op);
    this.config.policy.check(op, req.method, req.path);
    const extra = checkHeaders(options?.headers);
    const timeout =
      options?.timeout === undefined ? this.config.timeout : checkTimeout(options.timeout);

    const [path, existing = ""] = splitOnce(req.path, "?");
    const query = buildQuery(existing, req.query ?? []);
    const sent = escapeRawPath(path);
    let url: URL;
    try {
      url = new URL(this.config.endpoint + sent + (query ? `?${query}` : ""));
    } catch (err) {
      throw new InvalidRequestError(`path "${req.path}": ${String(err)}`);
    }
    const body = req.body === undefined ? undefined : encodeBody(req.body);

    const pairs: Array<[string, string]> = [["Accept", "application/json"]];
    if (body !== undefined) {
      pairs.push(["Content-Type", "application/json"]);
    }
    pairs.push(...this.config.headers.map(([k, v]): [string, string] => [k, v]));
    pairs.push(...buildHeaders(req.headers ?? []));
    pairs.push(...extra);
    if (req.schemasVersion) {
      // Set, not added: the API reads the first value.
      setHeader(pairs, SCHEMAS_VERSION_HEADER, req.schemasVersion);
    }
    // Set last, so neither the client's headers nor a request can replace them.
    setHeader(pairs, "User-Agent", this.config.userAgent);
    const signal = options?.signal;

    if (hooked) {
      const call = callInfo(req, op, new URLSearchParams(query), options);
      seen.call = call;
      for (const hook of c.beforeRequest) {
        try {
          await hook(call);
        } catch (err) {
          throw new HookRefusedError({
            operation: op?.name ?? "",
            method: req.method,
            path: req.path,
            cause: err,
          });
        }
      }
    }
    if (c.dryRun && !isReadOnly(req.method)) {
      const headers = new Headers();
      for (const [k, v] of pairs) {
        if (!isSensitiveHeader(k)) {
          headers.append(k, v);
        }
      }
      throw new DryRunError({
        operation: op?.name ?? "",
        method: req.method,
        url: url.toString(),
        headers,
        body,
      });
    }

    const token = await (signal
      ? abortable(Promise.resolve(this.config.tokens.token(signal)), signal)
      : Promise.resolve(this.config.tokens.token()));
    checkHeader("Authorization", token);
    setHeader(pairs, "Authorization", `Bearer ${token}`);

    const [response, content] = await this.#exchange(
      req.method,
      url,
      pairs,
      body,
      timeout,
      signal,
      exchange,
    );
    if (response.status < 200 || response.status > 299) {
      throw apiError({
        method: req.method,
        path: req.path,
        status: response.status,
        statusText: response.statusText,
        body: content,
        queryId: response.headers.get("X-Ovh-Queryid") ?? "",
        schemasVersion: response.headers.get(SCHEMAS_VERSION_HEADER) ?? "",
        operation: op,
      });
    }
    return [content, response.headers];
  }

  /**
   * The operation of a raw call, like Python's match_operation. "/1.0/me" (the node-ovh form)
   * is read as "/v1/me". A path without any version, "/me", is tried with /v1, then /v2.
   * checkPath refuses both forms, and its hint names the version found here.
   */
  async #match(method: string, path: string): Promise<Operation | undefined> {
    const registry = this.config.registry;
    if (!path.startsWith("/") || isVersioned(path)) {
      return registry.match(method, path);
    }
    const rest = unversioned(path);
    if (rest !== path) {
      return registry.match(method, `/v1${rest}`);
    }
    return (
      (await registry.match(method, `/v1${rest}`)) ?? (await registry.match(method, `/v2${rest}`))
    );
  }

  /** One logical request: debug logging, retries, the timeout and the size cap. */
  async #exchange(
    method: string,
    url: URL,
    pairs: ReadonlyArray<[string, string]>,
    body: string | undefined,
    timeout: number,
    signal: AbortSignal | undefined,
    exchange: Exchange,
  ): Promise<[Response, Uint8Array]> {
    const c = this.config;
    const attempts = retryAttempts(c.retry);
    let waited = 0;
    for (let attempt = 1; ; attempt++) {
      if (c.debug) {
        c.logger(redactDump(dumpRequest(method, url, pairs, c.debugBodies ? body : undefined)));
      }
      // One signal per attempt: the caller's, and the timeout of this attempt.
      const timer = timeout > 0 ? AbortSignal.timeout(timeout) : undefined;
      const signals = [signal, timer].filter((s): s is AbortSignal => s !== undefined);
      const attemptSignal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
      const what = `${method} ${url.pathname}`;
      let response: Response;
      try {
        const headers = new Headers();
        for (const [k, v] of pairs) {
          headers.append(k, v);
        }
        exchange.attempts = attempt;
        response = await c.fetch(url, {
          ...c.fetchOptions,
          method,
          headers,
          // Requests are sent as they are. A redirect is handed back, as an ApiError: the
          // token must not follow it to another host.
          redirect: "manual",
          ...(body === undefined ? {} : { body }),
          ...(attemptSignal ? { signal: attemptSignal } : {}),
        });
      } catch (err) {
        // Not retried: a request that got no response may still have been applied.
        throw transportError(what, err, signal, timer, timeout);
      }
      // The last response, also when the call then fails on it: too large, or cut short.
      exchange.status = response.status;
      exchange.queryId = response.headers.get("X-Ovh-Queryid") ?? "";
      let delay: number | undefined;
      try {
        let content: Uint8Array | undefined;
        if (c.debug) {
          if (c.debugBodies) {
            // The whole body, past maxResponseBytes too: the dump shows what came. The cap
            // applies below, to the response handed back.
            content = await read(response, 0, "reading the response", signal, timer, timeout);
          }
          c.logger(redactDump(dumpResponse(response, content)));
        }
        if (attempt < attempts && shouldRetry(method, response.status)) {
          delay = retryDelay(c.retry, attempt, response.headers.get("Retry-After"));
          if (delay !== undefined && waited + delay > MAX_RETRY_WAIT) {
            delay = undefined;
          }
        }
        if (delay === undefined) {
          // The last attempt, a response that is not retried, or a server that asks to wait
          // longer than allowed: hand it back as it is.
          if (content === undefined) {
            content = await read(
              response,
              c.maxResponseBytes,
              "reading the response",
              signal,
              timer,
              timeout,
            );
          } else if (c.maxResponseBytes > 0 && content.length > c.maxResponseBytes) {
            throw new ResponseTooLargeError(tooLarge(c.maxResponseBytes));
          }
          return [response, content];
        }
        waited += delay;
        if (content === undefined) {
          void response.body?.cancel().catch(() => undefined);
        }
        if (c.debug) {
          c.logger(
            `retrying ${method} ${url.pathname} after ${(delay / 1000).toFixed(1)}s (attempt ${attempt + 1}/${attempts}, got ${response.status} ${response.statusText})`,
          );
        }
      } catch (err) {
        void response.body?.cancel().catch(() => undefined);
        throw err;
      }
      await c.sleep(delay!, signal);
    }
  }
}

/**
 * Read a body, failing (never truncating) past cap bytes (0: no cap).
 */
async function read(
  response: Response,
  cap: number,
  what: string,
  signal: AbortSignal | undefined,
  timer: AbortSignal | undefined,
  timeout: number,
): Promise<Uint8Array> {
  try {
    return await readBody(response, cap);
  } catch (err) {
    if (err instanceof ResponseTooLargeError) {
      throw err;
    }
    throw transportError(what, err, signal, timer, timeout);
  }
}

/**
 * The error of a request that got no response, or no whole response. A call the caller
 * aborted throws the reason of its signal, as fetch does. Anything else is a TransportError.
 */
function transportError(
  what: string,
  err: unknown,
  signal: AbortSignal | undefined,
  timer: AbortSignal | undefined,
  timeout: number,
): unknown {
  if (signal?.aborted) {
    return signal.reason;
  }
  if (timer?.aborted) {
    return new RequestTimeoutError(`${what}: timed out: the request took more than ${timeout}ms`, {
      cause: err,
    });
  }
  const cause = (err as { cause?: unknown }).cause;
  const detail = cause instanceof Error ? `${String(err)}: ${cause.message}` : String(err);
  return new TransportError(`${what}: ${detail}`, { cause: err });
}

/**
 * Decode a JSON response body. An empty body gives undefined. With text, a body that is not
 * JSON is returned as a string: some v1 routes answer a bare, unquoted string.
 */
export function decode(body: Uint8Array, text: boolean): unknown {
  if (body.length === 0) {
    return undefined;
  }
  const s = new TextDecoder().decode(body);
  try {
    return JSON.parse(s);
  } catch (err) {
    if (text) {
      return s;
    }
    throw new DecodeError(`the response is not JSON: ${String(err)}`);
  }
}

/** The call the hooks see. */
function callInfo(
  req: Request,
  op: Operation | undefined,
  query: URLSearchParams,
  options: RequestOptions | undefined,
): CallInfo {
  return Object.freeze({
    operation: op,
    method: req.method,
    path: req.path,
    query,
    body: req.body,
    readOnly: isReadOnly(req.method),
    signal: options?.signal,
  });
}

/**
 * The query of a call refused before it was encoded: its query parameters only, as far as
 * they can be encoded.
 */
function queryOf(existing: string, pairs: Pairs | undefined): URLSearchParams {
  try {
    return new URLSearchParams(buildQuery(existing, pairs ?? []));
  } catch {
    return new URLSearchParams();
  }
}

/** Replace every value of a header with one value. */
function setHeader(pairs: Array<[string, string]>, name: string, value: string): void {
  const lower = name.toLowerCase();
  for (let i = pairs.length - 1; i >= 0; i--) {
    if (pairs[i]![0].toLowerCase() === lower) {
      pairs.splice(i, 1);
    }
  }
  pairs.push([name, value]);
}

function splitOnce(s: string, sep: string): [string, string?] {
  const i = s.indexOf(sep);
  return i < 0 ? [s] : [s.slice(0, i), s.slice(i + 1)];
}

export { sleep as defaultSleep };
