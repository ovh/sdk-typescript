# AGENTS.md

Notes for AI coding agents that write code with this SDK, or work in this repository.

## Not node-ovh

- This is not node-ovh, the `ovh` npm package (`npm install ovh`, `require("ovh")`,
  `requestPromised`). Do not mix them. Here: `import { Client } from "@ovhcloud/sdk"`.
- Credentials are an OAuth2 service account (`OVH_CLIENT_ID`, `OVH_CLIENT_SECRET`,
  `OVH_REGION`). No application key, application secret or consumer key (`appKey`,
  `appSecret`, `consumerKey`).
- Prefer the typed method: `await client.me.getAccountDetails()`. For a raw call, paths take
  their version: node-ovh's `requestPromised("GET", "/me")` is `client.get("/v1/me")`. A path
  without `/v1/` or `/v2/` (`/me`, `/1.0/me`) throws `InvalidRequestError`, with the path to
  use.
- A raw body is the second argument of `client.post(path, body)`, `put` and `patch`. With
  `client.request(method, path, options)`, the body goes in `options.body`.

## Find the right method

- Each API section is a client property, in camelCase: `client.vrack`, `client.publicCloud`.
  Its types are exported by its subpath: `import type { X } from "@ovhcloud/sdk/api/publicCloud"`.
- To find the method of a route, read `index/<section>.jsonl`. It has one JSON line per
  method, with the route, the TypeScript signature, the summary, the IAM actions (`iam`), and
  the subpath to import. It is at the root of this repository, and in the installed package.
  Search it before you guess a name.
- Find the installed package without guessing where `node_modules` is. This works with npm,
  pnpm and workspaces, and searches the version the project uses:

  ```shell
  SDK="$(dirname "$(node -p 'require.resolve("@ovhcloud/sdk/package.json")')")"
  grep -h '"path":"/v1/vrack/{serviceName}"' "$SDK"/index/*.jsonl
  ```

  The package also exports its docs: `require.resolve("@ovhcloud/sdk/llms.txt")`,
  `"@ovhcloud/sdk/AGENTS.md"` and `"@ovhcloud/sdk/index/<section>.jsonl"`, or
  `import.meta.resolve(...)` in an ES module.
- With Deno, set `"nodeModulesDir": "auto"` in `deno.json` to get the package in
  `node_modules/@ovhcloud/sdk`. Without it, the package is in Deno's npm cache: `deno info`
  prints where.
- The types a signature names (`models.X`) are in `dist/api/<section>/models.d.ts` of the
  package, with their fields, which ones are required, and the enum values. Read the type
  before you write a body or read a field:

  ```shell
  grep -n -A 30 'export interface VrackVrackWithIAM ' "$SDK"/dist/api/vrack/models.d.ts
  ```

- To tell the user what to grant the service account, collect the `iam` of the methods your
  program calls, from the index or from the doc comments. Find the methods that need one
  action: `grep -h '"vrack:apiovh:get"' "$SDK"/index/*.jsonl`. An IAM policy for a program is
  the list of those actions on its resources.
- The doc comment of each method starts with its route:
  `getVrack calls GET /v1/vrack/{serviceName}`. It then gives the API's description, the
  IAM actions the call needs, the parameters, and whether it is deprecated. A deprecated
  method names its replacement route when the API gives one: look it up in the index too.
  `allX` iterators say which list they walk, its parameters, and the IAM actions of both
  calls.
- The module doc of a section (`@ovhcloud/sdk/api/<section>`) gives its number of
  operations, its route prefixes, the list methods to start from, and its index file.
- Routes start with their API version, `/v1/` or `/v2/`. The same path can exist in both.
- At run time, `await lookupOperation("vrack.getVrack")` returns an operation's route,
  summary and IAM actions, `await matchOperation("GET", "/v1/vrack/pn-1")` finds the
  operation of a concrete path, and `await operations()` lists them all.

## Write the call

