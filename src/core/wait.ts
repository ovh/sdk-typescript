// SPDX-FileCopyrightText: 2026 OVH SAS
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Waiting for asynchronous work.
 *
 * Many operations only start the work. A v2 resource is created or updated in the background:
 * its resourceStatus moves from CREATING or UPDATING to READY. A v1 operation returns a task
 * whose status moves from todo to done. The wait functions call a GET until the work is over:
 *
 * ```ts
 * const instance = await waitReady(() => client.publicCloud.getInstance(projectId, instanceId));
 * ```
 *
 * They poll every 2 seconds at first, then less often, up to every 30 seconds, and give up
 * after 30 minutes. `poll` and `timeout` change that. A response of 429, 500, 502, 503 or 504
 * is polled again. Any other error stops the wait.
 *
 * @module
 */

import { ApiError, NotFoundError, OvhError, WaitFailedError, WaitTimeoutError } from "./errors.js";

const TRANSIENT = new Set([429, 500, 502, 503, 504]);

// Task statuses across the API. done in either case is success. These end the wait with a
// WaitFailedError. Any other status (todo, doing, init, PENDING, RUNNING...) is polled again.
const TASK_FAILED = new Set([
  "error",
  "ERROR",
  "cancelled",
  "canceled",
  "customerError",
  "ovhError",
  "problem",
  "FAILED",
  "CANCELLED",
]);
// The task waits for someone: polling will not move it on.
const TASK_BLOCKED = new Set(["WAITING_USER_INPUT", "pause", "PAUSED", "standby"]);
const RESOURCE_FAILED = new Set(["ERROR", "SUSPENDED", "DELETED", "REMOVED"]);

/** How a wait polls. Durations are in milliseconds. */
export interface WaitOptions {
  /**
   * [first, longest]: the interval between two polls grows by half at each poll, from first
   * to longest. Default: [2000, 30000].
   */
  poll?: readonly [number, number] | undefined;
  /** Give up after this many milliseconds. 0 waits forever. Default: 30 minutes. */
  timeout?: number | undefined;
  /** Stop waiting when this signal aborts. The wait then throws the signal's reason. */
  signal?: AbortSignal | undefined;
  /** Waits between polls. Tests replace it. */
  sleep?: ((ms: number, signal?: AbortSignal) => Promise<void>) | undefined;
  /** The clock, in milliseconds. Tests replace it. */
  clock?: (() => number) | undefined;
}

const DEFAULT_POLL: readonly [number, number] = [2_000, 30_000];
const DEFAULT_TIMEOUT = 30 * 60_000;

/** Wait ms milliseconds, or less when signal aborts: then throw its reason. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Call get, then done with what it returned, until done returns true.
 *
 * Return get's last value. Throw WaitTimeoutError when the timeout ends first, and any error
 * of get or done that is not transient. Example:
 *
 * ```ts
 * const order = await wait(() => client.me.getOrder(orderId), (o) => o.status === "delivered");
 * ```
 */
export async function wait<T>(
  get: () => Promise<T>,
  done: (value: T) => boolean,
  options: WaitOptions = {},
): Promise<T> {
  let [first, longest] = options.poll ?? DEFAULT_POLL;
  if (!(first > 0)) {
    first = 1_000;
  }
  longest = Math.max(longest, first);
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const pause = options.sleep ?? sleep;
  const clock = options.clock ?? (() => performance.now());
  const start = clock();
  const deadline = timeout > 0 ? start + timeout : undefined;
  let interval = first;
  let last: T | undefined;
  let state = "not read yet";
  for (;;) {
    options.signal?.throwIfAborted();
    try {
      const value = await get();
      last = value;
      if (done(value)) {
        return value;
      }
      state = describe(value);
    } catch (err) {
      if (!(err instanceof ApiError) || !TRANSIENT.has(err.status)) {
        throw err;
      }
      state = err.message;
    }
    const now = clock();
    if (deadline !== undefined && now + interval > deadline) {
      const remaining = deadline - now;
      if (remaining > 0) {
        await pause(remaining, options.signal);
      }
      throw new WaitTimeoutError(
        `gave up waiting after ${duration(clock() - start)}, ${state}`,
        last,
      );
    }
    await pause(interval, options.signal);
    interval = Math.min(interval * 1.5, longest);
  }
}

