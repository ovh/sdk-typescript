// SPDX-FileCopyrightText: 2026 OVH SAS
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Building requests: path parameters, query and header values, JSON bodies.
 *
 * @module
 */

import { InvalidRequestError } from "./errors.js";
import type { Operation } from "./registry.js";

/** Name and value pairs of a query or headers. A name may come several times. */
export type Pairs = ReadonlyArray<readonly [string, unknown]>;

/** One API call, as the client sends it. */
export interface Request {
  readonly method: string;
  /** The path with its API version, parameters filled in: "/v1/vrack/pn-1". */
  readonly path: string;
  readonly query?: Pairs;
  readonly headers?: Pairs;
  /** The JSON body. undefined: no body. */
  readonly body?: unknown;
  readonly operation?: Operation | undefined;
  /** X-Schemas-Version to send. */
  readonly schemasVersion?: string | undefined;
}

// A {name} left in a path. fillPath escapes the braces of every value it fills in, so a
// placeholder left over is a parameter that was never set. Only the part before any query
// string is checked: braces in a query are data.
const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_.-]*)\}/;

/**
 * Escape a path segment like Go's url.PathEscape: letters, digits, "-_.~" and "$&+:=@" are
 * kept, everything else is percent-encoded.
 */
export function escapePath(text: string): string {
  return encodeURIComponent(text)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%(24|26|2B|3A|3D|40)/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
}

/**
 * Escape a query key or value like Go's url.QueryEscape: letters, digits and "-_.~" are kept,
 * a space is "+", everything else is percent-encoded.
 */
export function escapeQuery(text: string): string {
  return encodeURIComponent(text)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "+");
}

function unescapeQuery(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    return text;
  }
}

/**
 * Fill the {name} placeholders of a path, escaping each value:
 *
 * ```ts
 * fillPath("/v1/vrack/{serviceName}/ip/{ip}", { serviceName: sn, ip });
 * ```
 *
 * An empty value (or null, or undefined) leaves its placeholder, and the client then refuses
 * the request: GET /v1/vrack/ instead of GET /v1/vrack/{serviceName} would call another route.
 */
export function fillPath(template: string, params: Readonly<Record<string, unknown>>): string {
  let path = template;
  for (const [name, value] of Object.entries(params)) {
    const text = encodeValue(value)[0] ?? "";
    if (!text) {
      continue;
    }
    path = path.replaceAll(`{${name}}`, escapePath(text));
  }
  return path;
}

/**
 * Fill the {name} placeholders of a path, escaping each value, for the raw calls:
 *
 * ```ts
 * import { path } from "@ovhcloud/sdk";
 *
 * await client.get(path("/v1/ip/{ip}", { ip: "1.2.3.0/24" })); // GET /v1/ip/1.2.3.0%2F24
 * ```
 *
 * Like Go's ovh.Path and Python's path(). Without it, a value such as "1.2.3.0/24" would call
 * another route. Values are encoded like query values: a Date gives its RFC 3339 text. An
 * empty value (or null, or undefined) leaves its placeholder, and the client then refuses the
 * request.
 */
export function path(template: string, params: Readonly<Record<string, unknown>>): string {
  return fillPath(template, params);
}

// The API version a path starts with: "/v1/me", "/v2/iam/policy".
const VERSIONED = /^\/v[0-9]+(\/|$)/;

/** Whether a path starts with its API version: "/v1/me" does, "/me" and "/1.0/me" do not. */
export function isVersioned(path: string): boolean {
  return VERSIONED.test(path.split("?", 1)[0]!);
}

/**
 * Refuse a path that would not call the route it names.
 *
 * Like Python and unlike Go, a path without its API version is refused, with a hint: "/me" or
 * "/1.0/me" (the node-ovh form) would get a plain 404 from the API. operation is the operation
 * the path matched, if any: it gives the version of the hint.
 */
export function checkPath(path: string, method: string, operation: Operation | undefined): void {
  // The path is appended to the endpoint as text, so one that does not start with "/" would
  // change the host the request, and its token, go to: "@evil.example/".
  if (!path.startsWith("/")) {
    throw new InvalidRequestError(`path "${path}": it must start with /`);
  }
  if (!isVersioned(path)) {
    throw new InvalidRequestError(
      `path "${path}": it must start with the API version, /v1/ or /v2/: did you mean ${versioned(path, operation)}?`,
    );
  }
  let where = `${method} ${path}`;
  if (operation) {
    where = `${operation.name} (${where})`;
  }
  const route = path.split("?", 1)[0]!;
  const m = PLACEHOLDER.exec(route);
  if (m) {
    throw new InvalidRequestError(`${where}: the path parameter ${m[1]} is empty`);
  }
  // fetch removes "." and ".." segments before it sends a request. The route sent would then
  // not be the route that readOnly and allowedOperations checked: "/v1/vrack/../ip/x" is sent
  // as "/v1/ip/x". A path parameter set to ".." is the same.
  for (const segment of route.split("/")) {
    const s = unescapeQuery(segment.replace(/\+/g, "%2B"));
    if (s === "." || s === "..") {
      throw new InvalidRequestError(`${where}: the path has a . or .. segment`);
    }
  }
}

/**
 * The path without its version: "/1.0/me" gives "/me". A path with no version is returned as
 * it is.
 */
export function unversioned(path: string): string {
  if (path === "/1.0" || path.startsWith("/1.0/") || path.startsWith("/1.0?")) {
    return path.slice("/1.0".length);
  }
  return path;
}