- One client for the whole program: `const client = new Client()`. It reads `OVH_CLIENT_ID`,
  `OVH_CLIENT_SECRET` and `OVH_REGION` (`eu`, `ca` or `us`). Where there is no environment
  (an edge worker), pass them: `new Client({ clientId, clientSecret, region: "eu" })`.
- Every method is async: `await` it. Iterators are async too: `for await`.
- Arguments come in this order: path parameters, required query parameters, the request
  body, then the optional parameters in one object, then the options of the call (`signal`,
  `timeout`, `headers`). Leave out what you do not set.
- Methods and arguments are camelCase: `getVrack(serviceName)`. Types keep the API's acronyms
  upper case: `DedicatedServerIPBlock`. Properties of a type are the API's own names: the SDK
  never renames them. Enum members are UPPER_CASE: `CommonResourceStatusEnum.READY`.
- A request body is a plain object. Its type has no read-only field: a body whose type has
  some takes `<Type>Writable` instead (`getEnvVar` returns `HostingWebEnvVarAlt`,
  `updateEnvVar` takes `HostingWebEnvVarWritable`). Only the properties you set are sent. A
  property set to `null` is sent as `null`.
- To change an object, get it, remove the read-only fields, change what you need, send it.
  A field marked `Read-only: the API sets it.` in its doc is set by the API:

  ```ts
  const { key, status, taskId, type, ...body } = await client.hostingweb.getEnvVar(site, "API_URL");
  await client.hostingweb.updateEnvVar(site, "API_URL", { ...body, value: "https://api.example.com" });
  ```

  TypeScript checks only the shape: passing the object from the GET as it is also compiles,
  and sends its read-only fields back. Do not do that. This removes the top-level read-only
  fields only. A nested object keeps its own: rebuild it from its `Writable` type too. A type
  built with `allOf` keeps its read-only fields even in a `Writable` type: leave out each
  field whose doc says "Read-only".
- A response is the JSON the API sent, typed. Dates are strings. Nothing is decoded.
- Enums are open: the type accepts any string, so check for unknown values.
- `listX` returns an array, often of IDs only. `allX` is an async iterator over the objects:
  a `for await` loop gets them one at a time. An error stops the loop.
- An iterator is named `all` plus the operation name without `list` or `get`: `listSshKeys`
  gives `allSshKeys`. A paginated v2 list has only its iterator, such as
  `client.publicCloud.allProjects`. Names stay the same from release to release, so they do
  not always follow this rule: take them from the index, never guess.
- Paginated v2 lists have only `allX`. There is no method that loads every page at once:
  use `await Array.fromAsync(client.publicCloud.allProjects())` if you need them all.
- A path parameter must not be empty: the call fails before it sends anything, with
  `InvalidRequestError`.
- No method for a route yet? Call it directly: `await client.get("/v1/me")`,
  `await client.post("/v1/...", { key: "value" })`. It returns the JSON as it came. Give the
  type you expect, `client.get<Account>("/v1/me")`: nothing checks it at run time. Build a
  path with parameters with `path("/v1/ip/{ip}", { ip })` (from `@ovhcloud/sdk`): it escapes
  each value, so `1.2.3.0/24` stays one segment. `client.iterate<T>("/v2/...")` walks a v2
  list.

## Wait for the work to finish

- Many calls only start the work. A v2 resource comes back `CREATING` or `UPDATING`. A v1
  call often returns a task. Do not sleep in a loop: wait with the GET of the same object.
- `waitReady(get)` polls until `resourceStatus` is `READY`. `waitTask(get)` polls until a
  task's `status` is `done`. `waitGone(get)` polls until a 404, after a delete. `get` is a
  function with no argument that calls the generated GET:

  ```ts
  const instance = await waitReady(() => client.publicCloud.getInstance(projectId, instanceId));
  ```

- A failed status (`ERROR`, a task in error or waiting for an action) throws
  `WaitFailedError`. The wait gives up after 30 minutes with `WaitTimeoutError`: the
  `timeout` option (milliseconds) changes that. `wait(get, done)` takes any condition.

