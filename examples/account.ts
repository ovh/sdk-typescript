// SPDX-FileCopyrightText: 2026 OVH SAS
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Account: the details of your account, GET /v1/me. The program of the README's quick start.
 * Read-only.
 *
 *     OVH_CLIENT_ID, OVH_CLIENT_SECRET   OAuth2 service-account credentials
 *     OVH_REGION                         eu (default), ca or us
 *
 *     node examples/account.ts
 */

import { Client } from "@ovhcloud/sdk";

const client = new Client(); // reads OVH_CLIENT_ID, OVH_CLIENT_SECRET, OVH_REGION

const account = await client.me.getAccountDetails(); // GET /v1/me
console.log("account:", account.nichandle);
console.log("email:  ", account.email);
console.log("country:", account.country);
