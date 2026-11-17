// SPDX-FileCopyrightText: 2026 OVH SAS
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Debug logging of requests and responses, with credentials hidden.
 *
 * The client's `debug` option logs every request and response with its `logger` (default:
 * console.error, so stderr in Node.js).
 *
 * @module
 */

/** Where the client writes its debug logs. */
export type Logger = (message: string) => void;

/** The logger of a client with no logger option: stderr in Node.js. */
export const defaultLogger: Logger = (message) => {
  console.error(message);
};

/** Replaces the value of a header that carries credentials. */
export const REDACTED = "[REDACTED]";

// Headers whose values must never reach the logs, in canonical case.
const SENSITIVE_HEADERS = new Set([
  "Authorization",
  "Proxy-Authorization",
  "Cookie",
  "Set-Cookie",
  // Legacy OVH application key auth. This SDK uses OAuth2, but a caller can still set these
  // with the headers option.
  "X-Ovh-Application",
  "X-Ovh-Consumer",
  "X-Ovh-Signature",
]);

/**
 * Go's http.CanonicalHeaderKey: "x-ovh-consumer" gives "X-Ovh-Consumer".
 *
 * A name with a character that is not valid in a header name is returned as it is.
 */
export function canonicalHeaderKey(name: string): string {
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) {
    return name;
  }
  let out = "";
  let upper = true;
  for (const c of name) {
    out += upper ? c.toUpperCase() : c.toLowerCase();
    upper = c === "-";
  }
  return out;
}

/**
 * Blank the values of credential headers in a dump of a request or response.
 *
 * It changes the text, never the request or response. Only the header block is read:
 * scanning stops at the first empty line, so a body that contains "Authorization: ..." is
 * left as it is.
 */
export function redactDump(dump: string): string {
  const lines = dump.split("\n");
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.replace(/\r$/, "");
    if (!trimmed) {
      break; // end of the header block
    }
    const colon = trimmed.indexOf(":");
    if (colon <= 0) {
      continue;
    }
    const name = canonicalHeaderKey(trimmed.slice(0, colon).trim());
    if (!SENSITIVE_HEADERS.has(name)) {
      continue;
    }
    lines[i] = `${name}: ${REDACTED}${line.endsWith("\r") ? "\r" : ""}`;
  }
  return lines.join("\n");
}

function headerLines(headers: Iterable<[string, string]>): string {
  let text = "";
  for (const [k, v] of headers) {
    text += `${k}: ${v}\r\n`;
  }
  return text;
}

/** The request as HTTP/1.1 text, credentials not hidden yet. */
export function dumpRequest(
  method: string,
  url: URL,
  headers: Iterable<[string, string]>,
  body: string | undefined,
): string {
  let text = `${method} ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.host}\r\n`;
  text += `${headerLines(headers)}\r\n`;
  if (body !== undefined) {
    text += body;
  }
  return text;
}

/** The response as HTTP/1.1 text, with its body when it is not undefined. */
export function dumpResponse(response: Response, body: Uint8Array | undefined): string {
  let text = `HTTP/1.1 ${response.status} ${response.statusText}`.trimEnd();
  text += `\r\n${headerLines(response.headers)}\r\n`;
  if (body !== undefined) {
    text += new TextDecoder().decode(body);
  }
  return text;
}
