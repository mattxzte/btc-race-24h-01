// Dip-buy mean reversion for the cbBTC/USDC 1-minute replay.
//
// Idea: on this market the price spends most of its time wandering in a band
// around a slow 8-hour level, with 1-minute noise far smaller than the cost of
// a round trip. So the bot does nothing most of the time and only steps in
// when the close has fallen a long way below that slow level, then gets out
// once the price has climbed back a little above it. One full-size position
// at a time, no leverage, no shorts, no averaging down.
//
// Everything is computed from the closes the harness has sent so far, in
// integer arithmetic. No clock, no environment, no randomness: two runs on
// the same bars answer every batch the same way.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// How many past closes make up the slow level the bot trades against.
const LEVEL_BARS = 480;
// Buy when the close sits this far below the slow level (basis points).
const DIP_BPS = 70n;
// Sell once the close has climbed this far above the slow level.
const RISE_BPS = 20n;
// Sell if the price falls this far below the entry close instead.
const STOP_BPS = 120n;
// Give up on a position after this many bars even if it never reverted.
const MAX_HOLD_BARS = 600;
// The trend guard compares the median of the last TREND_BARS closes with the
// median of the TREND_BARS closes that ended LEVEL_BARS ago, and blocks a
// buy when the recent level has dropped more than TREND_DROP_BPS below it.
const TREND_BARS = 60;
const TREND_DROP_BPS = 50n;
// How far a fill may move from the latest close before the harness rejects
// it. One-minute moves here are a few basis points, so 100 is generous.
const MAX_SLIPPAGE_BPS = 100;

const BPS = 10_000n;

/** The middle of a list of closes, or the mean of the two middle ones. */
function middleOf(closes: readonly bigint[]): bigint {
  const sorted = [...closes].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const n = sorted.length;
  const mid = n >> 1;
  if (n % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2n;
}

// The closes the harness has sent so far, oldest first, and the entry of the
// open position, if any.
const closes: bigint[] = [];
let entryClose: bigint | null = null;
let entrySeq = -1;

function decide(state: BarsState): OrderInput[] {
  const bar = state.latest.get(SYMBOL);
  if (bar === undefined) return [];
  const close = BigInt(bar.c);
  closes.push(close);
  // Warm-up batches exist so the bot can build history; record their bars
  // but never trade on them.
  if (state.warmingUp) return [];

  const held = state.positions.get(SYMBOL);
  const qty = held === undefined ? 0n : held.qty;

  if (closes.length < LEVEL_BARS) return [];
  const level = middleOf(closes.slice(-LEVEL_BARS));

  if (qty === 0n) {
    // Flat: only buy a real dip, and only while the slow level is not
    // falling away underneath us.
    if (close * BPS >= level * (BPS - DIP_BPS)) return [];
    if (closes.length >= LEVEL_BARS + TREND_BARS) {
      const recent = middleOf(closes.slice(-TREND_BARS));
      const earlier = middleOf(closes.slice(-LEVEL_BARS, -LEVEL_BARS + TREND_BARS));
      if (recent * BPS < earlier * (BPS - TREND_DROP_BPS)) return [];
    }
    if (state.cash < 1_000_000n) return [];
    entryClose = close;
    entrySeq = state.seq;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  }

  // Holding: take the reversion, or cut the loss, or give up on time.
  const reverted = close * BPS >= level * (BPS + RISE_BPS);
  const stopped = entryClose !== null && close * BPS <= entryClose * (BPS - STOP_BPS);
  const stale = entrySeq >= 0 && state.seq - entrySeq >= MAX_HOLD_BARS;
  if (!reverted && !stopped && !stale) return [];
  entryClose = null;
  entrySeq = -1;
  return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
}

await runBars({
  onBatch(state: BarsState, _batch: Batch): OrderInput[] {
    return decide(state);
  },
});
