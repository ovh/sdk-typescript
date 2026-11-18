// SPDX-FileCopyrightText: 2026 OVH SAS
//
// SPDX-License-Identifier: Apache-2.0

/**
 * OAuth2 authentication: client credentials, or tokens the caller gets another way.
 *
 * @module
 */

import { ResponseTooLargeError, TokenError } from "./errors.js";
import { escapeQuery, readBody } from "./request.js";

// A token is renewed this many milliseconds before it expires, as golang.org/x/oauth2 does.
const EXPIRY_DELTA = 10_000;

/** The timeout of a token request when none is given, in milliseconds. */
const DEFAULT_TIMEOUT = 30_000;

// A token response is small. A larger body is an error, not a memory problem.
const MAX_BODY = 1 << 20;

/**
 * Gives the bearer token of each request.
 *
 * Implement it to get tokens your own way. It is called before every request, so it must
 * cache its token.
 */
export interface TokenSource {
  /** Return a valid access token. */
  token(signal?: AbortSignal): Promise<string> | string;
}

/** Always gives the same token. It is never renewed. */
export class StaticTokenSource implements TokenSource {
  readonly #token: string;

  constructor(token: string) {
    if (!token) {
      throw new TypeError("StaticTokenSource: empty token");
    }
    this.#token = token;
  }

  token(): string {
    return this.#token;
  }

  toString(): string {
    return "StaticTokenSource(token=[REDACTED])";
  }
}

/** The options of OAuth2ClientCredentials. */
export interface OAuth2ClientCredentialsOptions {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  /** The scopes to ask for. Default: ["all"]. */
  scopes?: readonly string[] | undefined;
  /** The fetch function to use. Default: the global fetch. */
  fetch?: typeof fetch | undefined;
  /** Options added to every request, such as an undici dispatcher. */
  fetchOptions?: RequestInit | undefined;
  /**
   * Milliseconds one token request may take, from sending it to the end of the response
   * body. 0: no timeout. Default: 30 seconds. Client gives its own `timeout`.
   */
  timeout?: number | undefined;
  /** The clock, in milliseconds. Tests replace it. */
  clock?: (() => number) | undefined;
}

/**
 * Tokens of an OAuth2 service account, with the client credentials flow.
 *
 * The token is fetched on first use, reused until 10 seconds before it expires, then fetched
 * again. Calls that need a token at the same time share one fetch.
 *
 * Each token request has a timeout (see `timeout`), and a response larger than 1 MiB is a
 * TokenError. A redirect is a TokenError too, and is never followed. The timeout and the size
 * cap are those of the Java SDK. A caller's signal stops that caller's wait at once, but not
 * the shared fetch: the others may still need it.
 */
export class OAuth2ClientCredentials implements TokenSource {
  readonly tokenUrl: string;
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #scopes: readonly string[];
  readonly #fetch: typeof fetch;
  readonly #fetchOptions: RequestInit;
  readonly #clock: () => number;
  readonly #timeout: number;
  #token = "";
  #expiry: number | undefined;
  #pending: Promise<string> | undefined;
  // Like golang.org/x/oauth2's AuthStyleAutoDetect: try HTTP Basic first, then the
  // credentials in the form, and keep the one that worked.
  #inParams: boolean | undefined;

  constructor(options: OAuth2ClientCredentialsOptions) {
    this.#clientId = options.clientId;
    this.#clientSecret = options.clientSecret;
    this.tokenUrl = options.tokenUrl;
    this.#scopes = options.scopes ?? ["all"];
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#fetchOptions = options.fetchOptions ?? {};
    this.#clock = options.clock ?? (() => performance.now());
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;
    if (!(timeout >= 0) || !Number.isFinite(timeout)) {
      throw new TypeError(
        `OAuth2ClientCredentials: timeout must be milliseconds, 0 or more, not ${timeout}`,
      );
    }
    this.#timeout = timeout;
  }

  toString(): string {
    return `OAuth2ClientCredentials(clientId=${JSON.stringify(this.#clientId)}, tokenUrl=${JSON.stringify(this.tokenUrl)})`;
  }

  token(signal?: AbortSignal): Promise<string> {
    if (
      this.#token &&
      (this.#expiry === undefined || this.#clock() < this.#expiry - EXPIRY_DELTA)
    ) {
      return Promise.resolve(this.#token);
    }
    // One fetch for every caller that needs a token now. The fetch does not use a caller's
    // signal: one caller giving up must not fail the others. It has its own timeout.
    this.#pending ??= this.#fetchToken().finally(() => {
      this.#pending = undefined;
    });
    if (!signal) {
      return this.#pending;
    }
    return abortable(this.#pending, signal);
  }

  async #fetchToken(): Promise<string> {
    if (this.#inParams === undefined) {
      try {
        await this.#fetchWith(false);
        this.#inParams = false;
        return this.#token;
      } catch (err) {
        if (!(err instanceof RefusedError)) {
          throw err;
        }
      }
      try {
        await this.#fetchWith(true);
      } catch (err) {
        throw err instanceof RefusedError ? new TokenError(err.message) : err;
      }
      this.#inParams = true;
      return this.#token;
    }
    try {
      await this.#fetchWith(this.#inParams);
    } catch (err) {
      throw err instanceof RefusedError ? new TokenError(err.message) : err;
    }
    return this.#token;
  }

