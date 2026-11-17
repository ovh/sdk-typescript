// SPDX-FileCopyrightText: 2026 OVH SAS
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Errors: each HTTP error has its own class. Test them with instanceof, from the most precise
 * to the most general. Read-only.
 *
 *     OVH_CLIENT_ID, OVH_CLIENT_SECRET   OAuth2 service-account credentials
 *     OVH_REGION                         eu (default), ca or us
 *
 *     node examples/errors.ts
 */

import { ApiError, Client, ForbiddenError, NotFoundError, OvhError } from "@ovhcloud/sdk";

const client = new Client({ readOnly: true });

try {
  // .invalid is a reserved name: this zone does not exist.
  const zone = await client.domain.getZone("no-such-zone.invalid");
  console.log(`found ${zone.name}`);
} catch (err) {
  if (err instanceof NotFoundError) {
    // 404: the object does not exist, or the account cannot see it.
    console.log(`not found: ${err.method} ${err.path}: ${err.apiMessage}`);
  } else if (err instanceof ForbiddenError) {
    // 403: the IAM actions that the service account needs.
    console.log(`forbidden: the service account needs ${err.iamActions.join(", ")}`);
  } else if (err instanceof ApiError) {
    // Any other HTTP error. Give the query id to the support.
    console.log(`${err.statusLine} from ${err.operation}, query id ${err.queryId}`);
  } else if (err instanceof OvhError) {
    // Not an HTTP error: credentials, network, timeout, read-only mode...
    console.log(`${err.name}: ${err.message}`);
  } else {
    throw err;
  }
}
