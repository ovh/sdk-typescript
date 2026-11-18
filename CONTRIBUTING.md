# Contributing to sdk-typescript

This project accepts contributions: issues and pull requests on GitHub. Your work must be
signed off (see the DCO below).

# How this repository is built

This repository is an **export**. The maintainers build it from a private generator at each
release, and each export **replaces the whole tree**:

- `src/api/`: one directory per API section, generated from the OVHcloud API's OpenAPI
  specifications.
- `index/` and `llms.txt`: generated with the code.
- `src/core/`: the SDK core (client, authentication, retries, errors, pagination). It is
  hand-written, but it lives in the generator too, with its tests and its lint rules.

The tests and the Biome configuration are not exported. So a change merged here would be
lost at the next export. This is why the maintainers do not merge pull requests here.
They port the change into the generator instead, with tests, and close the pull request
with a link to the release that has it.

So the most useful contributions are:

- **Issues**: a wrong type, a missing operation, a confusing name, a bug in the core. Please
  give the API route (every method's doc comment starts with it, for example
  `getAccountDetails calls GET /v1/me`).
- **Pull requests**, on `src/core/` or on `src/api/`, as a precise description of a fix.
  Say what was wrong and how to see it: a short script or the failing call helps most.

A problem in the API's own behaviour or documentation is not something this repository can
fix: report it to OVHcloud support.

# Coding and documentation style

The code is TypeScript in strict mode. The core uses web APIs only (`fetch`, `AbortSignal`),
so it runs on Node.js, Deno and Bun. Every public name has a doc comment. Before you open a
pull request, check that the tree still builds:

```bash
npm install
npm run build
```

# Submitting modifications

Contributions are submitted through GitHub Pull Requests and follow the DCO defined below.

# Licensing for new files

sdk-typescript is licensed under the Apache License 2.0. Anything contributed to sdk-typescript must be
released under this license.

When you add a new file to the project, make sure it has a copyright header that says under
which license it is released:

```ts
// SPDX-FileCopyrightText: 2026 OVH SAS
//
// SPDX-License-Identifier: Apache-2.0
```

# Developer Certificate of Origin (DCO)

To improve tracking of contributions to this project we will use a
process modeled on the modified DCO 1.1 and use a "sign-off" procedure
on patches that are being emailed around or contributed in any other
way.

The sign-off is a simple line at the end of the explanation for the
patch, which certifies that you wrote it or otherwise have the right
to pass it on as an open-source patch.  The rules are pretty simple:
if you can certify the below:

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I have
    the right to submit it under the open source license indicated in
    the file; or

(b) The contribution is based upon previous work that, to the best of
    my knowledge, is covered under an appropriate open source License
    and I have the right under that license to submit that work with
    modifications, whether created in whole or in part by me, under
    the same open source license (unless I am permitted to submit
    under a different license), as indicated in the file; or

(c) The contribution was provided directly to me by some other person
    who certified (a), (b) or (c) and I have not modified it.

(d) The contribution is made free of any other party's intellectual
    property claims or rights.

(e) I understand and agree that this project and the contribution are
    public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.


then you just add a line saying

    Signed-off-by: Random J Developer <random@example.org>

using your real name (sorry, no pseudonyms or anonymous contributions.)
