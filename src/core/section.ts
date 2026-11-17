// SPDX-FileCopyrightText: 2026 OVH SAS
//
// SPDX-License-Identifier: Apache-2.0

/**
 * The base class of the generated section classes (client.vrack, client.publicCloud...).
 *
 * @module
 */

import type { Client, ClientOverrides } from "./client.js";
import type { RequestOptions, ResultKind } from "./engine.js";
import { each, iterate } from "./pagination.js";
import type { Operation } from "./registry.js";
import { fillPath, type Pairs } from "./request.js";

/** The parameters of one generated call, by where they go. */
export interface CallParams {
  /** Path parameters by wire name. */
  readonly path?: Readonly<Record<string, unknown>>;
  /** Query parameters: an undefined or null value is not sent. */
  readonly query?: Pairs;
  /** Header parameters: an undefined or null value is not sent. */
  readonly headers?: Pairs;
  /** The JSON body. undefined: no body. */
  readonly body?: unknown;
}

/** The operations of one API section. Get it from the client: `client.vrack`. */
export class SectionApi {
  /** The client this section sends its requests with. */
  readonly client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  toString(): string {
    return `${this.constructor.name}(${this.client.toString()})`;
  }

  /**
   * This section on a client with other settings (see Client.withOptions):
   *
   * ```ts
   * await client.vrack.withOptions({ timeout: 5000 }).listVracks();
   * ```
   */
  withOptions(overrides: ClientOverrides): this {
    const ctor = this.constructor as new (client: Client) => this;
    return new ctor(this.client.withOptions(overrides));
  }

  // What the generated methods call.

  /** @internal Call an operation. */
  protected _call<T>(
    op: Operation,
    params: CallParams,
    kind: ResultKind,
    options: RequestOptions | undefined,
  ): Promise<T> {
    return this.client._engine.call(request(op, params), kind, options) as Promise<T>;
  }

  /** @internal Iterate over a v2 list paginated by cursor. */
  protected _pages<T>(
    op: Operation,
    params: CallParams,
    options: RequestOptions | undefined,
  ): AsyncIterable<T> {
    const engine = this.client._engine;
    return iterate<T>(
      (req, signal) => engine.send(req, signal ? { ...options, signal } : options),
      request(op, params),
      options?.signal,
    );
  }

  /** @internal Iterate over the objects behind the IDs of a v1 list. */
  protected _each<ID, T>(
    listIds: () => Promise<readonly ID[]>,
    get: (id: ID) => Promise<T>,
  ): AsyncIterable<T> {
    return each(listIds, get);
  }
}

function request(op: Operation, params: CallParams) {
  return {
    method: op.method,
    path: fillPath(op.path, params.path ?? {}),
    query: params.query ?? [],
    headers: params.headers ?? [],
    body: params.body,
    operation: op,
    schemasVersion: op.schemasVersion,
  };
}
