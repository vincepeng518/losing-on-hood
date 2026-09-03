export type TradingMode = 'paper' | 'live';

export type AgentName = 'scanner' | 'narrative' | 'sniper' | 'judge' | 'risk';

export type AgentVerdict = 'approve' | 'veto';

export interface AgentMeetingItem {
  agent: AgentName;
  verdict: AgentVerdict;
  score: number;
  reason: string;
  raw_reason?: string;
  metric?: string;
}

export type ExitMethod = 
  | 'flow_collapse' 
  | 'fast_dump' 
  | 'giveback' 
  | 'downtrend' 
  | 'condition_filled' 
  | 'take_profit' 
  | 'stop_loss' 
  | 'judge_exit' 
  | 'manual';

export interface ClosedTrade {
  id: string;
  symbol: string;
  address?: string;
  time: string;
  alloc_usd: number;
  entry_price: number;
  exit_price: number;
  entry_eth: number;
  exit_eth: number;
  pnl_usd: number;
  pnl_pct: number;
  peak: number; // Highest unrealized % reached during trade (e.g. 145.2%)
  evaporated_usd?: number; // Estimated profit lost from peak
  slippage_pct: number;
  gas_usd: number;
  method: ExitMethod | string;
  exit_reason: string;
  held_min: number;
  tx_in?: string;
  tx_out?: string;
  meeting: AgentMeetingItem[];
}

export interface ActivePosition {
  id: string;
  symbol: string;
  address: string;
  alloc_usd: number;
  entry_price: number;
  current_price: number;
  entry_eth: number;
  entry_time: number;
  held_min: number;
  peak: number;
  current_pnl_pct: number;
  current_pnl_usd: number;
  slip_pct: number;
  gas_usd: number;
  meeting?: AgentMeetingItem[];
}

export interface AgentCouncilLogItem {
  id: string;
  ts: number;
  token: string;
  address?: string;
  agent: AgentName;
  verdict: AgentVerdict;
  score: number;
  reason: string;
  raw_signal?: string;
}

export interface AccountState {
  mode: TradingMode;
  start_equity: number;
  current_equity: number;
  cash_usd: number;
  onchain_eth?: number;
  positions: Record<string, ActivePosition>;
  closed: ClosedTrade[];
  agent_log: AgentCouncilLogItem[];
  risk_status: {
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
}
