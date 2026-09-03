import { ClosedTrade, EquityPoint } from './types';

export function enrichClosedTrades(trades: ClosedTrade[]): ClosedTrade[] {
  return trades.map((t) => {
    // If trade had a peak gain (e.g. peak = 85%), estimate peak USD profit
    const alloc = t.alloc_usd || 8;
    const peakPct = t.peak || 0;
    const peakUsd = (alloc * peakPct) / 100;
    const realizedUsd = t.pnl_usd || 0;
    // Evaporated USD = what could have been locked vs actual realized
    const evaporated = Math.max(0, peakUsd - realizedUsd);

    return {
      ...t,
      evaporated_usd: Number(evaporated.toFixed(2)),
    };
  });
}

export function buildEquityCurve(
  startEquity: number,
  closedTrades: ClosedTrade[]
): EquityPoint[] {
  // Sort chronologically
  const sorted = [...closedTrades].sort(
    (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
  );

  let currentEq = startEquity;
  let peakEq = startEquity;
  const points: EquityPoint[] = [
    {
      index: 0,
      time: sorted[0]?.time || '初始',
      trade_symbol: 'START',
      trade_pnl: 0,
      equity: startEquity,
      drawdown_pct: 0,
      peak_equity: startEquity,
    },
  ];

  sorted.forEach((t, i) => {
    currentEq += t.pnl_usd;
    if (currentEq > peakEq) {
      peakEq = currentEq;
    }
    const dd = peakEq > 0 ? ((peakEq - currentEq) / peakEq) * 100 : 0;
    points.push({
      index: i + 1,
      time: t.time,
      trade_symbol: t.symbol,
      trade_pnl: t.pnl_usd,
      equity: Number(currentEq.toFixed(2)),
      drawdown_pct: Number(dd.toFixed(1)),
      peak_equity: Number(peakEq.toFixed(2)),
    });
  });

  return points;
}

export interface BacktestResult {
  simulatedPnlUsd: number;
  originalPnlUsd: number;
  savedUsd: number;
  improvedTradesCount: number;
  avgPnlChangePct: number;
}

/**
 * Dynamic Trailing Take-Profit Backtest Simulator
 * @param trades Closed trades
 * @param triggerPeakPct e.g. 30 (trigger trailing stop when peak reaches +30%)
 * @param lockRatioPct e.g. 65 (protect 65% of the peak profit, or exit if drops past it)
 */
export function simulateTrailingStop(
  trades: ClosedTrade[],
  triggerPeakPct: number,
  lockRatioPct: number
): BacktestResult {
  let simTotal = 0;
  let origTotal = 0;
  let improvedCount = 0;

  for (const t of trades) {
    const orig = t.pnl_usd;
    origTotal += orig;
    const alloc = t.alloc_usd || 8;
    const peak = t.peak || 0;

    let simTradePnl = orig;
    // If the token peaked above the trigger threshold
    if (peak >= triggerPeakPct) {
      // Locked exit percentage = peak * (lockRatioPct / 100)
      const lockedPct = peak * (lockRatioPct / 100);
      const potentialLockedUsd = (alloc * lockedPct) / 100;

      // If trailing stop would have yielded higher than the actual exit
      if (potentialLockedUsd > orig) {
        simTradePnl = potentialLockedUsd;
        improvedCount++;
      }
    }
    simTotal += simTradePnl;
  }

  const saved = Math.max(0, simTotal - origTotal);
  const avgChange = origTotal !== 0 ? ((simTotal - origTotal) / Math.abs(origTotal)) * 100 : 0;

  return {
    simulatedPnlUsd: Number(simTotal.toFixed(2)),
    originalPnlUsd: Number(origTotal.toFixed(2)),
    savedUsd: Number(saved.toFixed(2)),
    improvedTradesCount: improvedCount,
    avgPnlChangePct: Number(avgChange.toFixed(1)),
  };
}
