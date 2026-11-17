// SPDX-FileCopyrightText: 2026 OVH SAS
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Iterators over lists: v2 cursor pagination, and v1 lists of IDs.
 *
 * Both are lazy: nothing is requested before the first item is asked for, and the next page
 * or object is requested only when the loop reaches it. Both throw the first error they meet.
 *
 * @module
 */

import { DecodeError, NotFoundError, OvhError } from "./errors.js";
import type { Request } from "./request.js";

/** The most pages one cursor walk reads, so a server that hands out new cursors forever cannot make it loop forever. */
export const MAX_CURSOR_PAGES = 200;

const CURSOR_HEADER = "X-Pagination-Cursor";
const CURSOR_NEXT_HEADER = "X-Pagination-Cursor-Next";

/** Sends one request and gives the body and headers of a 2xx response. */
export type Sender = (
  req: Request,
  signal: AbortSignal | undefined,
) => Promise<[Uint8Array, Headers]>;

/**
 * Yield every item of a v2 list paginated by cursor.
 *
 * The first page is the request as given. Each next page is the same request with the
 * X-Pagination-Cursor header set to the X-Pagination-Cursor-Next of the last response. The
 * walk ends on a response with no X-Pagination-Cursor-Next.
 */
export async function* iterate<T>(
  send: Sender,
  req: Request,
  signal?: AbortSignal,
): AsyncGenerator<T, void, undefined> {
  const base = (req.headers ?? []).filter(([k]) => k.toLowerCase() !== CURSOR_HEADER.toLowerCase());
  let page = req;
  for (let i = 0; i < MAX_CURSOR_PAGES; i++) {
    const [body, headers] = await send(page, signal);
    const items = decodePage(req, body);
    yield* items as T[];
    const cursor = headers.get(CURSOR_NEXT_HEADER) ?? "";
    if (!cursor) {
      return;
    }
    page = { ...req, headers: [...base, [CURSOR_HEADER, cursor]] };
  }
  throw new OvhError(`${req.method} ${req.path}: still paginating after ${MAX_CURSOR_PAGES} pages`);
}

/** A page: a JSON list. An empty body is an empty page. Anything else is an error, like in Go. */
function decodePage(req: Request, body: Uint8Array): unknown[] {
  if (body.length === 0) {
    return [];
  }
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(body));
  } catch (err) {
    throw new DecodeError(`${req.method} ${req.path}: the response is not JSON: ${String(err)}`);
  }
  if (data === null) {
    return [];
  }
  if (!Array.isArray(data)) {
    const kind = typeof data === "object" ? "object" : typeof data;
    throw new DecodeError(`${req.method} ${req.path}: a page is a JSON ${kind}, not a list`);
  }
  return data;
}

/**
 * Yield the object behind every ID a v1 list returns.
 *
 * It calls listIds once, then get for each ID, when the loop asks for the next object. An
 * object that answers 404 was deleted between the list and its fetch: it is skipped.
 */
export async function* each<ID, T>(
  listIds: () => Promise<readonly ID[]>,
  get: (id: ID) => Promise<T>,
): AsyncGenerator<T, void, undefined> {
  for (const id of (await listIds()) ?? []) {
    let obj: T;
    try {
      obj = await get(id);
    } catch (err) {
      if (err instanceof NotFoundError) {
        continue;
      }
      throw err;
    }
    yield obj;
  }
}