/** path with its API version, for a hint: the version of the operation it matched, or /v1. */
function versioned(path: string, operation: Operation | undefined): string {
  let version = "/v1";
  if (operation?.path.startsWith("/v")) {
    version = `/${operation.path.split("/", 2)[1]}`;
  }
  return version + unversioned(path);
}

/**
 * Encode one parameter value as query or header text.
 *
 * null and undefined give nothing. An array gives one value per item (the key is repeated).
 * An object is sent as JSON with sorted keys, which is how the API takes object parameters
 * such as iamTags. A Date is sent in RFC 3339, to the second.
 */
export function encodeValue(value: unknown): string[] {
  if (value === null || value === undefined) {
    return [];
  }
  switch (typeof value) {
    case "boolean":
      return [value ? "true" : "false"];
    case "string":
      return [value];
    case "number":
      return [formatNumber(value)];
    case "bigint":
      return [value.toString()];
  }
  if (value instanceof Date) {
    return [rfc3339(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown) => encodeValue(item));
  }
  if (typeof value === "object") {
    if (Object.keys(value).length === 0) {
      return [];
    }
    return [JSON.stringify(sortKeys(value))];
  }
  throw new InvalidRequestError(`cannot send a ${typeof value} as a parameter`);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Go's strconv.FormatFloat(f, 'f', -1, 64): the shortest exact form, no exponent. */
export function formatNumber(n: number): string {
  if (Number.isNaN(n)) {
    return "NaN";
  }
  if (!Number.isFinite(n)) {
    return n > 0 ? "+Inf" : "-Inf";
  }
  if (Object.is(n, -0)) {
    return "-0";
  }
  const text = String(n);
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
  if (!m) {
    return text;
  }
  const [, sign, int, frac = "", exp] = m;
  const digits = int! + frac;
  const point = 1 + Number(exp);
  if (point <= 0) {
    return `${sign}0.${"0".repeat(-point)}${digits}`;
  }
  if (point >= digits.length) {
    return sign + digits + "0".repeat(point - digits.length);
  }
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/** Go's time.RFC3339: seconds precision, "Z" for UTC. */
function rfc3339(d: Date): string {
  if (Number.isNaN(d.getTime())) {
    throw new InvalidRequestError("an invalid Date cannot be sent");
  }
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Merge a path's query string with more pairs, encoded and sorted by key like Go's
 * url.Values.Encode. Values of one key keep their order.
 */
export function buildQuery(existing: string, pairs: Pairs): string {
  const merged = new Map<string, string[]>();
  const add = (key: string, values: string[]) => {
    const list = merged.get(key);
    if (list) {
      list.push(...values);
    } else {
      merged.set(key, [...values]);
    }
  };
  if (existing) {
    for (const part of existing.split("&")) {
      if (!part) {
        continue;
      }
      const eq = part.indexOf("=");
      const key = eq < 0 ? part : part.slice(0, eq);
      const val = eq < 0 ? "" : part.slice(eq + 1);
      add(unescapeQuery(key), [unescapeQuery(val)]);
    }
  }
  for (const [key, value] of pairs) {
    const values = encodeValue(value);
    if (values.length > 0) {
      add(key, values);
    }
  }
  const keys = [...merged.keys()].sort(compareBytes);
  return keys
    .flatMap((k) => merged.get(k)!.map((v) => `${escapeQuery(k)}=${escapeQuery(v)}`))
    .join("&");
}

/** Compare two strings by their UTF-16 code units, like Go's sort of ASCII keys. */
function compareBytes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Encode header pairs. Several values of one header are joined with ",". */
export function buildHeaders(pairs: Pairs): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [key, value] of pairs) {
    const values = encodeValue(value);
    if (values.length === 0) {
      continue;
    }
    const text = values.join(",");
    checkHeader(key, text);
    out.push([key, text]);
  }
  return out;
}

/** Refuse a header that would inject other headers, or that fetch cannot send. */
export function checkHeader(name: string, value: string): void {
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) {
    throw new InvalidRequestError(`header name "${name}" is not valid`);
  }
  if (/[\r\n\0]/.test(value)) {
    throw new InvalidRequestError(`header ${name}: the value has a line break or a NUL`);
  }
  // fetch sends header values as bytes of Latin-1: refuse what it cannot send, here, as an
  // OvhError. Like the other SDKs, only ASCII is accepted.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the range is all of ASCII
  if (/[^\x00-\x7f]/.test(value)) {
    throw new InvalidRequestError(`header ${name}: the value is not ASCII`);
  }
}

/**
 * The JSON text of a request body.
 *
 * A field set to undefined is not sent, and a field set to null is sent as null. A Date is
 * sent in ISO 8601. A Uint8Array is sent as base64, the JSON form of a binary field.
 */
export function encodeBody(body: unknown): string {
  let text: string | undefined;
  try {
    text = JSON.stringify(body, (_key, value: unknown) => {
      if (typeof value === "bigint") {
        return value.toString();
      }
      if (value instanceof Uint8Array) {
        return toBase64(value);
      }
      return value;
    });
  } catch (err) {
    throw new InvalidRequestError(`the body cannot be sent as JSON: ${String(err)}`, {
      cause: err,
    });
  }
  if (text === undefined) {
    throw new InvalidRequestError(`cannot send a ${typeof body} as JSON`);
  }
  return text;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}
