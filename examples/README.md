# Examples

Small programs that use the OVHcloud TypeScript SDK. Each one is a single file. Read its header
comment first: it lists the environment variables it needs.

| File | What it shows | Changes the account |
|---|---|---|
| [account.ts](account.ts) | `GET /v1/me`: the details of your account. Start here. | no |
| [list-and-get.ts](list-and-get.ts) | list with an async iterator, then get one object | no |
| [create-and-wait.ts](create-and-wait.ts) | create a Public Cloud network, `waitReady`, delete it, `waitGone` | yes |
| [dns-record.ts](dns-record.ts) | create a DNS record, then refresh the zone | yes |
| [cart-order.ts](cart-order.ts) | order with a cart: add a domain, read the price, stop before payment | no order is placed |
| [raw-call.ts](raw-call.ts) | a raw call with `path()` and a type for the result | no |
| [errors.ts](errors.ts) | `instanceof NotFoundError`, `ForbiddenError`, `ApiError` | no |
| [vrack.ts](vrack.ts) | every vRack, with the Public Cloud projects in it | no |

## Run one

Credentials come from the environment. Never write them in the code.

```shell
export OVH_CLIENT_ID=...  OVH_CLIENT_SECRET=...
export OVH_REGION=eu          # or ca, us
node examples/account.ts
```

Node.js 22.18 or later runs a `.ts` file as it is. The examples import `@ovhcloud/sdk` by its
name, so they run from a project that has it installed, or from this repository after
`npm run build`.

`account` stays the plain quick start, with a default client. The other read-only examples
create their client with `readOnly: true`: they cannot change anything, whatever the service
account may do. The examples that change the account run on a test project or a test zone.

## Type-check them

```shell
npm run build
npx tsc -p examples/tsconfig.json
```
