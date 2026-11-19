// SPDX-FileCopyrightText: 2026 OVH SAS
//
// SPDX-License-Identifier: Apache-2.0

/**
 * The SDK's errors.
 *
 * Every error the SDK throws is an OvhError. The Go SDK has sentinel errors matched with
 * errors.Is. Here each sentinel is a class, matched with instanceof:
 *
 * | Go                  | TypeScript                  |
 * | ------------------- | --------------------------- |
 * | *APIError           | ApiError                    |
 * | ErrBadRequest       | BadRequestError (400)       |
 * | ErrUnauthorized     | UnauthorizedError (401)     |
 * | ErrForbidden        | ForbiddenError (403)        |
 * | ErrNotFound         | NotFoundError (404)         |
 * | ErrConflict         | ConflictError (409)         |
 * | ErrTooManyRequests  | TooManyRequestsError (429)  |
 * | ErrInvalidRequest   | InvalidRequestError         |
 * | ErrNotAllowed       | NotAllowedError             |
 * | ErrDryRun           | DryRunError                 |
 * | (a hook's error)    | HookRefusedError            |
 * | ErrResponseTooLarge | ResponseTooLargeError       |
 * | ErrWaitFailed       | WaitFailedError             |
 *
 * @module
 */

import type { Operation } from "./registry.js";

/** The base class of every error the SDK throws. */
export class OvhError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** The client cannot be created with these settings: no credentials, an unknown region... */
export class ConfigurationError extends OvhError {}

/** What ApiError needs to describe a response outside 2xx. */
export interface ApiErrorInit {
  method: string;
  path: string;
  status: number;
  /** The status text: "Forbidden". */
  statusText?: string;
  body?: Uint8Array;
  queryId?: string;
  schemasVersion?: string;
  operation?: Operation | undefined;
}

/**
 * The API answered with a status outside 2xx.
 *
 * The message is the API's own, so printing the error is usually enough. It names the
 * operation, and on a 401 or 403 the IAM actions the call needs:
 *
 * ```text
 * vrack.getVrack: GET /v1/vrack/pn-1: 403 Forbidden: ... (Client::Forbidden); requires the
 * IAM action vrack:apiovh:get
 * ```
 *
 * Match a subclass to handle one status: `err instanceof NotFoundError`. Read `status`,
 * `apiMessage` or `queryId` on any of them.
 *
 * `JSON.stringify(err)` gives the message and the fields, with the body as text. The raw
 * `body` is not enumerable, so loggers do not print its bytes one by one.
 */
export class ApiError extends OvhError {
  /** The operation's registry name, "vrack.getVrack", when the registry knows the route. */
  readonly operation: string;
  /** The IAM actions the operation needs. On a 403, the caller's policy lacks one of them. */
  readonly iamActions: readonly string[];
  readonly method: string;
  readonly path: string;
  /** The status code: 403. */
  readonly status: number;
  /** The status line: "403 Forbidden". */
  readonly statusLine: string;
  /** `class` of the API's error body, when it has the usual shape. */
  readonly errorClass: string;
  /** `message` of the API's error body, when it has the usual shape. */
  readonly apiMessage: string;
  /** Identifies the request to OVHcloud support (the X-Ovh-Queryid header). */
  readonly queryId: string;
  /** The X-Schemas-Version the API served the response with (v2 routes only), or "". */
  readonly schemasVersion: string;
  /** The raw response body. Not enumerable: read `bodyText` for the text. */
  declare readonly body: Uint8Array;

  constructor(init: ApiErrorInit) {
    const body = init.body ?? new Uint8Array();
    const [errorClass, apiMessage] = errorPayload(body);
    const statusLine = `${init.status} ${init.statusText ?? ""}`.trim();
    const operation = init.operation?.name ?? "";
    const iamActions = init.operation?.iamActions ?? [];
    super(
      describe({
        operation,
        iamActions,
        method: init.method,
        path: init.path,
        status: init.status,
        statusLine,
        errorClass,
        apiMessage,
        body,
      }),
    );
    this.operation = operation;
    this.iamActions = iamActions;
    this.method = init.method;
    this.path = init.path;
    this.status = init.status;
    this.statusLine = statusLine;
    this.errorClass = errorClass;
    this.apiMessage = apiMessage;
    this.queryId = init.queryId ?? "";
    this.schemasVersion = init.schemasVersion ?? "";
    Object.defineProperty(this, "body", { value: body, enumerable: false });
  }

