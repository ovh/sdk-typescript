// SPDX-FileCopyrightText: 2026 OVH SAS
//
// SPDX-License-Identifier: Apache-2.0

/**
 * The TypeScript SDK of the OVHcloud API.
 *
 * ```ts
 * import { Client } from "@ovhcloud/sdk";
 *
 * const client = new Client(); // reads OVH_CLIENT_ID, OVH_CLIENT_SECRET, OVH_REGION
 * const account = await client.me.getAccountDetails(); // GET /v1/me
 * console.log(account.nichandle);
 * ```
 *
 * Each API section is a property of the client. Its types are exported by
 * `@ovhcloud/sdk/api/<section>`. To find the method of a route, read `index/<section>.jsonl`
 * at the root of the package.
 *
 * @module
 */

import { registry } from "./api/client.js";
import type { Operation } from "./core/registry.js";

// The generated client wins over the core's: it has one property per section.
export { Client } from "./api/client.js";
export * from "./core/index.js";

/** Every operation of the SDK, sorted by name. */
export function operations(): Promise<Operation[]> {
  return registry.all();
}

/** The operation of that name, "vrack.getVrack", or undefined. */
export function lookupOperation(name: string): Promise<Operation | undefined> {
  return registry.lookup(name);
}

/**
 * The operation a request with that method and path calls, or undefined.
 *
 * `GET /v1/vrack/pn-12345` gives vrack.getVrack. A route with fewer parameters wins over one
 * with more. A query string is ignored.
 */
export function matchOperation(method: string, path: string): Promise<Operation | undefined> {
  return registry.match(method, path);
}
