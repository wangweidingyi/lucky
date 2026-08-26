# Mini-Program Coffee Card Flow Design

## Goal

Rebuild the Luckin ordering path as a new mini-program-only flow while leaving the legacy `/order/*`, MCP mapping, old `lucky_*` ordering tables, and old claim UI available as references only.

## Data Model

`miniprogram_order_users` stores mini-program account credentials. `miniprogram_coffee_cards` stores the mini-program coffee card list from `/resource/m/promotion/v2/myself/list`. `miniprogram_sellable_products` stores one row per remaining card use and points to `coffee_card_id`.

The new flow does not read or write `lucky_products`, `lucky_coffee_cards`, or `lucky_sellable_products`.

## Admin Flow

The new coffee-card sync page lets an admin select a mini-program order account and sync coffee cards through `/lkadmin/miniprogram/*`. The backend upserts cards, reconciles sellable rows to the card's remaining count, and shows generated counts. There is no product probing and no product-library write during admin sync.

## Frontend Flow

A new front-facing page uses `/miniprogramorder/*`. It loads a `miniprogram_sellable_products` row, asks the user to choose a shop, then fetches card-usable products from `/resource/core/v3/product/cardCouponZone` using that sellable row's `coffee_card_id`. The user chooses one product and submits the order.

Order submission calls the mini-program endpoints in sequence:

1. `/resource/core/v2/order/preview`
2. `/resource/core/v1/order/create`
3. `/resource/core/v2/pay/topay` only when the create response forwards to pay

The flow treats non-zero payable amounts or pay responses still requiring payment as failures.

## Mini-Program Request Mechanics

All Luckin calls are POST form requests with `cid`, encrypted `q`, `dk=1`, and `sign`. The request cookie must include `uid`; order payment also requires `openid`, `blackBox`, and `notifyCode` from the mini-program account fields.

## Error Handling

The new backend route returns normal project responses through `ok`/`fail`. Luckin transport, decrypt, invalid response, non-zero preview, and still-needs-payment cases are mapped to 4xx/5xx errors with request logs that keep secrets summarized.
