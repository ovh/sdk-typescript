# OVHcloud TypeScript SDK

[![npm version](https://img.shields.io/npm/v/@ovhcloud/sdk.svg)](https://www.npmjs.com/package/@ovhcloud/sdk)
[![API reference](https://img.shields.io/badge/API_reference-jsDocs.io-blue.svg)](https://www.jsdocs.io/package/@ovhcloud/sdk)

The TypeScript SDK for the [OVHcloud API](https://developers.eu.ovhcloud.com/): a typed method
for every public operation, with OAuth2 service-account authentication, retries, typed errors
and async iterators over lists. No runtime dependency: it runs on Node.js, Deno and Bun.

**Status:** maintained by OVHcloud. Most of the code under `src/api/` is generated from the
API's OpenAPI specifications at each release. Read [CONTRIBUTING.md](CONTRIBUTING.md) before
you propose a change.

- [1. Install](#1-install)
- [2. Your first program](#2-your-first-program)
  - [Coming from node-ovh](#coming-from-node-ovh)
- [3. Finding the operation you need](#3-finding-the-operation-you-need)
- [4. Calling an operation](#4-calling-an-operation)
- [5. Lists and pagination](#5-lists-and-pagination)
- [6. Handling errors](#6-handling-errors)
- [7. Configuration reference](#7-configuration-reference)
- [8. Calling any endpoint](#8-calling-any-endpoint)
- [9. Smaller bundles](#9-smaller-bundles)
- [10. Testing your code](#10-testing-your-code)
- [11. Observability](#11-observability)
- [12. Troubleshooting](#12-troubleshooting)

---

## 1. Install

Node.js 22.12 or later (tested on 22, 24 and 26), Deno 2 or Bun. The package is an ES module.

```shell
npm install @ovhcloud/sdk     # Node.js
deno add npm:@ovhcloud/sdk    # Deno
bun add @ovhcloud/sdk         # Bun
```

The package is [`@ovhcloud/sdk` on npm](https://www.npmjs.com/package/@ovhcloud/sdk).

You also need OAuth2 credentials: the client ID and secret of a service account.

1. Create the service account in the OVHcloud Control Panel or with the API:
   [Managing OVHcloud service accounts](https://docs.ovhcloud.com/en/guides/manage-and-operate/api/manage-service-account).
   The secret is shown once: save it.
2. Give it the permissions your program needs with an IAM policy:
   [How to use IAM policies using the OVHcloud Control Panel](https://docs.ovhcloud.com/en/guides/account-and-service-management/account-information/iam-policy-ui),
   or [using the API](https://docs.ovhcloud.com/en/guides/account-and-service-management/account-information/iam-policies-api).

Keep the client ID and secret out of your source code: read them from the environment.

### Servers and scripts only

The SDK runs where your secret stays private: a server, a script, a CI job, a serverless
function. Do not use it in a web page or a mobile app: anyone can read their code, so anyone
could take the secret and act on your account with all its permissions.

For a web application, call the SDK from your own backend, and give the browser only what
it needs.

### Run it

| Runtime | Command | Notes |
|---|---|---|
| Node.js 22.18+ | `node main.ts` | Node.js runs TypeScript as it is. Before 22.18, compile with `tsc` first. |
| Deno 2 | `deno run --allow-net=api.eu.ovhcloud.com,www.ovh.com --allow-env=OVH_CLIENT_ID,OVH_CLIENT_SECRET,OVH_REGION main.ts` | The API host and the token host of your region (see [Choosing your region](#choosing-your-region)). Without `--allow-env`, the SDK sees no credentials. |
| Bun | `bun main.ts` | |
| Edge workers | your platform's tool | No environment variables: pass the credentials, as below. |

Where there is no `process.env` (Cloudflare Workers, other edge runtimes), give the
credentials and the region to the client. The SDK uses web APIs only (`fetch`,
`AbortSignal`). Its tests run on Node.js, Deno and Bun.

```ts
import { Client } from "@ovhcloud/sdk";

export default {
  async fetch(_request: Request, env: { OVH_CLIENT_ID: string; OVH_CLIENT_SECRET: string }) {
    const client = new Client({
      clientId: env.OVH_CLIENT_ID,
      clientSecret: env.OVH_CLIENT_SECRET,
      region: "eu",
    });
    return Response.json(await client.me.getAccountDetails());
  },
};
```

### TypeScript settings

The package describes its entry points with `exports`, so TypeScript must read them. In your
`tsconfig.json`, use one of:

- `"module": "nodenext"` (it implies `"moduleResolution": "nodenext"`), for Node.js.
- `"module": "preserve"` or `"esnext"` with `"moduleResolution": "bundler"`, with a bundler,
  Deno or Bun.

Not `"moduleResolution": "node"` (or `"node10"`): it ignores `exports`, and TypeScript
does not find `@ovhcloud/sdk/api/vrack`. You do not need `"lib": ["dom"]` when `@types/node`
is installed.

### CommonJS

The package is an ES module. From Node.js 22.12, a CommonJS program can `require` it:

```js
const { Client } = require("@ovhcloud/sdk");
```

In a CommonJS TypeScript project, set `"module": "nodenext"`, with TypeScript 5.8 or later.
Older TypeScript versions refuse `require` of an ES module (error TS1479).

---

## 2. Your first program

This prints the details of your account: `GET /v1/me`. Copy it, set your credentials,
run it.

```ts
import { Client } from "@ovhcloud/sdk";

const client = new Client(); // reads OVH_CLIENT_ID, OVH_CLIENT_SECRET, OVH_REGION

const account = await client.me.getAccountDetails(); // GET /v1/me
console.log("account:", account.nichandle);
console.log("email:  ", account.email);
console.log("country:", account.country);
```

```shell
export OVH_CLIENT_ID=...  OVH_CLIENT_SECRET=...
export OVH_REGION=eu    # eu (default), ca or us
node first.ts           # Node.js 22.18 or later runs TypeScript as it is
```

More examples: [examples/](examples/README.md).

Create **one** client and share it: it reuses the token between calls. Each API section is a
property of the client (`client.me`), built the first time you use it.

### Choosing your region

Your account lives in one region. `OVH_REGION` (or `new Client({ region: "ca" })`) picks both
the API host and the token endpoint, which must agree: a token from one region is refused by
the others.

| Region | `region` | API |
|---|---|---|
| Europe | `"eu"` | `https://api.eu.ovhcloud.com` |
| Canada | `"ca"` | `https://api.ca.ovhcloud.com` |
| US | `"us"` | `https://api.us.ovhcloud.com` |

### Coming from node-ovh

This SDK is not [node-ovh](https://github.com/ovh/node-ovh) (`npm install ovh`,
`require("ovh")`). It is a new package. The main differences:

- **Package:** `@ovhcloud/sdk`, then `import { Client } from "@ovhcloud/sdk"`.
- **Credentials:** an OAuth2 service account (`OVH_CLIENT_ID`, `OVH_CLIENT_SECRET`). There is
  no application key, application secret or consumer key. See [Install](#1-install) to
  create one.
- **Region:** `OVH_REGION=eu`, `ca` or `us`, instead of the endpoint `ovh-eu`, `ovh-ca` or
  `ovh-us`.
- **Paths** start with their API version: `/v1/me`, not `/me` or `/1.0/me`. A path without
  `/v1/` or `/v2/` is refused with `InvalidRequestError`, with a hint:
  `did you mean /v1/me?`.
- **Typed methods** replace most raw calls. `client.get` still exists for a route with no
  method yet. A body is the second argument: `client.post(path, body)`.
- **Errors** are classes: `instanceof NotFoundError`, not a check of `err.error === 404`.

| node-ovh | This SDK |
|---|---|
| `require("ovh")({ endpoint: "ovh-eu", appKey, appSecret, consumerKey })` | `new Client({ region: "eu", clientId, clientSecret })` |
| `await ovh.requestPromised("GET", "/me")` | `await client.me.getAccountDetails()`, or `await client.get("/v1/me")` |
| `await ovh.requestPromised("GET", "/me/sshKey")` | `await client.me.listSshKeys()` |
| `await ovh.requestPromised("POST", "/me/contact", { email })` | `await client.post("/v1/me/contact", { email })` |
| `ovh.request("GET", "/me", (err, me) => ...)` | `await`: every method returns a Promise |
| an error with `error: 404` | `NotFoundError`, an `ApiError` with `status` 404 |

To find the method of a route you called with node-ovh, add `/v1` in front of the path and
look it up in the index (see [section 3](#3-finding-the-operation-you-need)).

---

## 3. Finding the operation you need

The SDK follows the OVHcloud API: about 80 **sections**, each one a client property and a
subpath of the package, `@ovhcloud/sdk/api/<section>`.

To see what the API offers, browse the
[API reference](https://developers.eu.ovhcloud.com/reference/) on the OVHcloud developer hub:
every operation, by product, with its route, parameters and responses. Its groups do not
match the SDK's sections one to one: take the route and find its method as below. The hub
writes a v1 route `/1.0/vrack`. The SDK writes it `/v1/vrack`.

### Guess the name from the URL

Method names follow the URL path, without the section's own prefix:

| Route | Method |
|---|---|
| `GET /vrack` (a list) | `client.vrack.listVracks` |
| `GET /vrack/{serviceName}` | `client.vrack.getVrack` |
| `PUT /vrack/{serviceName}` | `client.vrack.updateVrack` |
| `POST /vrack/{serviceName}/cloudProject` | `client.vrack.createCloudProject` |
| `DELETE /vrack/{serviceName}/cloudProject/{project}` | `client.vrack.deleteCloudProject` |

Path parameters are not in the name: they are arguments.

### TypeScript names

| API | TypeScript |
|---|---|
| section `publicCloud` | `client.publicCloud`, `@ovhcloud/sdk/api/publicCloud` |
| route `/ip/{ip}/dnsUrl` | method `getDnsUrl` |
| parameter `serviceName` | argument `serviceName` |
| property `ipAddress` | property `ipAddress`: the API's own name, never changed |
| schema `dedicated.server.ipBlock` | type `DedicatedServerIPBlock` |
| enum value `NETWORK_ATTACK` | member `NETWORK_ATTACK` of the enum's const object |
| a reserved word, `default` | argument `default_` |

Method and type names are the same as in the OVHcloud Go and Python SDKs, in TypeScript's
case. They are kept from release to release: a route keeps its method name even when a new
route would make another name better.

### Look up the route in the index

The surest way. The SDK ships an operation index: one file per section,
`index/<section>.jsonl`, with one line per method. It is in this repository, and in the
installed package (`node_modules/@ovhcloud/sdk/index/`).

```shell
grep -h '"path":"/v1/vrack/{serviceName}"' node_modules/@ovhcloud/sdk/index/*.jsonl
```

```json
{"section":"vrack","method":"getVrack","kind":"call","http":"GET","path":"/v1/vrack/{serviceName}","summary":"Get a vRack. Returns the name and description of the vRack.","signature":"getVrack(serviceName: string, options?: RequestOptions): Promise<models.VrackVrackWithIAM>","iam":["vrack:apiovh:get"],"id":"vrack.getVrack","import":"@ovhcloud/sdk/api/vrack"}
```

[index/README.md](index/README.md) describes the fields. `iam` lists the IAM actions the call
needs. Collect the `iam` of the methods your program calls: they are what its service account
needs in its IAM policy. To find the methods that need one action:

```shell
grep -h '"vrack:apiovh:get"' node_modules/@ovhcloud/sdk/index/*.jsonl
```

If you do not know where the package is (pnpm, workspaces), ask Node.js:
`node -p 'require.resolve("@ovhcloud/sdk/package.json")'`. The package also exports its docs:
`@ovhcloud/sdk/llms.txt`, `@ovhcloud/sdk/AGENTS.md` and `@ovhcloud/sdk/index/<section>.jsonl`.

### Search by URL path

Every method's doc comment starts with its HTTP method and route, so searching for the route
always works, even when the name is not what you guessed:

```shell
grep -rh --include=api.d.ts "calls GET /v1/cloud/project/{serviceName}/instance:" \
    node_modules/@ovhcloud/sdk/
```

```
* listProjectInstances calls GET /v1/cloud/project/{serviceName}/instance: Get instance
```

Routes carry their API version: `/v1/...` or `/v2/...`.

### Find the fields of a type

A signature names its types as `models.X`. They are in `dist/api/<section>/models.d.ts` of
the package, with their fields, which ones are required, and the enum values:

```shell
grep -n -A 30 'export interface VrackVrackWithIAM ' node_modules/@ovhcloud/sdk/dist/api/vrack/models.d.ts
```

Your editor shows the same when you hover a type.

### Look up one method

Every method's doc comment starts with its route, so your editor shows it when you hover the
method:

```text
getVrack calls GET /v1/vrack/{serviceName}: Get a vRack. Returns the name and description of the vRack.
```

### At run time

`await lookupOperation("vrack.getVrack")` gives an operation's route, summary and IAM actions.
`await matchOperation("GET", "/v1/vrack/pn-1")` finds the operation of a concrete path.
`await operations()` lists them all.

---

## 4. Calling an operation

Arguments come in a fixed order: the path parameters, then any required query parameters, then
the request body. Optional parameters come after them, in one object. The last argument is
the options of the call. A call returns a Promise of the result, or rejects with an error.

```ts
const vrack = await client.vrack.getVrack("pn-123456");

const task = await client.vrack.createCloudProject("pn-123456", { project: "0123456789abcdef" });
```

**Optional parameters** are one object. Leave it out when you need none:

```ts
let ids = await client.vrack.listVracks(); // no filter
ids = await client.vrack.listVracks({ iamTags: { env: [{ operator: "EQ", value: "prod" }] } });
```

**Options of a call** come last: an `AbortSignal`, a timeout, headers.

```ts
await client.vrack.getVrack("pn-123456", { timeout: 5_000, signal: controller.signal });
```

**Types** describe the JSON the API sends and takes, with its own property names. Import them
from the section's subpath:

```ts
import type { VrackVrack } from "@ovhcloud/sdk/api/vrack";
```

The SDK decodes nothing: a response is the JSON the API sent. Dates are strings (ISO 8601),
and numbers are JavaScript numbers. A property you do not set in a body is not sent. A
property you set to `null` is sent as `null`. A field's doc says when it is an ISO 8601
date, or an int64 that can lose precision in a JavaScript number.

**Enums are open.** OVHcloud adds enum values often. An enum is a type and a const object of
the same name. Its type accepts the values the SDK knows, and any other string, so a value
this SDK version does not know yet never breaks your program:

```ts
import { CommonResourceStatusEnum } from "@ovhcloud/sdk/api/publicCloud";

const instance = await client.publicCloud.getInstance(projectId, instanceId);
if (instance.resourceStatus === CommonResourceStatusEnum.READY) {
  // ...
}
```

### Request bodies have no read-only fields

The API sets some fields itself: an ID, a creation date, a status. A type the API returns has
them, and their doc says `Read-only: the API sets it.` A request body never has them. A body
whose type has read-only fields takes that type's **writable** form instead, named with
`Writable` after it.

To change an object, get it, leave out the read-only fields, change what you need, then send
it:

```ts
const env = await client.hostingweb.getEnvVar("example.com", "API_URL"); // HostingWebEnvVarAlt
const { key, status, taskId, type, ...body } = env; // body: HostingWebEnvVarWritable
const task = await client.hostingweb.updateEnvVar("example.com", "API_URL", {
  ...body,
  value: "https://api.example.com",
});
```

You can also send only the fields you change: `{ value: "https://api.example.com" }`.

TypeScript checks only the shape of a body. An object literal with a read-only field is an
error. But `env` itself, passed as it is, compiles, and sends its read-only fields back:
some routes refuse them with a 400, others ignore them. Leave them out as above.

This removes the top-level read-only fields only. A nested object keeps its own read-only
fields. Rebuild it from its `Writable` type too, or send only the fields you change. A type
built with `allOf` (from several parts) keeps all its read-only fields, even in a `Writable`
type: its doc comment still says "Read-only" on each one, so leave those out by hand.

### Waiting for the work to finish

Many operations only start the work. A v2 resource comes back `CREATING` or `UPDATING` and
becomes `READY` later. Many v1 operations return a task that moves from `todo` to `done`.
Instead of sleeping in a loop, wait with the GET of the same object:

```ts
import { waitReady } from "@ovhcloud/sdk";

let instance = await client.publicCloud.createInstance(projectId, spec);
instance = await waitReady(() => client.publicCloud.getInstance(projectId, instance.id));
```

| Function | Polls until |
|---|---|
| `waitReady(get)` | the object's `resourceStatus` is `READY` (v2 resources) |
| `waitTask(get)` | the task's `status` is `done` or `DONE` |
| `waitGone(get)` | `get` rejects with `NotFoundError`, after a deletion |
| `wait(get, done)` | your `done` function returns `true` |

They poll every 2 seconds at first, then less often, up to every 30 seconds, and give up after
30 minutes with `WaitTimeoutError` (options: `timeout`, `poll: [first, longest]` in
milliseconds, `signal`). A failed status (a resource in `ERROR`, a task in error, cancelled, or
waiting for an action) throws `WaitFailedError`. A 429 or a 5xx is polled again. Any other
error stops the wait. Both errors carry the last value read, in `last`.

### `list` and `all`

Many v1 lists return identifiers only. Their `all` twin is an async iterator over the
objects: it lists the identifiers, then gets each object when your loop reaches it.

```ts
const ids = await client.me.listSshKeys(); // string[]

for await (const key of client.me.allSshKeys()) {
  console.log(key.keyName);
}
```

Each object is one request, so a list of 900 items is 901 requests. `break` stops them. An
object deleted between the list and its fetch is skipped. Any other error is thrown, and ends
the loop.

### Deprecated operations

The API deprecates operations before it removes them. Their doc comment says so, with the
removal date and the route to use instead when the API gives them. Editors show them struck
out. They still work, and never warn at run time.

---

## 5. Lists and pagination

v2 lists are paginated by cursor. Their only method is an `all` async iterator: it gets the
next page only when your loop needs it.

```ts
for await (const project of client.publicCloud.allProjects()) {
  console.log(project.id);
}

const all = await Array.fromAsync(client.publicCloud.allProjects()); // every page
```

There is no method that loads every page at once: `Array.fromAsync` does it when you need it.
A walk stops after 200 pages, so a broken cursor cannot loop forever.

---

## 6. Handling errors

Every error of the SDK is an `OvhError`. An error status from the API is an `ApiError`, or one
of its subclasses for the common statuses:

| Status | Error |
|---|---|
| 400 | `BadRequestError` |
| 401 | `UnauthorizedError` |
| 403 | `ForbiddenError` |
| 404 | `NotFoundError` |
| 409 | `ConflictError` |
| 429 | `TooManyRequestsError` |
| other | `ApiError` |

```ts
import { ApiError, NotFoundError } from "@ovhcloud/sdk";

try {
  await client.vrack.getVrack("pn-999");
} catch (err) {
  if (err instanceof NotFoundError) {
    console.log("no such vRack");
  } else if (err instanceof ApiError) {
    console.log(err.status, err.apiMessage, err.queryId);
  } else {
    throw err;
  }
}
```

The message is the API's own, with the operation and, on a 401 or 403, the IAM actions the
call needs:

```text
vrack.getVrack: GET /v1/vrack/pn-1: 403 Forbidden: This call has not been granted (Client::Forbidden); requires the IAM action vrack:apiovh:get
```

Every `ApiError` has these fields:

| Field | Meaning |
|---|---|
| `status`, `statusLine` | the HTTP status: `403`, `"403 Forbidden"` |
| `operation` | the method's name, `"vrack.getVrack"`: what `readOnly` and `allowedOperations` match |
| `iamActions` | the IAM actions the operation needs. On a 403, report them to whoever manages the service account. |
| `method`, `path` | the request |
| `errorClass` | the API's error class: `"Client::Forbidden"` |
| `apiMessage` | the API's message, alone |
| `queryId` | the `X-Ovh-Queryid` of the call: give it to OVHcloud support |
| `bodyText`, `body` | the response body, as text and as bytes |

`JSON.stringify(err)` gives the message and these fields, with the body as text, so a logger
prints a useful line.

| Error | When |
|---|---|
| `ConfigurationError` | the client cannot be created: no credentials, an unknown region |
| `TokenError` | the token endpoint refused the credentials, did not answer in time, answered with more than 1 MiB, or could not be reached. The message never holds the secret. |
| `TransportError` | no response, or the body could not be read: connection refused, DNS, TLS. Never retried. fetch's error is the `cause`. |
| `RequestTimeoutError` | a `TransportError`: the request took more than its `timeout`. Never retried: the server may have done the work. Match it with `instanceof`, its `name` is not `"TimeoutError"`. |
| `InvalidRequestError` | refused before sending: a path without `/v1/` or `/v2/`, an empty path parameter, a `.` or `..` path segment, a `%` that does not start an escape, a header value that is not ASCII |
| `NotAllowedError` | refused by `readOnly` or `allowedOperations`. Nothing was sent. |
| `DryRunError` | not sent because of `dryRun`. It holds what would have been sent. Not a failure. |
| `HookRefusedError` | refused by a `beforeRequest` hook. Nothing was sent. What the hook threw is the `cause`. |
| `ResponseTooLargeError` | the body is larger than `maxResponseBytes` |
| `DecodeError` | a 2xx body is not JSON, or a page of a list is not a list |
| `WaitFailedError`, `WaitTimeoutError` | a wait ended in a failure, or gave up |

A call you abort with its `signal` rejects with the signal's reason, as `fetch` does.

---

## 7. Configuration reference

The options of `new Client({...})` win over the environment. Durations are in milliseconds.

| Option | Default | Meaning |
|---|---|---|
| `region` | `OVH_REGION`, else `"eu"` | `"eu"`, `"ca"` or `"us"` |
| `clientId`, `clientSecret` | `OVH_CLIENT_ID`, `OVH_CLIENT_SECRET` | an OAuth2 service account |
| `tokenSource` | | your own tokens: an object with a `token()` method |
| `endpoint` | the region's API | another base URL, for a proxy or a test server. No version suffix. |
| `timeout` | none | milliseconds a request may take, from sending it to the end of the body. Each retry has its own. The timeout given to `new Client()` also bounds the token request. `withOptions` and a per-call timeout do not change the token request. |
| `retry` | off | `true`, or a `RetryPolicy` |
| `retrySleep` | a timer | how to wait between retries: `async () => {}` in tests |
| `maxResponseBytes` | no limit | fail, never truncate, past this size |
| `readOnly` | `false` | `true`: only `GET` and `HEAD`. A list of patterns: also these operations. |
| `allowedOperations` | all | only the operations whose name matches: `["vrack.*", "*.get*"]` |
| `dryRun` | `false` | send reads (`GET`, `HEAD`) as usual. Do not send anything else: throw a `DryRunError` with the URL and body it would have sent. |
| `beforeRequest` | | a hook, or a list, run before each call: to log it, or to refuse it by throwing |
| `afterRequest` | | a hook, or a list, run after each call, with its status, query ID, error, duration and number of attempts |
| `debug`, `debugBodies` | off | log requests with `logger` (see below) |
| `logger` | `console.error` | where debug logs go |
| `userAgent` | | your product, added after the SDK's: `"my-tool/1.2"` |
| `headers` | | headers sent with every request |
| `fetch` | the global `fetch` | your own fetch: for a proxy, a private CA, mutual TLS, or tests |
| `fetchOptions` | | options added to every request, such as an undici `dispatcher` |

`client.withOptions({ timeout: 5_000 })` gives a client with other settings, sharing the
token. So does `client.vrack.withOptions(...)` for one section.

**Retries** are off by default. `retry: true` retries up to 3 attempts, waiting 3 to 30
seconds. Only `GET`, `HEAD` and `DELETE` are retried, on 429, 503 and 504, and a `Retry-After`
header is followed. `POST`, `PUT` and `PATCH` are never retried: on this API they can start
tasks or place orders.

**Token requests.** The SDK gets the OAuth2 token of `clientId` and `clientSecret` with the
`timeout` of the client, or 30 seconds when there is none. A token response larger than 1 MiB
is a `TokenError`.

**Redirects are not followed.** The API does not redirect. A `3xx` comes back as an
`ApiError`, so you see it. Following it would send the request, and its token, to a route
that `readOnly` and `allowedOperations` did not check.

**Planning changes with a dry run.** With `dryRun: true`, a program reads the real state of the
account, but changes nothing. A call that would change something is not sent. It throws a
`DryRunError` that holds what would have been sent:

```ts
import { Client, DryRunError } from "@ovhcloud/sdk";

const client = new Client({ dryRun: true });
try {
  await client.vrack.createCloudProject("pn-1", { project: "0123456789abcdef" });
} catch (err) {
  if (err instanceof DryRunError) {
    console.log(err.method, err.url, err.body);
  } else {
    throw err;
  }
}
```

```text
POST https://api.eu.ovhcloud.com/v1/vrack/pn-1/cloudProject {"project":"0123456789abcdef"}
```

Printed, the error itself reads:

```text
DryRunError: vrack.createCloudProject (POST https://api.eu.ovhcloud.com/v1/vrack/pn-1/cloudProject) not sent: dry run
```

`operation` is the method's name (`""` when the route is unknown), `url` is the full URL with
its query, `headers` the headers, and `body` the JSON body. No OAuth2 token is fetched for such
a call, and the credential headers (`Authorization`, `Cookie`...) are left out. It is never
retried. The policy still applies first: with `readOnly` or `allowedOperations`, a refused
call stays a `NotAllowedError`.

**Watching every call with hooks.** A hook sees every call the client makes, with the operation
it calls. Use it to keep an audit log, or to refuse some calls:

```ts
const client = new Client({
  beforeRequest: (call) => {
    if (call.operation?.deprecated) {
      throw new Error(`${call.operation.name} is deprecated`);
    }
  },
  afterRequest: (call, r) => {
    console.log(
      `${call.method} ${call.path}: ${r.status} in ${r.duration}ms (${r.attempts} attempts, query ${r.queryId})`,
      r.error ?? "",
    );
  },
});
```

- A `CallInfo` has the `operation` (undefined when the route is unknown), `method`, `path`,
  `query`, `body`, `readOnly` (true for `GET` and `HEAD`) and the call's `signal`. It never
  holds the token.
- A before hook runs once per call, just before it is sent. Retries do not run it again. If it
  throws, nothing is sent, and the call throws a `HookRefusedError` whose `cause` is what the
  hook threw.
- An after hook runs once per call, after the retries. It also sees the calls that were not
  sent: refused by the policy or by a before hook, malformed, or stopped by a dry run. Then
  `status` and `attempts` are 0. `error` is undefined on success.
- Several hooks run in the order they were given. A hook may be async: the call waits for it.
- Calls made at the same time interleave: an async hook may run for one call while another
  call waits on it. Do not assume calls come one at a time.
- If an after hook throws, its error replaces the result of the call, and the hooks after it
  do not run. Catch your own errors in a hook.
- Each page of an `all...` iterator is a separate call, so the hooks run once per page.
- `withOptions` keeps the hooks and the dry run.

In one call, the steps run in this order: find the operation, check the request, check
`readOnly` and `allowedOperations`, run the before hooks, stop if it is a dry run, then send.
The after hooks run last, whatever happened.

**Proxy, private CA, mutual TLS.** The SDK uses `fetch`. In Node.js, give it a dispatcher of
[undici](https://undici.nodejs.org/):

```ts
import { Agent, ProxyAgent } from "undici";
import { readFileSync } from "node:fs";

const client = new Client({
  fetchOptions: {
    dispatcher: new Agent({
      connect: { ca: readFileSync("ca.pem"), cert: readFileSync("me.pem"), key: readFileSync("me.key") },
    }),
  } as RequestInit,
});
// Or: new ProxyAgent("http://proxy:3128"). Node.js 24 also follows HTTPS_PROXY and NO_PROXY
// when NODE_USE_ENV_PROXY=1 is set.
```

**Debug logs** go to `logger`, `console.error` by default:

```ts
const client = new Client({ debug: true });
```

Credential headers are always hidden. `debugBodies: true` adds the bodies, which often hold
secrets: use it only on test data.

**X-Schemas-Version.** The v2 API serves several versions of its contract. The SDK sends, with
every v2 request, the version its types were generated from, so your account's own setting
does not change what the SDK receives.

---

## 8. Calling any endpoint

The sections are a convenience over one call, which you can make yourself, for a route newer
than your SDK version for example. It returns the JSON as it came:

```ts
const me = await client.get("/v1/me");
await client.post("/v1/me/contact", { email: "ops@example.com" });
for await (const policy of client.iterate("/v2/iam/policy")) {
  console.log(policy); // a v2 list, page by page
}
```

- Build a path with values in it with `path`. It escapes each value. Without it,
  `1.2.3.0/24` in a template string calls another route:

  ```ts
  import { path } from "@ovhcloud/sdk";

  const ip = await client.get(path("/v1/ip/{ip}", { ip: "1.2.3.0/24" })); // GET /v1/ip/1.2.3.0%2F24
  ```

- Give the type you expect: `client.get<T>`, `post<T>`, `iterate<T>`. The default is
  `unknown`. Nothing checks it at run time: the result is the JSON the API sent, whatever the
  type says. A section's own types work too:

  ```ts
  import type { IPIPWithIAM } from "@ovhcloud/sdk/api/ip";

  const block = await client.get<IPIPWithIAM>(path("/v1/ip/{ip}", { ip }));
  ```

- The body is the second argument of `post`, `put` and `patch`. With
  `client.request(method, path, options)`, it goes in `options.body`.
- The path starts with `/v1/` or `/v2/`. `/me` or `/1.0/me` is refused before it is sent.

The client's policy, retries, errors and debug logs apply the same way.
[examples/raw-call.ts](examples/raw-call.ts) is a full program.

The path is sent as you give it, already escaped. Any character a path cannot hold is
percent-encoded: a `#` is part of the path, sent as `%23`, and never a fragment. A `\` is sent
as `%5C`, never as a `/`. A `%` must start an escape such as `%2F`, or the call is an
`InvalidRequestError`.

---

## 9. Smaller bundles

The client of `@ovhcloud/sdk` has every section. A bundler cannot leave out the ones you do
not use. When the size matters (a serverless function, an edge worker), take the core client
and the sections you need:

```ts
import { Client } from "@ovhcloud/sdk/core";
import { VrackApi } from "@ovhcloud/sdk/api/vrack";

const vrack = new VrackApi(new Client());
console.log(await vrack.listVracks());
```

Such a client knows only the operations of the sections you imported: with
`allowedOperations`, a raw call (`client.get`) to another section is refused.

---

## 10. Testing your code

Your tests do not need the network or real credentials. Give the client a fixed token and
your own `fetch`:

- `tokenSource: new StaticTokenSource("test-token")`: no credentials, and no call to the token
  endpoint.
- `fetch`: your function gets a `URL` and the request's `init`, and returns a `Response`. The
  URL is the region's API host with the versioned path: `https://api.eu.ovhcloud.com/v1/me`,
  or the host of `region`. `endpoint` points the client at a test server instead.
- `retrySleep: async () => {}`, if you use `retry`: a mocked `503` is retried at once.

With [Vitest](https://vitest.dev/):

```ts
import { Client, NotFoundError, StaticTokenSource } from "@ovhcloud/sdk";
import { expect, it } from "vitest";

/** A fake API: "METHOD /path" to [status, JSON body]. */
function mockApi(routes: Record<string, [number, unknown]>): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    const [status, body] = routes[key] ?? [404, { message: `no mock for ${key}` }];
    return Response.json(body, { status });
  };
}

const client = new Client({
  tokenSource: new StaticTokenSource("test-token"),
  fetch: mockApi({
    "GET /v1/me": [200, { nichandle: "ab12345-ovh" }],
    "GET /v1/me/sshKey": [404, { message: "This service does not exist" }],
  }),
  retry: true,
  retrySleep: async () => {},
});

it("reads the account", async () => {
  expect((await client.me.getAccountDetails()).nichandle).toBe("ab12345-ovh");
});

it("gives a NotFoundError", async () => {
  await expect(client.me.listSshKeys()).rejects.toBeInstanceOf(NotFoundError);
});
```

To test code that takes a result, write the object yourself. Types are interfaces, so an
object literal with the fields your code reads is enough: `{ nichandle: "ab12345-ovh" }`.

---

## 11. Observability

The SDK has no tracing or metrics of its own. Two places see every call:

- **Hooks** see each call with its operation. `afterRequest` gives the status, the duration,
  the number of attempts and the `X-Ovh-Queryid`, which identifies a call for OVHcloud
  support, also when it succeeds. Use it for logs and metrics (see
  [Watching every call with hooks](#7-configuration-reference)):

  ```ts
  const client = new Client({
    afterRequest: (call, r) => {
      console.log("ovh call", call.method, call.path, r.status, `${r.duration}ms`, r.queryId);
    },
  });
  ```

- **Your own `fetch`** sees each request, token requests included:

  ```ts
  const client = new Client({
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      const url = new URL(input instanceof Request ? input.url : input);
      console.log(init?.method, url.pathname, response.status, response.headers.get("X-Ovh-Queryid"));
      return response;
    },
  });
  ```

With your own `fetch`:

- The SDK still sets the `Authorization`, `User-Agent` and other headers, and applies its
  `timeout` through `init.signal`. Pass `init` on as it is.
- Each retry is a new call of your `fetch`. So is the token request (`POST /auth/oauth2/token`).
  A hook runs once per call.
- On an error, the query ID is in `err.queryId` too.
- **OpenTelemetry**: the global `fetch` of Node.js is undici. The
  [undici instrumentation](https://www.npmjs.com/package/@opentelemetry/instrumentation-undici)
  makes a span per request, the SDK's included, with no change to the client.

---

## 12. Troubleshooting

**`no credentials`**: `OVH_CLIENT_ID` and `OVH_CLIENT_SECRET` are not set where the program
runs.

**`TokenError: obtaining an OAuth2 token from ...: 401`**: the token endpoint of your region
does not know these credentials. A service account belongs to one region: check `OVH_REGION`
first, then the client ID and secret. No API call was sent.

**`401 You must login first`** (`UnauthorizedError`): a token was made, but the API did not
accept it. Often it comes from another region than the API: check that `endpoint` and `region`
agree, or what your `tokenSource` returns.

**`403 This call has not been granted`**: you are authenticated, but your service account lacks
permission for that route. The method's doc comment names the IAM actions it needs: grant them
with an
[IAM policy](https://docs.ovhcloud.com/en/guides/account-and-service-management/account-information/iam-policy-ui).

**`404 Not Found`**: usually a wrong identifier, such as a project ID from another region.

**`429 Too Many Requests`** (`TooManyRequestsError`): you send too fast. `retry: true` retries
`GET`, `HEAD` and `DELETE` after the delay of the `Retry-After` header. A `POST`, `PUT` or
`PATCH` is never retried: wait, then send it again if it is safe to.

**`NotAllowedError: ... not sent: the client is read-only`**: the client has `readOnly: true`,
or `allowedOperations` does not match the operation. Nothing was sent. To allow one operation,
add its name, from the message or the index: `readOnly: ["cloud.rebootProjectInstance"]`.

**The call hangs**: there is no timeout by default. Add `timeout: 30_000` to `new Client()`.
It bounds each attempt of a call and the token request. A `withOptions` or per-call timeout
does not change the token request. A call that times out throws `RequestTimeoutError`.
A token request that times out throws `TokenError` ("timed out"). The wait helpers have their
own `timeout`, 30 minutes by default.

**`Cannot find module '@ovhcloud/sdk/api/vrack'`** in `tsc` or the editor: your
`tsconfig.json` has `"moduleResolution": "node"` (or `"node10"`), which ignores `exports`. Use
`"module": "nodenext"`, or `"moduleResolution": "bundler"` (see
[TypeScript settings](#typescript-settings)).

**`ERR_REQUIRE_ESM`** or `require() of ES Module`: your Node.js is older than 22.12. Update
it to 22.12 or later, which the package requires.

**Deno: `no credentials`, or a permission prompt**: add `--allow-env` and `--allow-net` (see
[Run it](#run-it)).

**`path "/me": it must start with the API version`** (`InvalidRequestError`): raw call paths
take their version, as the hint says: `/v1/me`.

**`Array.fromAsync` does not exist in my types**: set `"lib": ["esnext"]` in your
`tsconfig.json`, or add `"esnext.array"` to your lib list. TypeScript declares it only there.
Node.js 22 has it at run time.

**See exactly what is sent**: add `debug: true`. Credential headers are hidden, so the output
is safe to paste into a bug report.

---

## Contributing

Issues and pull requests are welcome: read [CONTRIBUTING.md](CONTRIBUTING.md) first, since
`src/api/` is generated. Report bugs at <https://github.com/ovh/sdk-typescript/issues>.

## License

Copyright 2026 OVH SAS. Licensed under the [Apache License 2.0](LICENSE). See
[LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt) for the full text.

## Related links

- Contribute: [CONTRIBUTING.md](CONTRIBUTING.md)
- Report bugs: <https://github.com/ovh/sdk-typescript/issues>
- Releases and changes: [CHANGELOG.md](CHANGELOG.md), <https://github.com/ovh/sdk-typescript/releases>
- The package: [`@ovhcloud/sdk` on npm](https://www.npmjs.com/package/@ovhcloud/sdk), and its
  [API reference](https://www.jsdocs.io/package/@ovhcloud/sdk)
- Examples: [examples/](examples/README.md)
- The API: the OVHcloud developer hub, <https://developers.eu.ovhcloud.com/>, and its
  [API reference](https://developers.eu.ovhcloud.com/reference/)
- Service accounts and IAM: [Managing OVHcloud service accounts](https://docs.ovhcloud.com/en/guides/manage-and-operate/api/manage-service-account),
  [IAM policies](https://docs.ovhcloud.com/en/guides/account-and-service-management/account-information/iam-policy-ui)
