import React, { useState } from 'react';
import { AccountState, EquityPoint } from '../types';
import { buildEquityCurve } from '../tradeEnricher';
import { formatUsd, formatPercent, formatPrice, formatTimestamp, getAgentColor } from '../formatters';
import { 
  TrendingDown, 
  TrendingUp, 
  AlertTriangle, 
  Flame, 
  Wallet, 
  ShieldCheck, 
  Clock, 
  Percent, 
  ArrowUpRight, 
  ArrowDownRight,
  Info
} from 'lucide-react';

interface PortfolioDashboardProps {
  state: AccountState;
  onNavigateToTrades: (filter?: string) => void;
  onNavigateToShame: () => void;
}

export const PortfolioDashboard: React.FC<PortfolioDashboardProps> = ({
  state,
  onNavigateToTrades,
  onNavigateToShame,
}) => {
  const [hoveredPoint, setHoveredPoint] = useState<EquityPoint | null>(null);

  const closedTrades = state.closed || [];
  const activePositions = Object.values(state.positions || {});
  
  // Realized calculations
  const totalRealizedPnl = closedTrades.reduce((sum, t) => sum + (t.pnl_usd || 0), 0);
  const totalGasUsd = closedTrades.reduce((sum, t) => sum + (t.gas_usd || 0), 0) +
    activePositions.reduce((sum, p) => sum + (p.gas_usd || 0), 0);
  
  const winningTrades = closedTrades.filter((t) => t.pnl_usd > 0);
  const winRate = closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0;

  // Worst trade
  const worstTrade = closedTrades.length > 0
    ? [...closedTrades].sort((a, b) => a.pnl_usd - b.pnl_usd)[0]
    : null;

  // Giveback trades (peaked > 50% but closed < 0)
  const givebackTrades = closedTrades.filter((t) => (t.peak || 0) >= 50 && t.pnl_usd < 0);

  // Active positions unrealized PnL
  const totalUnrealizedPnl = activePositions.reduce((sum, p) => sum + p.current_pnl_usd, 0);

  // Equity Curve Data
  const equityPoints = buildEquityCurve(state.start_equity, closedTrades);
  const maxDrawdown = equityPoints.reduce((max, pt) => Math.max(max, pt.drawdown_pct), 0);

  // SVG Chart Dimensions
  const chartWidth = 720;
  const chartHeight = 220;
  const padding = { top: 20, right: 30, bottom: 35, left: 55 };

  const minEquity = Math.min(...equityPoints.map((p) => p.equity), state.start_equity * 0.7);
  const maxEquity = Math.max(...equityPoints.map((p) => p.equity), state.start_equity * 1.15);

  const getX = (idx: number) => {
    if (equityPoints.length <= 1) return padding.left;
    const innerW = chartWidth - padding.left - padding.right;
    return padding.left + (idx / (equityPoints.length - 1)) * innerW;
  };

  const getY = (val: number) => {
    const innerH = chartHeight - padding.top - padding.bottom;
    const range = maxEquity - minEquity || 1;
    return chartHeight - padding.bottom - ((val - minEquity) / range) * innerH;
  };

  // Generate SVG path points
  const linePoints = equityPoints.map((p, i) => `${getX(i)},${getY(p.equity)}`).join(' ');
  const areaPoints = `${getX(0)},${chartHeight - padding.bottom} ${linePoints} ${getX(equityPoints.length - 1)},${chartHeight - padding.bottom}`;

  const isNetPositive = totalRealizedPnl >= 0;

  return (
    <div className="space-y-6">
      {/* Top Banner Alert if high giveback detected */}
      {givebackTrades.length > 0 && (
        <div 
          onClick={onNavigateToShame}
          className="group relative cursor-pointer overflow-hidden rounded-3xl border border-rose-500/40 bg-gradient-to-r from-rose-950/50 via-red-900/20 to-neutral-900/60 p-4 shadow-xl backdrop-blur-md transition-all hover:border-rose-400/60"
        >
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-rose-500/20 border border-rose-500/30 text-rose-400">
                <Flame className="h-5 w-5 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold uppercase tracking-wider text-rose-400">
                    重大浮盈回吐警示 (Giveback Alert)
                  </span>
                  <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-mono text-rose-300">
                    {givebackTrades.length} 筆歷史標的浮盈歸零倒貼
                  </span>
                </div>
                <p className="text-xs text-neutral-300">
                  標的如 <span className="font-mono font-bold text-white">${givebackTrades[0]?.symbol}</span> 曾最高飆漲 <span className="font-mono font-bold text-emerald-400">+{givebackTrades[0]?.peak}%</span>，卻因未設動態移動停利最終重虧 <span className="font-mono font-bold text-rose-400">{givebackTrades[0]?.pnl_pct}%</span>。
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 self-end sm:self-center font-mono text-xs text-rose-300 group-hover:text-white transition-colors">
              <span>查看恥辱榜與回測挽救方案</span>
              <ArrowUpRight className="h-4 w-4" />
            </div>
          </div>
        </div>
      )}

      {/* KPI Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {/* Card 1: Current Equity */}
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-md transition-all hover:border-white/20">
          <div className="flex items-center justify-between text-xs text-neutral-400">
            <span>當前帳戶淨值</span>
            <Wallet className="h-3.5 w-3.5 text-neutral-500" />
          </div>
          <div className="mt-2 font-mono text-xl font-bold tracking-tight text-white">
            {formatUsd(state.current_equity)}
          </div>
          <div className="mt-1 flex items-center gap-1 font-mono text-[11px] text-neutral-400">
            <span>初始本金: {formatUsd(state.start_equity)}</span>
          </div>
        </div>

        {/* Card 2: Realized PnL */}
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-md transition-all hover:border-white/20">
          <div className="flex items-center justify-between text-xs text-neutral-400">
            <span>已實現損益</span>
            {isNetPositive ? (
              <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5 text-rose-400" />
            )}
          </div>
          <div className={`mt-2 font-mono text-xl font-bold tracking-tight ${isNetPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
            {formatUsd(totalRealizedPnl, { showPlus: true })}
          </div>
          <div className="mt-1 flex items-center gap-1 font-mono text-[11px] text-neutral-400">
            <span>已平倉 {closedTrades.length} 筆</span>
          </div>
        </div>

        {/* Card 3: Win Rate */}
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-md transition-all hover:border-white/20">
          <div className="flex items-center justify-between text-xs text-neutral-400">
            <span>勝率 (Win Rate)</span>
            <Percent className="h-3.5 w-3.5 text-neutral-500" />
          </div>
          <div className="mt-2 font-mono text-xl font-bold tracking-tight text-white">
            {winRate.toFixed(0)}%
          </div>
          <div className="mt-1 flex items-center gap-1 font-mono text-[11px] text-neutral-400">
            <span className="text-emerald-400">{winningTrades.length} 勝</span>
            <span>/</span>
            <span className="text-rose-400">{closedTrades.length - winningTrades.length} 負</span>
          </div>
        </div>

        {/* Card 4: Gas Spent */}
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-md transition-all hover:border-white/20">
          <div className="flex items-center justify-between text-xs text-neutral-400">
            <span>累積 Gas 磨損</span>
            <Flame className="h-3.5 w-3.5 text-amber-500" />
          </div>
          <div className="mt-2 font-mono text-xl font-bold tracking-tight text-amber-400">
            ${totalGasUsd.toFixed(2)}
          </div>
          <div className="mt-1 flex items-center gap-1 font-mono text-[11px] text-neutral-400">
            <span>佔總資金 {((totalGasUsd / state.start_equity) * 100).toFixed(1)}%</span>
          </div>
        </div>

        {/* Card 5: Max Drawdown */}
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-md transition-all hover:border-white/20">
          <div className="flex items-center justify-between text-xs text-neutral-400">
            <span>最大歷史回撤</span>
            <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />
          </div>
          <div className="mt-2 font-mono text-xl font-bold tracking-tight text-rose-400">
            -{maxDrawdown.toFixed(1)}%
          </div>
          <div className="mt-1 flex items-center gap-1 font-mono text-[11px] text-neutral-400">
            <span>風控上限 25.0%</span>
          </div>
        </div>

        {/* Card 6: Worst Trade */}
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-md transition-all hover:border-white/20">
          <div className="flex items-center justify-between text-xs text-neutral-400">
            <span>最深單筆虧損</span>
            <ShieldCheck className="h-3.5 w-3.5 text-neutral-500" />
          </div>
          <div className="mt-2 font-mono text-xl font-bold tracking-tight text-rose-400">
            {worstTrade ? `${worstTrade.pnl_pct.toFixed(1)}%` : '無'}
          </div>
          <div className="mt-1 flex items-center gap-1 font-mono text-[11px] text-neutral-400">
            <span>{worstTrade ? `$${worstTrade.symbol}` : '--'}</span>
          </div>
        </div>
      </div>

      {/* Hero Asset Drawdown SVG Curve Card */}
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md shadow-2xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-white/10 pb-4">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span>資產淨值與回撤走勢 (Equity & Drawdown Timeline)</span>
              <span className="rounded-full bg-white/5 border border-white/10 px-2 py-0.5 text-[10px] font-mono text-neutral-400">
                逐筆平倉結算點
              </span>
            </h2>
            <p className="text-xs text-neutral-400">
              從初始本金 ${state.start_equity.toFixed(2)} 到當前淨值 ${state.current_equity.toFixed(2)}，滑鼠懸停查看單筆 PnL 與累積回撤深度
            </p>
          </div>

          {hoveredPoint ? (
            <div className="flex items-center gap-4 rounded-2xl bg-white/5 px-3 py-1.5 border border-white/10 font-mono text-xs">
              <div>
                <span className="text-neutral-400">標的: </span>
                <span className="font-bold text-white">${hoveredPoint.trade_symbol}</span>
              </div>
              <div>
                <span className="text-neutral-400">淨值: </span>
                <span className="font-bold text-white">${hoveredPoint.equity.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-neutral-400">回撤: </span>
                <span className="font-bold text-rose-400">-{hoveredPoint.drawdown_pct}%</span>
              </div>
            </div>
          ) : (
            <div className="font-mono text-xs text-neutral-500">
              滑鼠指向圖表節點查看明細
            </div>
          )}
        </div>

        {/* SVG Curve Canvas */}
        <div className="mt-6 w-full overflow-x-auto">
          <svg 
            viewBox={`0 0 ${chartWidth} ${chartHeight}`} 
            className="w-full h-auto overflow-visible select-none"
          >
            <defs>
              <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10B981" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#EF4444" stopOpacity="0.0" />
              </linearGradient>
              <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#10B981" />
                <stop offset="70%" stopColor="#F59E0B" />
                <stop offset="100%" stopColor="#EF4444" />
              </linearGradient>
            </defs>

            {/* Horizontal Grid lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
              const val = minEquity + (maxEquity - minEquity) * (1 - ratio);
              const y = padding.top + ratio * (chartHeight - padding.top - padding.bottom);
              return (
                <g key={idx}>
                  <line
                    x1={padding.left}
                    y1={y}
                    x2={chartWidth - padding.right}
                    y2={y}
                    stroke="rgba(255, 255, 255, 0.07)"
                    strokeDasharray="4 4"
                  />
                  <text
                    x={padding.left - 8}
                    y={y + 4}
                    fill="#737373"
                    fontSize="10"
                    fontFamily="monospace"
                    textAnchor="end"
                  >
                    ${val.toFixed(1)}
                  </text>
                </g>
              );
            })}

            {/* Baseline 100$ starting equity */}
            <line
              x1={padding.left}
              y1={getY(state.start_equity)}
              x2={chartWidth - padding.right}
              y2={getY(state.start_equity)}
              stroke="rgba(245, 158, 11, 0.4)"
              strokeWidth="1.5"
              strokeDasharray="6 3"
            />
            <text
              x={chartWidth - padding.right}
              y={getY(state.start_equity) - 6}
              fill="#F59E0B"
              fontSize="9"
              fontFamily="monospace"
              textAnchor="end"
            >
              本金基準 ${state.start_equity.toFixed(0)}
            </text>

            {/* Area fill */}
            <polygon
              points={areaPoints}
              fill="url(#equityGrad)"
            />

            {/* Main Equity Line */}
            <polyline
              fill="none"
              stroke="url(#lineGrad)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={linePoints}
            />

            {/* Interactive Data Points */}
            {equityPoints.map((pt, i) => {
              const x = getX(i);
              const y = getY(pt.equity);
              const isHovered = hoveredPoint?.index === pt.index;

              return (
                <g 
                  key={i}
                  onMouseEnter={() => setHoveredPoint(pt)}
                  onMouseLeave={() => setHoveredPoint(null)}
                  className="cursor-pointer"
                >
                  <circle
                    cx={x}
                    cy={y}
                    r={isHovered ? 6 : 4}
                    fill={pt.trade_pnl >= 0 ? '#10B981' : '#EF4444'}
                    stroke="#050505"
                    strokeWidth={isHovered ? 3 : 2}
                    className="transition-all duration-150"
                  />
                  {/* Symbol label below point */}
                  <text
                    x={x}
                    y={chartHeight - padding.bottom + 16}
                    fill={isHovered ? '#FFFFFF' : '#737373'}
                    fontSize="9"
                    fontFamily="monospace"
                    textAnchor="middle"
                  >
                    {pt.trade_symbol}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Active Positions Monitor */}
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md shadow-2xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white">
                進行中持倉監控 (Active Positions)
              </h2>
              <span className="rounded-full bg-emerald-500/20 border border-emerald-500/30 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                {activePositions.length} / {state.risk_status.max_positions} 槽位
              </span>
            </div>
            <p className="text-xs text-neutral-400">
              鏈上實時價格、最高浮盈點與手續費磨損追蹤
            </p>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="text-neutral-400">未實現損益:</span>
            <span className={`font-bold ${totalUnrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {formatUsd(totalUnrealizedPnl, { showPlus: true })}
            </span>
          </div>
        </div>

        {activePositions.length === 0 ? (
          <div className="py-12 text-center text-xs text-neutral-500 font-mono">
            目前無進行中持倉，5-Agent 正在全鏈即時掃描新池子與動能訊號...
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {activePositions.map((pos) => {
              const isProfit = pos.current_pnl_usd >= 0;
              return (
                <div 
                  key={pos.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition-all hover:border-white/20"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-base font-bold text-white">${pos.symbol}</span>
                        <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-300">
                          PEAK +{pos.peak.toFixed(1)}%
                        </span>
                      </div>
                      <div className="mt-1 font-mono text-xs text-neutral-400">
                        {pos.address.slice(0, 8)}...{pos.address.slice(-6)}
                      </div>
                    </div>

                    <div className="text-right">
                      <div className={`font-mono text-base font-bold ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {formatPercent(pos.current_pnl_pct, { showPlus: true })}
                      </div>
                      <div className={`font-mono text-xs ${isProfit ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>
                        {formatUsd(pos.current_pnl_usd, { showPlus: true })}
                      </div>
                    </div>
                  </div>

                  {/* Position Details Row */}
                  <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-black/40 p-2.5 font-mono text-xs">
                    <div>
                      <span className="text-neutral-500">開倉金額: </span>
                      <span className="text-neutral-200">${pos.alloc_usd.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-neutral-500">進場價: </span>
                      <span className="text-neutral-200">{formatPrice(pos.entry_price)}</span>
                    </div>
                    <div>
                      <span className="text-neutral-500">當前價: </span>
                      <span className="text-neutral-200">{formatPrice(pos.current_price)}</span>
                    </div>
                    <div>
                      <span className="text-neutral-500">持倉時間: </span>
                      <span className="text-neutral-200">{pos.held_min} 分鐘</span>
                    </div>
                    <div>
                      <span className="text-neutral-500">滑價: </span>
                      <span className="text-neutral-200">{pos.slip_pct}%</span>
                    </div>
                    <div>
                      <span className="text-neutral-500">Gas 磨損: </span>
                      <span className="text-amber-400">${pos.gas_usd.toFixed(3)}</span>
                    </div>
                  </div>

                  {/* 5-Agent Deliberation Mini-Badges */}
                  {pos.meeting && pos.meeting.length > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[10px] text-neutral-500">開倉決策:</span>
                      {pos.meeting.map((m, idx) => {
                        const style = getAgentColor(m.agent);
                        return (
                          <span
                            key={idx}
                            className={`rounded-md border ${style.border} ${style.bg} ${style.text} px-1.5 py-0.5 font-mono text-[10px]`}
                            title={m.reason}
                          >
                            {m.agent}: {m.score}分
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
