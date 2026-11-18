// SPDX-FileCopyrightText: 2026 OVH SAS
//
// SPDX-License-Identifier: Apache-2.0

/**
 * The client of the OVHcloud API.
 *
 * @module
 */

import { OAuth2ClientCredentials, type TokenSource } from "./auth.js";
import {
  checkEndpoint,
  checkProduct,
  ENV_CLIENT_ID,
  ENV_CLIENT_SECRET,
  ENV_REGION,
  env,
  parseRegion,
  REGIONS,
  type Region,
  sdkUserAgent,
} from "./config.js";
import { defaultLogger, type Logger } from "./debug.js";
import {
  checkHeaders,
  checkTimeout,
  decode,
  defaultSleep,
  Engine,
  type RequestOptions,
} from "./engine.js";
import { ConfigurationError } from "./errors.js";
import { type AfterRequestHook, type BeforeRequestHook, checkHooks } from "./hooks.js";
import { iterate } from "./pagination.js";
import { Policy } from "./policy.js";
import { Registry } from "./registry.js";
import type { Pairs } from "./request.js";
import { RETRY_DEFAULT, type RetryPolicy, validateRetry } from "./retry.js";

/** The options of a client. All are optional. */
export interface ClientOptions {
  /**
   * "eu", "ca" or "us". Default: OVH_REGION, else "eu". It also picks the OAuth2 token
   * endpoint, which must match: a token of one region is refused by the others, with a 401
   * that looks like a bad secret.
   */
  region?: Region | (string & {}) | undefined;
  /** An OAuth2 service account (client credentials flow). Default: OVH_CLIENT_ID. */
  clientId?: string | undefined;
  /** The secret of the service account. Default: OVH_CLIENT_SECRET. */
  clientSecret?: string | undefined;
  /** Tokens you get your own way: an object with a `token()` method. */
  tokenSource?: TokenSource | undefined;
  /** Replaces the region's API URL, for a proxy or a test server. No version suffix. */
  endpoint?: string | undefined;
  /**
   * Milliseconds one request may take, from sending it to the end of the response body, like
   * the Go SDK's WithTimeout. Each retry attempt has its own. A request that takes longer
   * throws RequestTimeoutError. The OAuth2 token request has the same timeout, and throws
   * TokenError. withOptions does not change the token request timeout: the token source is
   * shared. Default: no timeout. The token request then has one of 30 seconds.
   */
  timeout?: number | undefined;
  /** A RetryPolicy, or true for RETRY_DEFAULT. Off by default. */
  retry?: RetryPolicy | boolean | undefined;
  /** Fail, never truncate, on a response body larger than this. 0: no limit. */
  maxResponseBytes?: number | undefined;
  /** Log every request and response with logger. Credential headers are always hidden. */
  debug?: boolean | undefined;
  /** Also log the bodies, which often carry secrets. Implies debug. */
  debugBodies?: boolean | undefined;
  /** Where debug logs go. Default: console.error. */
  logger?: Logger | undefined;
  /** Your application, "my-tool/1.2". It is added after the SDK's own User-Agent. */
  userAgent?: string | undefined;
  /** Headers sent with every request. They cannot set User-Agent or X-Schemas-Version. */
  headers?: Readonly<Record<string, string>> | undefined;
  /**
   * true: send only GET and HEAD. A list of operation name patterns: the same, plus these
   * operations.
   */
  readOnly?: boolean | readonly string[] | undefined;
  /** Send only the operations whose name matches one of these patterns: "vrack.*", "*.get*". */
  allowedOperations?: readonly string[] | undefined;
  /**
   * Plan changes without making them. Calls that only read (GET and HEAD) are sent as usual,
   * so the program sees the real state. Any other call is not sent: it throws a DryRunError
   * with the URL, the headers and the body it would have sent. No token is fetched for it.
   * The policy applies first: a call that readOnly or allowedOperations refuses stays a
   * NotAllowedError. Like the Go SDK's WithDryRun.
   */
  dryRun?: boolean | undefined;
  /**
   * Hooks that run before each call, in order, to log it or to stop it by throwing. A hook
   * runs once per call, before the first attempt: retries do not run it again. A call that the
   * policy refuses, or that is malformed, never reaches it. The first hook that throws stops
   * the call: nothing is sent, and the caller gets a HookRefusedError. Each page of a list is
   * a separate call. Like the Go SDK's WithBeforeRequest.
   */
  beforeRequest?: BeforeRequestHook | readonly BeforeRequestHook[] | undefined;
  /**
   * Hooks that run after each call, in order, once its retries are over. They see every call,
   * also those refused by the policy, by a before hook or by dryRun, so they can keep a full
   * audit log. Each page of a list is a separate call. Like the Go SDK's WithAfterRequest.
   */
  afterRequest?: AfterRequestHook | readonly AfterRequestHook[] | undefined;
  /**
   * The fetch function to use. Default: the global fetch. Give your own for a proxy, your own
   * certificate authorities or mutual TLS (undici's fetch with a dispatcher), or for tests.
   */
  fetch?: typeof fetch | undefined;
  /** Options added to every request, such as `{ dispatcher }` for undici. */
  fetchOptions?: RequestInit | undefined;
  /**
   * Called with the milliseconds to wait between two retry attempts, in place of a timer. For
   * tests: `retrySleep: async () => {}` retries a mocked 503 at once. The retry limits still
   * apply. A call's signal is passed too: stop waiting when it aborts. Like Python's
   * retry_sleep. The Go SDK has this only inside its own tests.
   */
  retrySleep?: ((ms: number, signal?: AbortSignal) => Promise<void>) | undefined;
}

