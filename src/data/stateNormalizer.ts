import { AccountState, ActivePosition, ClosedTrade, AgentCouncilLogItem, TradingMode } from '../types';

export function normalizeAccountState(
  raw: any,
  mode: TradingMode,
  fallback: AccountState
): AccountState {
  if (!raw || typeof raw !== 'object') {
    return fallback;
  }

  const start_equity = typeof raw.start_equity === 'number' && !isNaN(raw.start_equity)
    ? raw.start_equity
    : (mode === 'paper' ? 100.0 : 15.0);

  const cash_usd = typeof raw.cash_usd === 'number' && !isNaN(raw.cash_usd)
    ? raw.cash_usd
    : Number(raw.cash_usd) || 0;

  const rawEquity = raw.equity_usd ?? raw._onchain_usd;
  const equity_usd = typeof rawEquity === 'number' && !isNaN(rawEquity)
    ? rawEquity
    : Number(rawEquity) || cash_usd;

  // Real API schema: positions is a dict Record<string, ActivePosition>
  const positions: Record<string, ActivePosition> = {};
  if (raw.positions && typeof raw.positions === 'object') {
    for (const [key, p] of Object.entries(raw.positions as Record<string, any>)) {
      if (p && typeof p === 'object') {
        const alloc_usd = p.alloc_usd != null && !isNaN(Number(p.alloc_usd))
          ? Number(p.alloc_usd)
          : undefined;
        const entry_price = Number(p.entry_price) || 0;
        const current_price = Number(p.current_price) || entry_price;
        const held_min = Number(p.held_min) || 0;
        const peak = Number(p.peak) || 0;
        const current_pnl_pct = Number(p.current_pnl_pct) || 
          (entry_price > 0 ? ((current_price - entry_price) / entry_price) * 100 : 0);
        const current_pnl_usd = Number(p.current_pnl_usd) || 
          (alloc_usd != null ? (alloc_usd * current_pnl_pct) / 100 : 0);
        const slip_pct = Number(p.slip_pct ?? p.slippage_pct) || 0;
        const gas_usd = Number(p.gas_usd) || 0;

        positions[key] = {
          symbol: String(p.symbol || key),
          alloc_usd,
          entry_price,
          current_price,
          held_min,
          peak,
          current_pnl_pct: Number(current_pnl_pct.toFixed(2)),
          current_pnl_usd: Number(current_pnl_usd.toFixed(2)),
          slip_pct,
          gas_usd,
          id: p.id || key,
          address: p.address,
          entry_eth: p.entry_eth != null ? Number(p.entry_eth) : undefined,
          entry_time: p.entry_time != null ? Number(p.entry_time) : undefined,
          meeting: Array.isArray(p.meeting) ? p.meeting : undefined,
          sparkline: Array.isArray(p.sparkline) ? p.sparkline : undefined,
          entry_idx: p.entry_idx,
          peak_idx: p.peak_idx,
          order_book_health: p.order_book_health,
        };
      }
    }
  }

  // Real API schema: closed is ClosedTrade[]
  // Fields: {symbol, time, alloc_usd, entry_price, exit_price, pnl_usd, pnl_pct, peak, slip_pct, gas_usd, method, exit_reason, held_min, meeting:[{agent,verdict,score,reason}]}
  const closed: ClosedTrade[] = [];
  if (Array.isArray(raw.closed)) {
    for (let i = 0; i < raw.closed.length; i++) {
      const c = raw.closed[i];
      if (c && typeof c === 'object') {
        const meeting = Array.isArray(c.meeting)
          ? c.meeting.map((m: any) => ({
              agent: String(m.agent || '?'),
              verdict: String(m.verdict || 'approve'),
              score: Number(m.score) || 0,
              reason: String(m.reason || ''),
            }))
          : [];

        const _allocRaw = Number(c.alloc_usd);
        const alloc_usd = !isNaN(_allocRaw) && _allocRaw > 0
          ? _allocRaw
          // 舊紀錄無 alloc：由 pnl_pct 與 pnl_usd 反推 (alloc = pnl / pct×100)
          : (Number(c.pnl_pct) && Number(c.pnl_usd) ? Math.abs(Number(c.pnl_usd) / (Number(c.pnl_pct) / 100)) : undefined);
        const pnl_usd = Number(c.pnl_usd) || 0;
        const peak = Number(c.peak) || 0;
        const peakUsd = alloc_usd != null 
          ? (alloc_usd * peak) / 100 
          : (c.pnl_pct && pnl_usd ? Math.abs((pnl_usd / c.pnl_pct) * peak) : 0);
        const evaporated_usd = Math.max(0, peakUsd - pnl_usd);

        closed.push({
          symbol: String(c.symbol || 'UNKNOWN'),
          time: String(c.time || new Date().toISOString()),
          alloc_usd,
          entry_price: Number(c.entry_price) || 0,   // 真單價 USD/幣（後端 settle 計算）；舊紀錄無此欄→0
          exit_price: Number(c.exit_price) || 0,
          pnl_usd,
          pnl_pct: Number(c.pnl_pct) || 0,
          peak,
          slip_pct: Number(c.slip_pct ?? c.slippage_pct) || 0,
          gas_usd: Number(c.gas_usd) || 0,
          method: String(c.method || 'manual'),
          exit_reason: String(c.exit_reason || c.reason || ''),
          held_min: Number(c.held_min) || 0,
          meeting,
          id: c.id || `${c.symbol}_${c.time || i}`,
          entry_eth: c.entry_eth != null ? Number(c.entry_eth) : undefined,
          exit_eth: c.exit_eth != null ? Number(c.exit_eth) : undefined,
          address: c.address,
          evaporated_usd: Number(evaporated_usd.toFixed(2)),
          slippage_pct: Number(c.slip_pct ?? c.slippage_pct) || 0,
        });
      }
    }
  }

  // Real API schema: agent_log is AgentCouncilLogItem[]
  // Fields: {token, ts, agent, verdict, score, reason}
  const agent_log: AgentCouncilLogItem[] = [];
  if (Array.isArray(raw.agent_log)) {
    for (let i = 0; i < raw.agent_log.length; i++) {
      const a = raw.agent_log[i];
      if (a && typeof a === 'object') {
        agent_log.push({
          token: String(a.token || a.symbol || '?'),
          ts: Number(a.ts) || Date.now(),
          agent: String(a.agent || '?'),
          verdict: String(a.verdict || 'approve'),
          score: Number(a.score) || 0,
          reason: String(a.reason || ''),
          id: a.id || `log_${i}`,
          danger_type: a.danger_type,
        });
      }
    }
  }

  const nPositions = Object.keys(positions).length;
  const risk_status = raw.risk_status || {
    max_positions: 4,
    current_positions: nPositions,
    risk_gate_open: true,
    cooldown_sec: 0,
    daily_drawdown_pct: 0,
    max_daily_drawdown_pct: 25.0,
  };

  return {
    mode,
    start_equity,
    cash_usd,
    equity_usd,
    current_equity: equity_usd,
    _onchain_usd: raw._onchain_usd != null ? Number(raw._onchain_usd) : undefined,
    positions,
    closed,
    agent_log: agent_log.length > 0 ? agent_log : (fallback.agent_log || []),
    risk_status,
  };
}