  /** The response body as text (UTF-8), or "" when there is none. */
  get bodyText(): string {
    return new TextDecoder().decode(this.body);
  }

  /** The fields of the error, for JSON.stringify and loggers. The body is given as text. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      operation: this.operation,
      iamActions: this.iamActions,
      method: this.method,
      path: this.path,
      status: this.status,
      statusLine: this.statusLine,
      errorClass: this.errorClass,
      apiMessage: this.apiMessage,
      queryId: this.queryId,
      schemasVersion: this.schemasVersion,
      bodyText: this.bodyText,
    };
  }
}

function describe(e: {
  operation: string;
  iamActions: readonly string[];
  method: string;
  path: string;
  status: number;
  statusLine: string;
  errorClass: string;
  apiMessage: string;
  body: Uint8Array;
}): string {
  let text = e.operation ? `${e.operation}: ` : "";
  text += `${e.method} ${e.path}: ${e.statusLine}`;
  if (e.apiMessage) {
    text += `: ${e.apiMessage}`;
  } else if (e.body.length > 0) {
    text += `: ${new TextDecoder().decode(e.body).trim()}`;
  }
  if (e.errorClass) {
    text += ` (${e.errorClass})`;
  }
  if (e.iamActions.length > 0 && (e.status === 401 || e.status === 403)) {
    const s = e.iamActions.length > 1 ? "s" : "";
    text += `; requires the IAM action${s} ${e.iamActions.join(", ")}`;
  }
  if (e.status === 400 && e.apiMessage.includes("Unknown version")) {
    text +=
      "; this SDK release targets an X-Schemas-Version the API no longer serves: upgrade the SDK";
  }
  return text;
}

/** Read `class` and `message` from an error body of the usual shape. */
function errorPayload(body: Uint8Array): [string, string] {
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return ["", ""];
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return ["", ""];
  }
  const { class: cls, message } = payload as Record<string, unknown>;
  return [typeof cls === "string" ? cls : "", typeof message === "string" ? message : ""];
}

/** 400 Bad Request. */
export class BadRequestError extends ApiError {}

/** 401 Unauthorized: the token is missing, expired, or from another region. */
export class UnauthorizedError extends ApiError {}

/** 403 Forbidden: the service account lacks an IAM action. Retrying does not help. */
export class ForbiddenError extends ApiError {}

/** 404 Not Found. */
export class NotFoundError extends ApiError {}

/** 409 Conflict. */
export class ConflictError extends ApiError {}

/** 429 Too Many Requests. */
export class TooManyRequestsError extends ApiError {}

const STATUS_ERRORS: ReadonlyMap<number, typeof ApiError> = new Map([
  [400, BadRequestError],
  [401, UnauthorizedError],
  [403, ForbiddenError],
  [404, NotFoundError],
  [409, ConflictError],
  [429, TooManyRequestsError],
]);

/** The ApiError of a response: the subclass of its status code, or ApiError itself. */
export function apiError(init: ApiErrorInit): ApiError {
  const cls = STATUS_ERRORS.get(init.status) ?? ApiError;
  return new cls(init);
}

/**
 * A request refused before it is sent because it is malformed.
 *
 * For example an empty path parameter, or a path that does not start with "/".
 */
export class InvalidRequestError extends OvhError {}

/**
 * A request the client is configured to refuse. Nothing was sent.
 *
 * See the `readOnly` and `allowedOperations` options of Client.
 */
export class NotAllowedError extends OvhError {
  /** The operation's name, or "" when the registry does not know the route. */
  readonly operation: string;
  readonly method: string;
  readonly path: string;
  /** Which option refused it. */
  readonly reason: string;

  constructor(init: { operation: string; method: string; path: string; reason: string }) {
    super(`${init.operation || "request"} (${init.method} ${init.path}) not sent: ${init.reason}`);
    this.operation = init.operation;
    this.method = init.method;
    this.path = init.path;
    this.reason = init.reason;
  }
}

/**
 * A before hook refused the call. Nothing was sent. What the hook threw is the `cause`.
 *
 * The Go SDK wraps the hook's error the same way: errors.Is finds it there, `cause` here.
 */