/** Settings withOptions can change. */
export interface ClientOverrides {
  /** Milliseconds one request may take. null: no timeout. */
  timeout?: number | null | undefined;
  retry?: RetryPolicy | boolean | undefined;
  maxResponseBytes?: number | undefined;
  /** Headers added to the client's headers. */
  headers?: Readonly<Record<string, string>> | undefined;
}

/** Options of a raw call (`client.request`, `client.get`...). */
export interface RawRequestOptions extends RequestOptions {
  /** Query parameters, encoded like the generated methods do: an array repeats the key. */
  query?: Readonly<Record<string, unknown>> | Pairs | undefined;
  /** The JSON body. */
  body?: unknown | undefined;
  /** The X-Schemas-Version to send, for a /v2 route. Default: none. */
  schemasVersion?: string | undefined;
}

/**
 * A client of the OVHcloud API. Create one and share it.
 *
 * With no options it reads its credentials from OVH_CLIENT_ID and OVH_CLIENT_SECRET (an
 * OAuth2 service account) and its region from OVH_REGION (eu, ca or us; eu by default).
 * Options win over the environment:
 *
 * ```ts
 * import { Client } from "@ovhcloud/sdk";
 *
 * const client = new Client();
 * console.log(await client.me.getMe());
 * ```
 *
 * Each API section is a property of the client from "@ovhcloud/sdk": `client.vrack`,
 * `client.publicCloud`. Call any route with `client.get("/v1/me")`.
 */
export class Client {
  /** @internal The engine: what the sections send their requests with. */
  _engine: Engine;
  /** @internal */
  _region: Region;
  /** @internal The sections already built, by name. */
  _sections: Map<string, unknown>;

  /**
   * @param options - the client's settings. See ClientOptions.
   * @param registry - the operations the client knows, for raw calls. The generated client
   *   gives every section's.
   */
  constructor(options: ClientOptions = {}, registry: Registry = new Registry()) {
    const region = parseRegion(options.region ?? (env(ENV_REGION) || "eu"));
    const endpoint =
      options.endpoint === undefined ? REGIONS[region].apiUrl : checkEndpoint(options.endpoint);
    let userAgent = sdkUserAgent();
    if (options.userAgent !== undefined) {
      userAgent = `${userAgent} ${checkProduct(options.userAgent)}`;
    }
    const fetchFn =
      options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    const fetchOptions = options.fetchOptions ?? {};
    const timeout = checkTimeout(options.timeout);
    if (options.retrySleep !== undefined && typeof options.retrySleep !== "function") {
      throw new ConfigurationError("retrySleep must be a function");
    }
    this._engine = new Engine({
      endpoint,
      fetch: fetchFn,
      fetchOptions,
      // The token request has the client's timeout, or 30 seconds when there is none.
      tokens: tokenSource(
        options,
        region,
        fetchFn,
        fetchOptions,
        options.timeout === undefined ? undefined : timeout,
      ),
      userAgent,
      headers: checkHeaders(options.headers),
      retry: retryPolicy(options.retry),
      maxResponseBytes: Math.max(options.maxResponseBytes ?? 0, 0),
      debug: Boolean(options.debug || options.debugBodies),
      debugBodies: Boolean(options.debugBodies),
      logger: options.logger ?? defaultLogger,
      policy: Policy.build(options.readOnly, options.allowedOperations),
      registry,
      timeout,
      sleep: options.retrySleep ?? defaultSleep,
      dryRun: Boolean(options.dryRun),
      beforeRequest: checkHooks("beforeRequest", options.beforeRequest),
      afterRequest: checkHooks("afterRequest", options.afterRequest),
    });
    this._region = region;
    this._sections = new Map();
  }

