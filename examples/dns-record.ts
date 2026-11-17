// SPDX-FileCopyrightText: 2026 OVH SAS
//
// SPDX-License-Identifier: Apache-2.0

/**
 * A DNS record: create a TXT record, then refresh the zone so the name servers serve it. A
 * record is not served until the zone is refreshed. It changes the zone: use a test zone.
 *
 *     OVH_CLIENT_ID, OVH_CLIENT_SECRET   OAuth2 service-account credentials
 *     OVH_REGION                         eu (default), ca or us
 *     ZONE                               a DNS zone of the account, for example example.com
 *
 *     node examples/dns-record.ts
 */

import { Client } from "@ovhcloud/sdk";

const zone = process.env.ZONE;
if (!zone) {
  console.error("set ZONE");
  process.exit(2);
}

const client = new Client();

const record = await client.domain.createRecord(zone, {
  fieldType: "TXT",
  subDomain: "sdk-example",
  target: `"created by the OVHcloud TypeScript SDK"`,
  ttl: 60,
});
console.log(
  `record ${record.id}: ${record.subDomain}.${zone} ${record.fieldType} ${record.target}`,
);

// Apply the change: the name servers now serve the new record.
await client.domain.refreshZone(zone);
console.log(`zone ${zone} refreshed`);

// To remove it: deleteRecord, then refreshZone again.
if (process.env.CLEANUP && record.id !== undefined) {
  await client.domain.deleteRecord(zone, record.id);
  await client.domain.refreshZone(zone);
  console.log(`record ${record.id} deleted`);
}
