# Operation index

One file per API section, `<section>.jsonl` (the section's name), with one JSON object per
line: each method of the SDK and the route it calls. 6925 methods in
77 files. It is generated with the SDK's code at each release, from the
same data, so it always matches it.

Find the method of a route:

```shell
grep -h '"path":"/v1/vrack/{serviceName}"' index/*.jsonl
```

To list what a program needs, collect the `iam` of the methods it calls: those are the
actions to grant its service account. Find the methods that need one action:

```shell
grep -h '"vrack:apiovh:get"' index/*.jsonl
```

The types a signature names (`models.X`) are in `dist/api/<section>/models.d.ts` of the
installed package, with their fields, which ones are required, and the enum values. Find
one:

```shell
grep -n 'export interface VrackVrackWithIAM ' dist/api/vrack/models.d.ts
```

A request body takes the `<Type>Writable` form of a type when the type has read-only fields:
the same type without them.

Fields:

| Field | Meaning |
|---|---|
| `section` | The API section: its client property and its subpath (`publicCloud`). |
| `method` | The method name. Call `await client.<section>.<method>(...)`. |
| `kind` | `call`: one request, the method returns a Promise. `pages`: an async iterator over a list paginated by cursor. `each`: an async iterator that lists IDs with `lists`, then gets each object with `fetches`. |
| `http`, `path` | The route, with its API version. For `each`, the route of the list. |
| `summary` | The API's one-line description, when it has one. |
| `signature` | The method's TypeScript signature. `models.X` is a type the section exports. |
| `iam` | The IAM actions the call requires: a 403 means the service account's policy lacks one. For `each`, those of the list and of the fetch. Absent when the API declares none. |
| `deprecated` | Present and true when the API has deprecated the operation. |
| `id` | The operation's name in the SDK: what errors show, and what `readOnly` and `allowedOperations` match. |
| `import` | The section's subpath. Import its types from there: `import type { X } from "@ovhcloud/sdk/api/publicCloud"`. |