  /** The API base URL requests go to: "https://api.eu.ovhcloud.com". */
  get endpoint(): string {
    return this._engine.config.endpoint;
  }

  /** The region of the client: "eu", "ca" or "us". */
  get region(): Region {
    return this._region;
  }

  toString(): string {
    return `Client(endpoint=${this.endpoint})`;
  }

  /**
   * A client like this one, with other settings. It shares this client's token, so it is
   * cheap:
   *
   * ```ts
   * await client.withOptions({ timeout: 5000 }).vrack.listVracks();
   * ```
   */
  withOptions(overrides: ClientOverrides): this {
    const c = this._engine.config;
    const changes: { -readonly [K in keyof typeof c]?: (typeof c)[K] } = {};
    if (overrides.timeout !== undefined) {
      changes.timeout = overrides.timeout === null ? 0 : checkTimeout(overrides.timeout);
    }
    if (overrides.retry !== undefined) {
      changes.retry = retryPolicy(overrides.retry);
    }
    if (overrides.maxResponseBytes !== undefined) {
      changes.maxResponseBytes = Math.max(overrides.maxResponseBytes, 0);
    }
    if (overrides.headers) {
      changes.headers = [...c.headers, ...checkHeaders(overrides.headers)];
    }
    const clone = Object.create(Object.getPrototypeOf(this) as object) as this;
    clone._engine = this._engine.with(changes);
    clone._region = this._region;
    clone._sections = new Map();
    return clone;
  }

  /** @internal The section of that name, built on first use. Generated code calls it. */
  _section<T>(name: string, make: (client: this) => T): T {
    let s = this._sections.get(name) as T | undefined;
    if (s === undefined) {
      s = make(this);
      this._sections.set(name, s);
    }
    return s;
  }

  // --- calling any route ------------------------------------------------------------------

  /**
   * Call any route and return the decoded JSON, or undefined.
   *
   * path has the API version: "/v1/me", "/v2/iam/policy". A path without it, "/me" or
   * "/1.0/me", throws InvalidRequestError. It is sent already escaped: a "#" or a "\" is part
   * of the path, and a "%" must start an escape. Build a path with values in it with `path()`,
   * which escapes them. A response that is a bare, unquoted string is returned as a string. An
   * error status throws ApiError, like the generated methods:
   *
   * ```ts
   * const me = await client.request<{ nichandle: string }>("GET", "/v1/me");
   * await client.request("POST", "/v1/me/contact", { body: { email: "..." } });
   * await client.get(path("/v1/ip/{ip}", { ip: "1.2.3.0/24" }));
   * ```
   *
   * T is the type of the result. Nothing checks it at run time: the result is the JSON the
   * API sent, whatever T says. Default: unknown.
   */
  async request<T = unknown>(
    method: string,
    path: string,
    options: RawRequestOptions = {},
  ): Promise<T> {
    const [body] = await this._engine.send(
      {
        method: method.toUpperCase(),
        path,
        query: pairs(options.query),
        body: options.body,
        schemasVersion: options.schemasVersion,
      },
      options,
    );
    return decode(body, true) as T;
  }

  /** `request<T>("GET", path, options)`. T is not checked at run time. */
  get<T = unknown>(path: string, options?: Omit<RawRequestOptions, "body">): Promise<T> {
    return this.request<T>("GET", path, options);
  }

