// SPDX-FileCopyrightText: 2026 OVH SAS
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Create, then wait: a Public Cloud private network. The API only starts the work, so the
 * program waits until the network is READY. Then it deletes the network and waits until it is
 * gone. It changes the project: run it on a test project.
 *
 *     OVH_CLIENT_ID, OVH_CLIENT_SECRET   OAuth2 service-account credentials
 *     OVH_REGION                         eu (default), ca or us
 *     PROJECT_ID                         the Public Cloud project
 *     CLOUD_REGION                       the region of the network, for example GRA11
 *
 *     node examples/create-and-wait.ts
 */

import { Client, WaitFailedError, waitGone, waitReady } from "@ovhcloud/sdk";

const projectId = process.env.PROJECT_ID;
const region = process.env.CLOUD_REGION;
if (!projectId || !region) {
  console.error("set PROJECT_ID and CLOUD_REGION");
  process.exit(2);
}

const client = new Client();

const created = await client.publicCloud.createNetwork(projectId, {
  targetSpec: { name: "sdk-example", location: { region } },
});
const networkId = created.id;
if (!networkId) {
  throw new Error("the API returned a network with no id");
}
console.log(`network ${networkId} is ${created.resourceStatus}`);

try {
  // Polls every 2 seconds at first, then less often. Gives up after 10 minutes here.
  const network = await waitReady(() => client.publicCloud.getNetwork(projectId, networkId), {
    timeout: 10 * 60_000,
  });
  console.log(`network ${networkId} is ${network.resourceStatus}`);
} catch (err) {
  if (err instanceof WaitFailedError) {
    // The resource went to ERROR (or SUSPENDED...). err.last is its last state.
    console.error(`the network failed: ${err.message}`);
  }
  throw err;
} finally {
  await client.publicCloud.deleteNetwork(projectId, networkId);
  await waitGone(() => client.publicCloud.getNetwork(projectId, networkId));
  console.log(`network ${networkId} deleted`);
}
