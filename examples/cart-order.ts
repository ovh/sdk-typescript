// SPDX-FileCopyrightText: 2026 OVH SAS
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Ordering with a cart: a cart, a domain name in it, and the price of the order. It stops
 * before payment: getCartCheckout gives the price, createCartCheckout would place the order.
 * Then it deletes the cart.
 *
 *     OVH_CLIENT_ID, OVH_CLIENT_SECRET   OAuth2 service-account credentials
 *     OVH_REGION                         eu (default), ca or us
 *     DOMAIN                             a domain name to price, for example my-new-name.com
 *     SUBSIDIARY                         the OVHcloud subsidiary of the account: FR (default), GB...
 *
 *     node examples/cart-order.ts
 */

import { Client } from "@ovhcloud/sdk";
import type { NichandleOvhSubsidiaryEnum } from "@ovhcloud/sdk/api/order";

const domain = process.env.DOMAIN;
if (!domain) {
  console.error("set DOMAIN");
  process.exit(2);
}
// Not checked here: the API refuses an unknown subsidiary.
const subsidiary = (process.env.SUBSIDIARY ?? "FR") as NichandleOvhSubsidiaryEnum;

const client = new Client();

const cart = await client.order.createCart({
  ovhSubsidiary: subsidiary,
  description: "sdk example",
});
const cartId = cart.cartId;
if (!cartId) {
  throw new Error("the API returned a cart with no id");
}
try {
  // What the domain offers: is it free, for how long, at which price.
  const offers = await client.order.listCartDomains(cartId, domain);
  const offer = offers.find((o) => o.orderable);
  if (!offer) {
    console.log(`${domain} cannot be ordered`);
  } else {
    await client.order.createCartDomain(cartId, { domain, duration: offer.duration?.[0] ?? null });
    // The cart belongs to the account: needed before a checkout.
    await client.order.assignCart(cartId);
    const order = await client.order.getCartCheckout(cartId);
    console.log(`${domain}: ${order.prices?.withTax?.text} with tax`);
  }
} finally {
  await client.order.deleteCart(cartId);
}