  /** `request<T>("POST", path, { ...options, body })`. T is not checked at run time. */
  post<T = unknown>(
    path: string,
    body?: unknown,
    options?: Omit<RawRequestOptions, "body">,
  ): Promise<T> {
    return this.request<T>("POST", path, { ...options, body });
  }

  /** `request<T>("PUT", path, { ...options, body })`. T is not checked at run time. */
  put<T = unknown>(
    path: string,
    body?: unknown,
    options?: Omit<RawRequestOptions, "body">,
  ): Promise<T> {
    return this.request<T>("PUT", path, { ...options, body });
  }

  /** `request<T>("PATCH", path, { ...options, body })`. T is not checked at run time. */
  patch<T = unknown>(
    path: string,
    body?: unknown,
    options?: Omit<RawRequestOptions, "body">,
  ): Promise<T> {
    return this.request<T>("PATCH", path, { ...options, body });
  }

  /** `request<T>("DELETE", path, options)`. T is not checked at run time. */
  delete<T = unknown>(path: string, options?: Omit<RawRequestOptions, "body">): Promise<T> {
    return this.request<T>("DELETE", path, options);
  }

  /**
   * Iterate over the items of any v2 list paginated by cursor, page by page:
   *
   * ```ts
   * for await (const policy of client.iterate<{ id: string }>("/v2/iam/policy")) {
   *   console.log(policy.id);
   * }
   * ```
   *
   * T is the type of one item. Nothing checks it at run time. Default: unknown.
   */
  iterate<T = unknown>(
    path: string,
    options: RawRequestOptions & { method?: string } = {},
  ): AsyncIterable<T> {
    // The headers go in the request, so a caller's X-Pagination-Cursor starts the walk and the
    // next pages replace it.
    const { headers, ...rest } = options;
    return iterate<T>(
      (req, signal) => this._engine.send(req, signal ? { ...rest, signal } : rest),
      {
        method: (options.method ?? "GET").toUpperCase(),
        path,
        query: pairs(options.query),
        headers: checkHeaders(headers),
        body: options.body,
        schemasVersion: options.schemasVersion,
      },
      options.signal,
    );
  }
}

function retryPolicy(retry: RetryPolicy | boolean | undefined): RetryPolicy {
  if (retry === undefined || retry === false) {
    return {};
  }
  if (retry === true) {
    return RETRY_DEFAULT;
  }
  validateRetry(retry);
  return Object.freeze({ ...retry });
}

function tokenSource(
  options: ClientOptions,
  region: Region,
  fetchFn: typeof fetch,
  fetchOptions: RequestInit,
  timeout: number | undefined,
): TokenSource {
  if (options.tokenSource !== undefined) {
    if (typeof options.tokenSource?.token !== "function") {
      throw new ConfigurationError("tokenSource has no token() method");
    }
    return options.tokenSource;
  }
  let { clientId, clientSecret } = options;
  if (clientId === undefined && clientSecret === undefined) {
    clientId = env(ENV_CLIENT_ID);
    clientSecret = env(ENV_CLIENT_SECRET);
  }
  clientId ??= "";
  clientSecret ??= "";
  if (clientId && clientSecret) {
    // Tokens are fetched with the same fetch and timeout as API calls. withOptions shares
    // the token source, so its timeout does not change the token request's.
    return new OAuth2ClientCredentials({
      clientId,
      clientSecret,
      tokenUrl: REGIONS[region].tokenUrl,
      fetch: fetchFn,
      fetchOptions,
      timeout,
    });
  }
  if (clientId || clientSecret) {
    throw new ConfigurationError(
      "both a client ID and a client secret are needed: only one was given",
    );
  }
  throw new ConfigurationError(
    `no credentials: set ${ENV_CLIENT_ID} and ${ENV_CLIENT_SECRET}, or give clientId and clientSecret, or tokenSource`,
  );
}

function pairs(values: Readonly<Record<string, unknown>> | Pairs | undefined): Pairs {
  if (values === undefined) {
    return [];
  }
  if (Array.isArray(values)) {
    return values as Pairs;
  }
  return Object.entries(values);
}
