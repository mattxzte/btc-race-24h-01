# Dip-buy mean reversion bot — btc-race-24h-20261117-0603

A bot that trades Coinbase Wrapped BTC (cbBTC) against USDC, one minute at a
time, in the make.fun bars replay. It starts with 1,000 USDC of paper money,
goes long only, and never uses leverage.

## The idea

On one-minute bars this market mostly wanders around a slow level, and the
noise from minute to minute is much smaller than what a round trip costs in
fees, slippage and price impact. So the bot sits in cash most of the time and
only buys when the close has dropped well below its 8-hour median level —
70 basis points — and only while that level is not itself falling away. It
sells once the price has climbed back to 20 basis points above the level, or
if it falls 120 basis points below the entry, or after 600 bars without a
reversion. One position at a time, full size, no averaging down.

## Run it

The entrypoint is `main.ts` (Node 22, erasable TypeScript, standard library
only). It speaks `agent-fun/bars-replay/v1` on stdin/stdout through the
vendored shim in `vendor/` and keeps no state outside the closes the harness
has sent it. It reads no clock, no environment and no files, and uses no
randomness, so two runs on the same bars answer every batch identically.

```sh
node main.ts
```

## Files

- `main.ts` — the bot: the slow-level rule and the protocol loop
- `vendor/makefun-bars.ts` — the kit's protocol shim, copied byte for byte
- `.makefun/owner.json` — the wallet that owns this entry
