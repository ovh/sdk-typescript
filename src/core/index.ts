// SPDX-FileCopyrightText: 2026 OVH SAS
//
// SPDX-License-Identifier: Apache-2.0

/**
 * The core of the SDK, without the generated sections: `@ovhcloud/sdk/core`.
 *
 * Use it with the sections you need, so a bundler leaves the others out:
 *
 * ```ts
 * import { Client } from "@ovhcloud/sdk/core";
 * import { MeApi } from "@ovhcloud/sdk/api/me";
 *
 * const me = new MeApi(new Client()); // reads OVH_CLIENT_ID, OVH_CLIENT_SECRET, OVH_REGION
 * const account = await me.getAccountDetails(); // GET /v1/me
 * console.log(account.nichandle);
 * ```
 *
 * Most programs import the full client from "@ovhcloud/sdk" instead.
 *
 * @module
 */

export {
  OAuth2ClientCredentials,
  type OAuth2ClientCredentialsOptions,
  StaticTokenSource,
  type TokenSource,
} from "./auth.js";
export {
  Client,
  type ClientOptions,
  type ClientOverrides,
  type RawRequestOptions,
} from "./client.js";
export { ENV_CLIENT_ID, ENV_CLIENT_SECRET, ENV_REGION, REGIONS, type Region } from "./config.js";
export type { Logger } from "./debug.js";
export type { RequestOptions } from "./engine.js";
export {
  ApiError,
  BadRequestError,
  ConfigurationError,
  ConflictError,
  DecodeError,
  DryRunError,
  ForbiddenError,
  HookRefusedError,
  InvalidRequestError,
  NotAllowedError,
  NotFoundError,
  OvhError,
  RequestTimeoutError,
  ResponseTooLargeError,
  TokenError,
  TooManyRequestsError,
  TransportError,
  UnauthorizedError,
  WaitFailedError,
  WaitTimeoutError,
} from "./errors.js";
export type { AfterRequestHook, BeforeRequestHook, CallInfo, CallResult } from "./hooks.js";
export { MAX_CURSOR_PAGES } from "./pagination.js";
export { type Operation, Registry, type SectionLoader } from "./registry.js";
export { path } from "./request.js";
export {
  MAX_RETRY_ATTEMPTS,
  MAX_RETRY_DELAY,
  MAX_RETRY_WAIT,
  MIN_RETRY_DELAY,
  RETRY_DEFAULT,
  type RetryPolicy,
} from "./retry.js";
export { SectionApi } from "./section.js";
export { VERSION } from "./version.js";
export { type WaitOptions, wait, waitGone, waitReady, waitTask } from "./wait.js";
