// SPDX-FileCopyrightText: 2026 OVH SAS
//
// SPDX-License-Identifier: Apache-2.0

/**
 * What a client may send: read-only mode and the allow-list of operations.
 *
 * Both are checked before a token is fetched or a byte is sent.
 *
 * @module
 */

import { ConfigurationError, NotAllowedError } from "./errors.js";
import { isReadOnly, type Operation } from "./registry.js";

/** The client's policy. Empty: everything may be sent. */
export class Policy {
  readonly readOnly: boolean;
  /** Operations allowed in read-only mode all the same, as name patterns. */
  readonly readOnlyExcept: readonly RegExp[];
  /** When defined, only operations whose name matches one of these patterns are sent. */
  readonly allowed: readonly RegExp[] | undefined;

  private constructor(
    readOnly: boolean,
    except: readonly RegExp[],
    allowed: readonly RegExp[] | undefined,
  ) {
    this.readOnly = readOnly;
    this.readOnlyExcept = except;
    this.allowed = allowed;
  }

  /** Everything may be sent. */
  static readonly none: Policy = new Policy(false, [], undefined);

  /**
   * Check the client options and return the policy.
   *
   * `readOnly` is true, false, or the patterns of operations allowed all the same.
   */
  static build(
    readOnly: boolean | readonly string[] | undefined,
    allowedOperations: readonly string[] | undefined,
  ): Policy {
    let ro = false;
    let except: RegExp[] = [];
    if (Array.isArray(readOnly)) {
      except = compile("readOnly", readOnly);
      ro = true;
    } else if (readOnly === true) {
      ro = true;
    }
    let allowed: RegExp[] | undefined;
    if (allowedOperations !== undefined) {
      if (allowedOperations.length === 0) {
        throw new ConfigurationError("allowedOperations: no pattern: nothing could be sent");
      }
      allowed = compile("allowedOperations", allowedOperations);
    }
    return new Policy(ro, except, allowed);
  }

  get active(): boolean {
    return this.readOnly || this.allowed !== undefined;
  }

  /**
   * Throw NotAllowedError when the policy refuses the request. op is undefined when the
   * registry does not know the route.
   */
  check(op: Operation | undefined, method: string, path: string): void {
    if (!this.active) {
      return;
    }
    const name = op?.name ?? "";
    const refuse = (reason: string) =>
      new NotAllowedError({ operation: name, method, path, reason });
    if (this.readOnly && !isReadOnly(method) && (!name || !matchAny(this.readOnlyExcept, name))) {
      throw refuse("the client is read-only (readOnly: true)");
    }
    if (this.allowed !== undefined) {
      if (!name) {
        throw refuse(
          "the client only sends listed operations (allowedOperations), and no section of the SDK declares this route",
        );
      }
      if (!matchAny(this.allowed, name)) {
        throw refuse("not in the operations the client may send (allowedOperations)");
      }
    }
  }
}

function compile(option: string, patterns: readonly string[]): RegExp[] {
  return patterns.map((p) => {
    if (typeof p !== "string" || !p.trim()) {
      throw new ConfigurationError(`${option}: an empty pattern`);
    }
    if ((p.match(/\[/g) ?? []).length !== (p.match(/\]/g) ?? []).length) {
      throw new ConfigurationError(`${option}: pattern "${p}": unbalanced brackets`);
    }
    return globToRegExp(p);
  });
}

function matchAny(patterns: readonly RegExp[], name: string): boolean {
  return patterns.some((re) => re.test(name));
}

/**
 * Python's fnmatch.fnmatchcase pattern as a RegExp: "*" is any run of characters, "?" one
 * character, "[seq]" one character of seq, "[!seq]" one character not in seq. Case-sensitive.
 */
export function globToRegExp(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*") {
      re += "[\\s\\S]*";
    } else if (c === "?") {
      re += "[\\s\\S]";
    } else if (c === "[") {
      const end = pattern.indexOf("]", i + 2);
      if (end < 0) {
        re += "\\[";
        continue;
      }
      let body = pattern.slice(i + 1, end);
      const negate = body.startsWith("!");
      if (negate) {
        body = body.slice(1);
      }
      body = body.replace(/[\\\]^]/g, "\\$&");
      re += `[${negate ? "^" : ""}${body}]`;
      i = end;
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`, "u");
}
