// SPDX-FileCopyrightText: 2026 OVH SAS
//
// SPDX-License-Identifier: Apache-2.0

/**
 * List and get: every DNS zone of the account with an iterator, then one zone and its records.
 * Read-only.
 *
 *     OVH_CLIENT_ID, OVH_CLIENT_SECRET   OAuth2 service-account credentials
 *     OVH_REGION                         eu (default), ca or us
 *
 *     node examples/list-and-get.ts
 */

import { Client } from "@ovhcloud/sdk";

// readOnly: this program cannot change anything, whatever its service account may do.
const client = new Client({ readOnly: true });

// allZones lists the names, then gets each zone. The next page is read only when the loop
// reaches it, so a break stops the calls.
const names: string[] = [];
for await (const zone of client.domain.allZones()) {
  console.log(`${zone.name} last update ${zone.lastUpdate ?? "never"}`);
  if (zone.name) {
    names.push(zone.name);
  }
}

const first = names[0];
if (first === undefined) {
  console.log("no DNS zone");
} else {
  // One object, by its name.
  const zone = await client.domain.getZone(first);
  console.log(`${zone.name}: name servers ${zone.nameServers?.join(", ")}`);
  // The records of the zone, with a filter on the type.
  let count = 0;
  for await (const record of client.domain.allRecords(first, { fieldType: "A" })) {
    count++;
    console.log(`  ${record.subDomain || "@"} ${record.fieldType} ${record.target}`);
  }
  console.log(`${count} A record(s)`);
}
