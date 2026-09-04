export type TradingMode = 'paper' | 'live';

export type AgentName = 'scanner' | 'narrative' | 'sniper' | 'judge' | 'risk';

export type AgentVerdict = 'approve' | 'veto';

export type ExitMethod = string;

export interface AgentMeetingItem {
  agent: string;
  verdict: string;
  score: number;
  reason: string;
}

export interface ClosedTrade {
  symbol: string;
  time: string;
  alloc_usd?: number;
  entry_price: number;
  exit_price: number;
  pnl_usd: number;
  pnl_pct: number;
  peak: number;
  slip_pct: number;
  gas_usd: number;
  method: string;
  exit_reason: string;
  held_min: number;
  meeting: AgentMeetingItem[];
  // Optional client runtime / compatibility fields
  id?: string;
  entry_eth?: number;
  exit_eth?: number;
  address?: string;
  evaporated_usd?: number;
  slippage_pct?: number; // alias
}

export interface ActivePosition {
  symbol: string;
  alloc_usd?: number;
  entry_price: number;
  current_price: number;
  held_min: number;
  peak: number;
  current_pnl_pct: number;
  current_pnl_usd: number;
  slip_pct: number;
  gas_usd: number;
  id?: string;
  address?: string;
  entry_eth?: number;
  entry_time?: number;
  meeting?: AgentMeetingItem[];
  sparkline?: number[];
  entry_idx?: number;
  peak_idx?: number;
  order_book_health?: 'healthy' | 'caution' | 'critical_dump';
}

export interface AgentCouncilLogItem {
  token: string;
  ts: number;
  agent: string;
  verdict: string;
  score: number;
  reason: string;
  id?: string;
  danger_type?: string;
  address?: string;
}

export interface AccountState {
  mode: TradingMode;
  start_equity: number;
  cash_usd: number;
  equity_usd: number;
  current_equity?: number;
  _onchain_usd?: number;
  positions: Record<string, ActivePosition>;
  closed: ClosedTrade[];
  agent_log?: AgentCouncilLogItem[];
  risk_status?: {
    max_positions: number;
    current_positions: number;
    risk_gate_open: boolean;
    cooldown_sec: number;
    daily_drawdown_pct: number;
    max_daily_drawdown_pct: number;
  };
}

export interface EquityPoint {
  index: number;
  time: string;
  trade_symbol: string;
  trade_pnl: number;
  equity: number;
  drawdown_pct: number;
  peak_equity: number;
  simulated_equity?: number;
  simulated_diff?: number;
}

export interface ExitReasonBreakdownItem {
  category: 'flow_collapse' | 'fast_dump' | 'giveback' | 'downtrend' | 'condition_filled' | 'other';
  label: string;
  count: number;
  percentage: number;
  total_loss_usd: number;
  color: string;
  description: string;
}

export interface AgentPerformanceStat {
  name: AgentName;
  total_reviewed: number;
  approvals: number;
  vetos: number;
  veto_rate: number;
  avg_score: number;
  honeypots_blocked?: number;
  whale_dumps_blocked?: number;
  sniper_win_rate?: number;
  sniper_avg_surge?: number;
  anti_repeat_loss_blocked?: number;
  risk_gates_triggered?: number;
}

export interface AgentWeightsConfig {
  scanner: number;
  narrative: number;
  sniper: number;
  judge: number;
  risk: number;
  sniper_chase_tolerance?: 'conservative' | 'moderate' | 'aggressive';
}

export interface DangerToast {
  id: string;
  ts: number;
  token: string;
  agent: AgentName | string;
  level: 'critical' | 'warning';
  title: string;
  detail: string;
  metric?: string;
  danger_type?: 'honeypot' | 'whale_concentration' | 'liquidity_drain' | string;
}