export class HookRefusedError extends OvhError {
  /** The operation's name, or "" when the registry does not know the route. */
  readonly operation: string;
  readonly method: string;
  readonly path: string;

  constructor(init: { operation: string; method: string; path: string; cause: unknown }) {
    const why = init.cause instanceof Error ? init.cause.message : String(init.cause);
    super(
      `${init.operation || "request"} (${init.method} ${init.path}) not sent: refused by a hook: ${why}`,
      { cause: init.cause },
    );
    this.operation = init.operation;
    this.method = init.method;
    this.path = init.path;
  }
}

/**
 * A call that the `dryRun` option did not send. It holds what the call would have sent,
 * except the credentials: no token is fetched, and the Authorization header (with the other
 * credential headers, such as Cookie) is left out.
 *
 * It is not a NotAllowedError: the policy is checked first, and a call it refuses stays a
 * NotAllowedError.
 *
 * ```ts
 * try {
 *   await client.vrack.createCloudProject("pn-1", { project: "0123456789abcdef" });
 * } catch (err) {
 *   if (err instanceof DryRunError) {
 *     console.log(err.method, err.url, err.body);
 *   }
 * }
 * ```
 */
export class DryRunError extends OvhError {
  /** The operation's name, or "" when the registry does not know the route. */
  readonly operation: string;
  readonly method: string;
  /** The full URL: the endpoint, the path and the encoded query. */
  readonly url: string;
  /**
   * The headers: Accept, Content-Type, User-Agent, X-Schemas-Version, those of the headers
   * options and of the header parameters.
   */
  readonly headers: Headers;
  /** The JSON body, or undefined when the call has none. */
  readonly body: string | undefined;

  constructor(init: {
    operation: string;
    method: string;
    url: string;
    headers: Headers;
    body: string | undefined;
  }) {
    super(`${init.operation || "request"} (${init.method} ${init.url}) not sent: dry run`);
    this.operation = init.operation;
    this.method = init.method;
    this.url = init.url;
    this.headers = init.headers;
    this.body = init.body;
  }

  /** The fields of the error, for JSON.stringify and loggers. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      operation: this.operation,
      method: this.method,
      url: this.url,
      headers: Object.fromEntries(this.headers),
      body: this.body,
    };
  }
}

/**
 * The response body exceeds the client's `maxResponseBytes`.
 *
 * The SDK fails rather than truncate the body.
 */
export class ResponseTooLargeError extends OvhError {}

/**
 * The request got no response: connection refused, DNS failure, timeout, TLS error.
 *
 * It is never retried: the server may have applied a request that got no answer. The error
 * of fetch is the `cause`.
 */
export class TransportError extends OvhError {}

/**
 * The request took more than its timeout: the client's `timeout`, or the `timeout` of the
 * call. Each retry attempt has its own.
 *
 * It is a TransportError, so it is never retried either: the server may have done the work.
 * The abort error of fetch is the `cause`. Match it with `err instanceof RequestTimeoutError`:
 * its name is "RequestTimeoutError", not the "TimeoutError" of a DOMException. Python's
 * RequestTimeoutError is also a TimeoutError. JavaScript has no such class to extend.
 */
export class RequestTimeoutError extends TransportError {}

/**
 * The OAuth2 token endpoint refused the credentials, timed out, answered with more than 1 MiB,
 * or could not be reached.
 *
 * The message never contains the client secret.
 */
export class TokenError extends OvhError {}

/** A 2xx response body is not valid JSON. */
export class DecodeError extends OvhError {}

/**
 * A wait ended in a failure: a resourceStatus of ERROR, a task in error or cancelled, or a
 * task that waits for an action.
 *
 * `last` is the last value the wait read.
 */
export class WaitFailedError extends OvhError {
  readonly last: unknown;

  constructor(message: string, last: unknown) {
    super(message);
    this.last = last;
  }
}

/**
 * A wait gave up: the work was not done before the timeout.
 *
 * `last` is the last value the wait read, or undefined.
 */
export class WaitTimeoutError extends OvhError {
  readonly last: unknown;

  constructor(message: string, last: unknown) {
    super(message);
    this.last = last;
  }
}
