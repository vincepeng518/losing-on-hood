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
        // 2026-09-04 定罪: bot 的 entry_ep = 開倉當下 ETH/USD 價(~2524), 不是幣價!
        // 幣價正確來源: entry_info_px (開倉當下 token_info 報價, bot L734 已存)
        const entry_price = Number(p.entry_price ?? p.entry_info_px) || 0;
        
        // last_chg 在 python bot 為小數比率 (如 0.15 = +15%), 也可能為百分比 (>2)
        const lastChgRatio = p.last_chg != null ? Number(p.last_chg) : undefined;
        const normalizedChgDecimal = lastChgRatio != null 
          ? (Math.abs(lastChgRatio) > 2 ? lastChgRatio / 100 : lastChgRatio)
          : undefined;

        // current_price: 依序優先取 current_price、entry_info_px、由 last_chg 推算，最後 fallback entry_price
        const current_price = Number(
          p.current_price ?? 
          (entry_price > 0 && normalizedChgDecimal != null 
            ? entry_price * (1 + normalizedChgDecimal) 
            : p.entry_info_px)
        ) || entry_price;

        // held_min: python bot 存 opened_ts (unix 秒數)，若無 held_min 則以當前時間動態計算
        const held_min = Number(p.held_min) || (
          p.opened_ts ? Math.max(0, Math.round((Date.now() / 1000 - Number(p.opened_ts)) / 60)) : 0
        );

        // peak: peak_chg 在 python 為比率 (0.45 = +45%)，前端統一以百分比呈現 (45)
        const peakRaw = p.peak ?? (p.peak_chg != null 
          ? (Math.abs(Number(p.peak_chg)) <= 5 ? Number(p.peak_chg) * 100 : Number(p.peak_chg)) 
          : undefined);
        const peak = Number(peakRaw) || 0;

        const current_pnl_pct = p.current_pnl_pct != null
          ? Number(p.current_pnl_pct)
          : (entry_price > 0 && current_price > 0
              ? ((current_price - entry_price) / entry_price) * 100
              : (normalizedChgDecimal != null ? normalizedChgDecimal * 100 : 0));

        const current_pnl_usd = Number(p.current_pnl_usd) || 
          (alloc_usd != null ? (alloc_usd * current_pnl_pct) / 100 : 0);
        const slip_pct = Number(p.slip_pct ?? p.slippage_pct) || 0;
        const gas_usd = Number(p.gas_usd) || 0;

        // address: python bot 以地址作為 positions 字典 key，若 p.address 為空則取 key
        const posAddress = p.address || (typeof key === 'string' && key.startsWith('0x') ? key : undefined);

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
          address: posAddress,
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
        const pnl_usd = Number(c.pnl_usd ?? c.net_usd) || 0;
        const alloc_usd = !isNaN(_allocRaw) && _allocRaw > 0
          ? _allocRaw
          // 舊紀錄無 alloc：由 pnl_pct 與 pnl_usd (或 net_usd) 反推 (alloc = pnl / pct×100)
          : (Number(c.pnl_pct) && pnl_usd ? Math.abs(pnl_usd / (Number(c.pnl_pct) / 100)) : undefined);
        const peakRaw = c.peak ?? (c.peak_chg != null 
          ? (Math.abs(Number(c.peak_chg)) <= 5 ? Number(c.peak_chg) * 100 : Number(c.peak_chg)) 
          : undefined);
        const peak = Number(peakRaw) || 0;
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
          address: a.address ? String(a.address) : (typeof a.token === 'string' && a.token.startsWith('0x') ? a.token : undefined),
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
    agent_log: agent_log.length > 0 ? agent_log : (mode === 'live' ? [] : (fallback.agent_log || [])), // live 空就空，不吃 mock
    risk_status,
  };
}
