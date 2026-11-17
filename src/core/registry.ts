// SPDX-FileCopyrightText: 2026 OVH SAS
//
// SPDX-License-Identifier: Apache-2.0

/**
 * The operation registry: every operation of the SDK, by name and by route.
 *
 * Each generated section has a small `registry` module with its operations. It holds no
 * models, so it is cheap to load. A Registry loads them only when it needs them:
 *
 * - `lookup("vrack.getVrack")` loads the vrack section's registry.
 * - `match`, `all` and the client's policy on a raw call load every section's registry once.
 *
 * The full client knows every operation of the SDK. A client from `@ovhcloud/sdk/core`
 * knows none: like in Go, where only imported packages are known.
 *
 * @module
 */

/**
 * One API operation: its name in the SDK, its route and the IAM actions it needs.
 *
 * The generated methods pass theirs with each request, so an ApiError names the operation,
 * and the `readOnly` and `allowedOperations` options can decide whether to send it.
 */
export interface Operation {
  /**
   * The section and the method a caller uses: "vrack.getVrack". For a list the API paginates
   * by cursor, it is the iterator, the only method that calls it.
   */
  readonly name: string;
  /** The route: "GET", "/v1/vrack/{serviceName}". */
  readonly method: string;
  readonly path: string;
  /** The API's one-line summary of the operation. */
  readonly summary: string;
  /** The IAM actions the caller's policy must allow. */
  readonly iamActions: readonly string[];
  /** True when the API deprecated the operation. */
  readonly deprecated: boolean;
  /**
   * The X-Schemas-Version sent with the request: the /v2 contract the SDK was generated
   * from. undefined for /v1 routes.
   */
  readonly schemasVersion?: string | undefined;
}

/** True for GET and HEAD: an operation that only reads. */
export function isReadOnly(method: string): boolean {
  const m = method.toUpperCase();
  return m === "GET" || m === "HEAD";
}

/** "vrack.getVrack (GET /v1/vrack/{serviceName})". */
export function describeOperation(op: Operation): string {
  return `${op.name} (${op.method} ${op.path})`;
}

/** Loads the operations of one section, on first use. */
export type SectionLoader = () => Promise<readonly Operation[]>;

/** Operations by name and by route, with sections loaded on first use. */
export class Registry {
  readonly #byName = new Map<string, Operation>();
  // Each HTTP method's operations, with their path split on "/".
  readonly #byRoute = new Map<string, Array<[string[], Operation]>>();
  readonly #loaders: ReadonlyMap<string, SectionLoader>;
  readonly #loading = new Map<string, Promise<void>>();

  /** A registry of these sections: loaders by section name (the first part of a name). */
  constructor(loaders: Readonly<Record<string, SectionLoader>> = {}) {
    this.#loaders = new Map(Object.entries(loaders));
  }

  /** Add operations. An operation registered again under the same name replaces the first. */
  register(...ops: readonly Operation[]): void {
    for (const op of ops) {
      const old = this.#byName.get(op.name);
      if (old) {
        const routes = this.#byRoute.get(old.method) ?? [];
        this.#byRoute.set(
          old.method,
          routes.filter(([, o]) => o !== old),
        );
      }
      this.#byName.set(op.name, op);
      const routes = this.#byRoute.get(op.method);
      const entry: [string[], Operation] = [op.path.split("/"), op];
      if (routes) {
        routes.push(entry);
      } else {
        this.#byRoute.set(op.method, [entry]);
      }
    }
  }

  /** Load the registry of one section. Unknown sections are ignored. */
  #load(section: string): Promise<void> {
    let p = this.#loading.get(section);
    if (!p) {
      const loader = this.#loaders.get(section);
      p = loader ? loader().then((ops) => this.register(...ops)) : Promise.resolve();
      // A failed load is tried again on the next call.
      p.catch(() => this.#loading.delete(section));
      this.#loading.set(section, p);
    }
    return p;
  }

  #loadAll(): Promise<unknown> {
    return Promise.all([...this.#loaders.keys()].map((s) => this.#load(s)));
  }

  /** Every operation, sorted by name. */
  async all(): Promise<Operation[]> {
    await this.#loadAll();
    return [...this.#byName.values()].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
  }

  /** The operation of that name, "vrack.getVrack", or undefined. */
  async lookup(name: string): Promise<Operation | undefined> {
    const dot = name.indexOf(".");
    if (dot > 0) {
      await this.#load(name.slice(0, dot));
    }
    return this.#byName.get(name);
  }

  /**
   * The operation a request with that method and path calls, or undefined.
   *
   * `GET /v1/vrack/pn-12345` gives vrack.getVrack. A route with fewer parameters wins over
   * one with more: /v1/me/bill matches GET /v1/me/bill, not GET /v1/me/{id}. A query string is
   * ignored.
   */
  async match(method: string, path: string): Promise<Operation | undefined> {
    await this.#loadAll();
    const segments = path.split("?", 1)[0]!.split("/");
    let best: Operation | undefined;
    let bestParams = -1;
    for (const [route, op] of this.#byRoute.get(method.toUpperCase()) ?? []) {
      const params = matchSegments(route, segments);
      if (params !== undefined && (best === undefined || params < bestParams)) {
        best = op;
        bestParams = params;
      }
    }
    return best;
  }
}

/**
 * Match a path against a route. A {name} segment matches any non-empty segment. Return the
 * number of parameters used, or undefined.
 */
function matchSegments(route: readonly string[], path: readonly string[]): number | undefined {
  if (route.length !== path.length) {
    return undefined;
  }
  let params = 0;
  for (let i = 0; i < route.length; i++) {
    const want = route[i]!;
    const got = path[i]!;
    if (want.startsWith("{") && want.endsWith("}")) {
      if (!got) {
        return undefined;
      }
      params++;
    } else if (want !== got) {
      return undefined;
    }
  }
  return params;
}
