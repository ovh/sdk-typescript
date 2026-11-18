// SPDX-FileCopyrightText: 2026 OVH SAS
//
// SPDX-License-Identifier: Apache-2.0

/**
 * vRack: every vRack of the account, with the Public Cloud projects in it. Read-only.
 *
 *     OVH_CLIENT_ID, OVH_CLIENT_SECRET   OAuth2 service-account credentials
 *     OVH_REGION                         eu (default), ca or us
 *
 *     node examples/vrack.ts
 */

import { Client } from "@ovhcloud/sdk";

const client = new Client({ readOnly: true });

// listVracks gives the names only. allVracks gets each vRack too.
let count = 0;
for await (const vrack of client.vrack.allVracks()) {
  count++;
  const name = vrack.serviceName ?? "";
  console.log(`${name} ${JSON.stringify(vrack.name)} ${vrack.description ?? ""}`);
  for (const project of await client.vrack.listCloudProjects(name)) {
    console.log(`  Public Cloud project ${project}`);
  }
}
console.log(`${count} vRack(s)`);