  async #fetchWith(inParams: boolean): Promise<void> {
    const form = new URLSearchParams({ grant_type: "client_credentials" });
    if (this.#scopes.length > 0) {
      form.set("scope", this.#scopes.join(" "));
    }
    const headers = new Headers({
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    });
    if (inParams) {
      form.set("client_id", this.#clientId);
      form.set("client_secret", this.#clientSecret);
    } else {
      const pair = `${formEscape(this.#clientId)}:${formEscape(this.#clientSecret)}`;
      headers.set("Authorization", `Basic ${btoa(pair)}`);
    }
    const where = `obtaining an OAuth2 token from ${this.tokenUrl}`;
    // The timer covers the request and its body. A caller's signal never stops the shared
    // fetch (see token()), but a signal of fetchOptions does.
    const timer = this.#timeout > 0 ? AbortSignal.timeout(this.#timeout) : undefined;
    const own = this.#fetchOptions.signal;
    const signal = own && timer ? AbortSignal.any([own, timer]) : (timer ?? own);
    let resp: Response;
    let body: string;
    try {
      resp = await this.#fetch(this.tokenUrl, {
        ...this.#fetchOptions,
        method: "POST",
        headers,
        body: form.toString(),
        redirect: "error",
        ...(signal ? { signal } : {}),
      });
      body = new TextDecoder().decode(await readBody(resp, MAX_BODY));
    } catch (err) {
      if (err instanceof ResponseTooLargeError) {
        throw new TokenError(`${where}: ${err.message}`);
      }
      if (timer?.aborted) {
        throw new TokenError(`${where}: timed out: the request took more than ${this.#timeout}ms`);
      }
      throw new TokenError(this.#hide(`${where}: ${String(err)}`));
    }
    const start = this.#clock();
    if (resp.status < 200 || resp.status > 299) {
      throw new RefusedError(
        this.#hide(
          `obtaining an OAuth2 token from ${this.tokenUrl}: ${resp.status} ${resp.statusText}: ${describe(body)}`,
        ),
      );
    }
    const [token, expiresIn] = parseToken(resp.headers.get("Content-Type") ?? "", body);
    if (!token) {
      throw new TokenError(
        `obtaining an OAuth2 token from ${this.tokenUrl}: the response has no access_token`,
      );
    }
    this.#token = token;
    this.#expiry = expiresIn !== undefined && expiresIn > 0 ? start + expiresIn * 1000 : undefined;
  }

  /** Remove the client secret from a message, should the server echo it. */
  #hide(text: string): string {
    if (!this.#clientSecret) {
      return text;
    }
    return text
      .replaceAll(this.#clientSecret, "[REDACTED]")
      .replaceAll(formEscape(this.#clientSecret), "[REDACTED]");
  }
}

/** The token endpoint answered outside 2xx. */
class RefusedError extends Error {}

/** The escaping of the Basic credentials RFC 6749 asks for: Go's url.QueryEscape. */
const formEscape = escapeQuery;

function parseToken(contentType: string, body: string): [string, number | undefined] {
  let data: Record<string, unknown>;
  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("text/plain")
  ) {
    data = Object.fromEntries(new URLSearchParams(body));
  } else {
    let loaded: unknown;
    try {
      loaded = JSON.parse(body);
    } catch {
      throw new TokenError("the OAuth2 token response is not JSON");
    }
    if (typeof loaded !== "object" || loaded === null || Array.isArray(loaded)) {
      throw new TokenError("the OAuth2 token response is not a JSON object");
    }
    data = loaded as Record<string, unknown>;
  }
  const token = data.access_token;
  const expiresIn = data.expires_in;
  let expiry: number | undefined;
  if (typeof expiresIn === "number" && Number.isFinite(expiresIn)) {
    expiry = expiresIn;
  } else if (typeof expiresIn === "string" && /^[0-9]+$/.test(expiresIn)) {
    expiry = Number(expiresIn);
  }
  return [typeof token === "string" ? token : "", expiry];
}

/** The error of a token endpoint answer: "invalid_client: Bad credentials". */
function describe(body: string): string {
  try {
    const data: unknown = JSON.parse(body);
    if (typeof data === "object" && data !== null && !Array.isArray(data)) {
      const { error, error_description: desc } = data as Record<string, unknown>;
      if (typeof error === "string" && typeof desc === "string" && desc) {
        return `${error}: ${desc}`;
      }
      if (typeof error === "string") {
        return error;
      }
    }
  } catch {
    // not JSON: the text itself
  }
  return body.trim().slice(0, 500);
}

/** A promise that rejects when signal aborts, else settles like p. */
export function abortable<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // p may reject too, with the same reason: that rejection is handled here.
    p.catch(() => undefined);
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}