/**
 * Wait for a v2 resource: until its resourceStatus is READY.
 *
 * ERROR, SUSPENDED, DELETED and REMOVED end the wait with a WaitFailedError. The object must
 * have a resourceStatus field, as the v2 resources of the generated sections have.
 */
export function waitReady<T>(get: () => Promise<T>, options?: WaitOptions): Promise<T> {
  return wait(
    get,
    (value) => {
      const status = statusOf(value, "resourceStatus");
      if (status === "READY") {
        return true;
      }
      if (RESOURCE_FAILED.has(status)) {
        throw new WaitFailedError(`the operation failed: resourceStatus is ${status}`, value);
      }
      return false;
    },
    options,
  );
}

/**
 * Wait for a task: until its status is done (or DONE).
 *
 * A task in error, cancelled, or waiting for an action (WAITING_USER_INPUT, pause, standby)
 * ends the wait with a WaitFailedError. The object must have a status field, as the tasks of
 * the generated sections have:
 *
 * ```ts
 * let task = await client.dedicatedServer.reboot(serviceName);
 * task = await waitTask(() => client.dedicatedServer.getTask(serviceName, task.taskId));
 * ```
 */
export function waitTask<T>(get: () => Promise<T>, options?: WaitOptions): Promise<T> {
  return wait(
    get,
    (value) => {
      const status = statusOf(value, "status");
      if (status === "done" || status === "DONE") {
        return true;
      }
      if (TASK_FAILED.has(status)) {
        throw new WaitFailedError(`the operation failed: the task's status is ${status}`, value);
      }
      if (TASK_BLOCKED.has(status)) {
        throw new WaitFailedError(
          `the operation failed: the task's status is ${status}: it waits for an action`,
          value,
        );
      }
      return false;
    },
    options,
  );
}

/**
 * Wait for a deletion: until get throws NotFoundError (404).
 *
 * ```ts
 * await client.publicCloud.deleteInstance(projectId, instanceId);
 * await waitGone(() => client.publicCloud.getInstance(projectId, instanceId));
 * ```
 */
export async function waitGone(get: () => Promise<unknown>, options?: WaitOptions): Promise<void> {
  await wait(
    async () => {
      try {
        await get();
      } catch (err) {
        if (err instanceof NotFoundError) {
          return true;
        }
        throw err;
      }
      return false;
    },
    (gone) => gone,
    options,
  );
}

/** Read a status field. "" when it is null. */
function statusOf(value: unknown, key: string): string {
  if (value === null || value === undefined) {
    throw new OvhError(`cannot wait on ${value}: no ${key}`);
  }
  if (typeof value !== "object" || !(key in value)) {
    throw new OvhError(`cannot wait on a ${kindOf(value)}: it has no ${key} field`);
  }
  const raw = (value as Record<string, unknown>)[key];
  if (raw === null || raw === undefined) {
    return "";
  }
  if (typeof raw !== "string") {
    throw new OvhError(
      `cannot wait on a ${kindOf(value)}: its ${key} is a ${kindOf(raw)}, not a string`,
    );
  }
  return raw;
}

function kindOf(value: unknown): string {
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

/** Where a wait stands, for the error when it gives up. */
function describe(value: unknown): string {
  for (const key of ["resourceStatus", "status"]) {
    try {
      const status = statusOf(value, key);
      if (status) {
        return `last status ${status}`;
      }
    } catch {
      // no such field
    }
  }
  return "not done yet";
}

/** Go's Duration.Round(time.Second).String(): "30m0s", "1h2m3s", "45s". */
export function duration(ms: number): string {
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours) {
    return `${hours}h${minutes}m${secs}s`;
  }
  if (minutes) {
    return `${minutes}m${secs}s`;
  }
  return `${secs}s`;
}