## Handle errors

- Every error of the SDK is an `OvhError`. An error status from the API is an `ApiError`. Its
  message is the API's own.
- Match a common status by its class: `NotFoundError`, `ForbiddenError`, `UnauthorizedError`,
  `BadRequestError`, `ConflictError`, `TooManyRequestsError`.
- Read `status`, `errorClass`, `apiMessage`, `queryId` (for support) and `operation`, the
  method's name, on any `ApiError`. `JSON.stringify(err)` gives them all, with the body as
  text in `bodyText`.
- A 403 means the service account lacks an IAM action. The message ends with the actions the
  call needs (`requires the IAM action vrack:apiovh:get`), also in `iamActions`: report them
  to the user, who can grant them. Retrying does not help.
- A request the client is configured to refuse throws `NotAllowedError`, and nothing is sent.
  Do not work around it: ask the user.
- A timeout throws `RequestTimeoutError`, a `TransportError`. Match it with `instanceof`, not
  with `err.name === "TimeoutError"`. It is never retried: the server may have done the work.
  A timeout of the token request throws `TokenError`.
- The token endpoint refusing the credentials throws `TokenError`, before any API call. The
  usual cause is a wrong `OVH_REGION`: a service account belongs to one region.

## Configure the client

- To explore an account safely, use a read-only client: `new Client({ readOnly: true })`
  sends only `GET` and `HEAD`. `readOnly: ["cloud.rebootProjectInstance"]` also allows that
  one operation. `allowedOperations: ["vrack.*", "*.get*"]` sends only the operations whose
  name matches. A request must pass both when both are set. The names are the `id` of the
  index: check them there, since a pattern that matches nothing is not an error.
- There is no timeout by default. Set one: `new Client({ timeout: 30_000 })`. It bounds each
  attempt of a call, and the token request. `withOptions` and a per-call timeout do not
  change the token request. Durations are in milliseconds.
- Retries are off by default. `retry: true` retries only `GET`, `HEAD` and `DELETE`, never
  `POST`, `PUT` or `PATCH`: those can start tasks or place orders.
- `debug: true` logs requests to stderr, with credentials hidden. `debugBodies: true` also
  logs bodies, which can hold secrets.
- For tracing, metrics or the `X-Ovh-Queryid` of a call that succeeds, pass your own
  `fetch`: a function that calls the global `fetch` and reads the response.

## Test code that uses the SDK

- No network and no credentials: `new Client({ tokenSource: new StaticTokenSource("t"),
  fetch: mockFetch })`. `StaticTokenSource` sends that token and never calls the token
  endpoint. `mockFetch(url, init)` gets a `URL` and returns a `Response`.
- The URL is the region's host with the versioned path: `https://api.eu.ovhcloud.com/v1/me`,
  `api.ca.ovhcloud.com` for `region: "ca"`. `endpoint` points the client at a test server
  instead.
- With `retry`, pass `retrySleep: async () => {}`: a mocked `503` is then retried at once.
- Answer with a JSON `Response`, and an error status for an error:
  `new Response(JSON.stringify({ message: "not found" }), { status: 404 })` makes the call
  throw `NotFoundError`.
- A fake result is an object literal of the method's result type, with the fields your code
  reads: the types are interfaces, so there is nothing to construct.

## Change this repository

- `src/api/`, `index/` and `llms.txt` are generated at each release. Do not edit them: the
  next release overwrites the change. Report the problem instead, with the route.
- `src/core/` is hand-written. Each export replaces this whole repository, so a change made
  here is ported by the maintainers into the generator: see [CONTRIBUTING.md](CONTRIBUTING.md).
- Check a change with `npm install` then `npm run build`. The SDK's tests and lint config are
  not part of this repository.
- [examples/](examples/README.md) has small programs that call real methods.

More: [README.md](README.md) is the full guide.
