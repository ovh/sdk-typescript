// SPDX-FileCopyrightText: 2026 OVH SAS
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Regions, endpoints, environment variables and the User-Agent.
 *
 * @module
 */

import { ConfigurationError } from "./errors.js";
import { VERSION } from "./version.js";

/** Environment variables Client reads when no option overrides them. Same names as the Go SDK. */
export const ENV_CLIENT_ID = "OVH_CLIENT_ID";
export const ENV_CLIENT_SECRET = "OVH_CLIENT_SECRET";
export const ENV_REGION = "OVH_REGION";

/**
 * The OVHcloud API a client talks to, and the OAuth2 token endpoint of its tokens: "eu",
 * "ca" or "us". A token from one region is refused by the others.
 */
export type Region = "eu" | "ca" | "us";

/**
 * The public API host of each region, and its OAuth2 token endpoint.
 *
 * The API hosts accept OAuth2 bearer tokens. (The manager hosts that publish the OpenAPI
 * specs refuse them.) api.eu.ovhcloud.com and api.ca.ovhcloud.com replace eu.api.ovh.com and
 * ca.api.ovh.com, which serve the same API and still answer: pass one of them as endpoint if
 * needed. The token endpoints are the ones the identity provider advertises in its OpenID
 * configuration.
 */
export const REGIONS: Readonly<
  Record<Region, { readonly apiUrl: string; readonly tokenUrl: string }>
> = {
  eu: { apiUrl: "https://api.eu.ovhcloud.com", tokenUrl: "https://www.ovh.com/auth/oauth2/token" },
  ca: { apiUrl: "https://api.ca.ovhcloud.com", tokenUrl: "https://ca.ovh.com/auth/oauth2/token" },
  us: {
    apiUrl: "https://api.us.ovhcloud.com",
    tokenUrl: "https://us.ovhcloud.com/auth/oauth2/token",
  },
};

/** Return the region named by value, in any case. An unknown name is an error. */
export function parseRegion(value: string): Region {
  const region = value.trim().toLowerCase();
  if (region === "eu" || region === "ca" || region === "us") {
    return region;
  }
  throw new ConfigurationError(`unknown region "${value}": want eu, ca or us`);
}

/**
 * Check an endpoint override and return it without its trailing "/".
 *
 * Paths are appended to it as text, so it has no version suffix.
 */
export function checkEndpoint(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConfigurationError(`endpoint "${url}" is not an absolute URL`);
  }
  if (!parsed.host) {
    throw new ConfigurationError(`endpoint "${url}" is not an absolute URL`);
  }
  return url.replace(/\/+$/, "");
}

/** A variable of the environment, or "" when unset or when the runtime has no environment. */
export function env(name: string): string {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  try {
    return proc?.env?.[name] ?? "";
  } catch {
    // Deno without --allow-env throws.
    return "";
  }
}

interface RuntimeGlobals {
  Deno?: { version?: { deno?: string }; build?: { os?: string; arch?: string } };
  Bun?: { version?: string };
  process?: { versions?: { node?: string }; platform?: string; arch?: string };
}

/**
 * The SDK's own User-Agent: `ovhcloud-typescript-sdk/0.1.0 (node/24.16.0; linux/x64)`.
 *
 * It always comes first. The `userAgent` option only appends the caller's product.
 */
export function sdkUserAgent(): string {
  const g = globalThis as RuntimeGlobals;
  let runtime = "unknown";
  let platform = "unknown/unknown";
  if (g.Deno?.version?.deno) {
    runtime = `deno/${g.Deno.version.deno}`;
    platform = `${g.Deno.build?.os ?? "unknown"}/${g.Deno.build?.arch ?? "unknown"}`;
  } else if (g.Bun?.version) {
    runtime = `bun/${g.Bun.version}`;
  } else if (g.process?.versions?.node) {
    runtime = `node/${g.process.versions.node}`;
  }
  if (!g.Deno && g.process?.platform) {
    platform = `${g.process.platform}/${g.process.arch ?? "unknown"}`;
  }
  return `ovhcloud-typescript-sdk/${VERSION} (${runtime}; ${platform})`;
}

/** Check a product the caller appends to the User-Agent: "my-tool/1.2". */
export function checkProduct(product: string): string {
  const p = product.trim();
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are refused
  if (!p || /[\r\n]/.test(p) || /[^\x00-\x7f]/.test(p)) {
    throw new ConfigurationError(`userAgent "${product}" is not a valid product`);
  }
  return p;
}
