// SPDX-FileCopyrightText: 2026 OVH SAS
//
// SPDX-License-Identifier: Apache-2.0

/**
 * A raw call: a route by its path, for a route that has no method yet. path() puts the values
 * in the path and escapes them. The type of the result is yours: nothing checks it at run time.
 * Read-only.
 *
 *     OVH_CLIENT_ID, OVH_CLIENT_SECRET   OAuth2 service-account credentials
 *     OVH_REGION                         eu (default), ca or us
 *     IP_BLOCK                           an IP block of the account, for example 192.0.2.0/24
 *
 *     node examples/raw-call.ts
 */

import { Client, path } from "@ovhcloud/sdk";
import type { IPIPWithIAM } from "@ovhcloud/sdk/api/ip";

const block = process.env.IP_BLOCK;
if (!block) {
  console.error("set IP_BLOCK");
  process.exit(2);
}

const client = new Client({ readOnly: true });

// Your own type, with only the fields the program reads.
interface Account {
  nichandle: string;
  email: string;
}
const me = await client.get<Account>("/v1/me");
console.log(`account ${me.nichandle} <${me.email}>`);

// "192.0.2.0/24" goes in the path as 192.0.2.0%2F24. Without path(), the slash would call
// another route. A section's type works too.
const ip = await client.get<IPIPWithIAM>(path("/v1/ip/{ip}", { ip: block }));
console.log(`${ip.ip} ${ip.type} ${ip.description ?? ""}`);

// The same call through the generated method: client.ip.getIp(block).
