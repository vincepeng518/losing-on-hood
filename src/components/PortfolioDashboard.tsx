import React, { useState } from 'react';
import { AccountState, EquityPoint, ActivePosition } from '../types';
import { buildEquityCurve, calculateExitReasonBreakdown } from '../tradeEnricher';
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
  Info,
  Sparkles,
  Layers,
  Activity,
  BarChart3,
  ShieldAlert
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
  const [showSimulatedTrailing, setShowSimulatedTrailing] = useState<boolean>(true);

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

  // Equity Curve Data (Realized + Trailing Stop Simulation)
  const equityPoints = buildEquityCurve(state.start_equity, closedTrades, 30, 65);
  const maxDrawdown = equityPoints.reduce((max, pt) => Math.max(max, pt.drawdown_pct), 0);

  // Trailing stop profit comparison
  const lastPoint = equityPoints[equityPoints.length - 1];
  const totalSavedUsd = lastPoint && lastPoint.simulated_equity
    ? Math.max(0, lastPoint.simulated_equity - lastPoint.equity)
    : 0;

  // Exit reason breakdown
  const exitBreakdowns = calculateExitReasonBreakdown(closedTrades);

  // SVG Chart Dimensions
  const chartWidth = 720;
  const chartHeight = 230;
  const padding = { top: 25, right: 35, bottom: 38, left: 55 };

  const allEquities = equityPoints.flatMap((p) => [
    p.equity,
    showSimulatedTrailing && p.simulated_equity ? p.simulated_equity : p.equity,
  ]);
  const minEquity = Math.min(...allEquities, state.start_equity * 0.7);
  const maxEquity = Math.max(...allEquities, state.start_equity * 1.2);

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

  const colWidth = equityPoints.length > 1
    ? (chartWidth - padding.left - padding.right) / (equityPoints.length - 1)
    : 40;

  // X-axis label subsampling to prevent overlapping text (max ~7 labels across chart)
  const xLabelStep = equityPoints.length > 10 ? Math.ceil((equityPoints.length - 1) / 6) : 1;

  // Generate SVG path points
  const realLinePoints = equityPoints.map((p, i) => `${getX(i)},${getY(p.equity)}`).join(' ');
  const realAreaPoints = `${getX(0)},${chartHeight - padding.bottom} ${realLinePoints} ${getX(equityPoints.length - 1)},${chartHeight - padding.bottom}`;

  const simLinePoints = equityPoints
    .map((p, i) => `${getX(i)},${getY(p.simulated_equity || p.equity)}`)
    .join(' ');

  // Gap polygon between Real and Simulated
  const simGapPoints = showSimulatedTrailing
    ? `${equityPoints.map((p, i) => `${getX(i)},${getY(p.simulated_equity || p.equity)}`).join(' ')} ` +
      `${[...equityPoints].reverse().map((p, i) => `${getX(equityPoints.length - 1 - i)},${getY(p.equity)}`).join(' ')}`
    : '';

  const isNetPositive = totalRealizedPnl >= 0;

  // Helper to render Position Sparkline
  const renderSparkline = (pos: ActivePosition) => {
    const prices = pos.sparkline || [
      pos.entry_price * 0.95,
      pos.entry_price,
      pos.entry_price * (1 + (pos.peak || 10) / 100),
      pos.current_price,
    ];
    const sWidth = 320;
    const sHeight = 72;
    const sPad = { top: 12, right: 14, bottom: 18, left: 14 };

    const minP = Math.min(...prices) * 0.98;
    const maxP = Math.max(...prices) * 1.02;
    const pRange = maxP - minP || 1;

    const getSx = (i: number) => {
      const w = sWidth - sPad.left - sPad.right;
      return sPad.left + (i / (prices.length - 1)) * w;
    };
    const getSy = (val: number) => {
      const h = sHeight - sPad.top - sPad.bottom;
      return sHeight - sPad.bottom - ((val - minP) / pRange) * h;
    };

    const sLine = prices.map((p, i) => `${getSx(i)},${getSy(p)}`).join(' ');
    const sArea = `${getSx(0)},${sHeight - sPad.bottom} ${sLine} ${getSx(prices.length - 1)},${sHeight - sPad.bottom}`;

    const entryIdx = pos.entry_idx ?? Math.floor(prices.length * 0.35);
    const peakIdx = pos.peak_idx ?? prices.indexOf(Math.max(...prices));
    const currIdx = prices.length - 1;

    const isCurrentGaining = pos.current_price >= pos.entry_price;

    return (
      <div className="mt-3 rounded-xl border border-white/5 bg-black/50 p-2.5">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-neutral-400" />
            <span className="font-mono text-[11px] font-bold text-neutral-300">
              1 小時 1m 價格走勢微圖 (1H Sparkline)
            </span>
          </div>

          {pos.order_book_health === 'critical_dump' && (
            <span className="flex items-center gap-1 rounded-md bg-rose-500/20 border border-rose-500/40 px-1.5 py-0.5 font-mono text-[10px] font-bold text-rose-300 animate-pulse">
              <AlertTriangle className="h-2.5 w-2.5" />
              買盤崩落邊緣 (Dump Risk)
            </span>
          )}
          {pos.order_book_health === 'healthy' && (
            <span className="flex items-center gap-1 rounded-md bg-emerald-500/20 border border-emerald-500/30 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
              <TrendingUp className="h-2.5 w-2.5" />
              買盤支撐健康 (Healthy Flow)
            </span>
          )}
        </div>

        <div className="relative w-full">
          <svg viewBox={`0 0 ${sWidth} ${sHeight}`} className="w-full h-auto select-none overflow-visible">
            <defs>
              <linearGradient id={`grad-${pos.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={isCurrentGaining ? '#10B981' : '#EF4444'} stopOpacity="0.25" />
                <stop offset="100%" stopColor={isCurrentGaining ? '#10B981' : '#EF4444'} stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Sparkline Area */}
            <polygon points={sArea} fill={`url(#grad-${pos.id})`} />

            {/* Sparkline Polyline */}
            <polyline
              fill="none"
              stroke={isCurrentGaining ? '#10B981' : '#EF4444'}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={sLine}
            />

            {/* In Marker */}
            {entryIdx >= 0 && entryIdx < prices.length && (
              <g>
                <circle
                  cx={getSx(entryIdx)}
                  cy={getSy(prices[entryIdx])}
                  r="3.5"
                  fill="#38BDF8"
                  stroke="#050505"
                  strokeWidth="1.5"
                />
                <text
                  x={getSx(entryIdx)}
                  y={getSy(prices[entryIdx]) - 5}
                  fill="#38BDF8"
                  fontSize="8"
                  fontFamily="monospace"
                  textAnchor="middle"
                  fontWeight="bold"
                >
                  [IN]
                </text>
              </g>
            )}

            {/* Peak Marker */}
            {peakIdx >= 0 && peakIdx < prices.length && (
              <g>
                <circle
                  cx={getSx(peakIdx)}
                  cy={getSy(prices[peakIdx])}
                  r="4"
                  fill="#F59E0B"
                  stroke="#050505"
                  strokeWidth="1.5"
                />
                <text
                  x={getSx(peakIdx)}
                  y={getSy(prices[peakIdx]) - 5}
                  fill="#F59E0B"
                  fontSize="8"
                  fontFamily="monospace"
                  textAnchor="middle"
                  fontWeight="bold"
                >
                  [PEAK +{pos.peak.toFixed(0)}%]
                </text>
              </g>
            )}

            {/* Current Price Marker */}
            <circle
              cx={getSx(currIdx)}
              cy={getSy(prices[currIdx])}
              r="3"
              fill={isCurrentGaining ? '#10B981' : '#EF4444'}
              className="animate-pulse"
            />
          </svg>
        </div>

        <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-neutral-400">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
            進場: {formatPrice(pos.entry_price)}
          </span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            歷史最高: +{pos.peak.toFixed(1)}%
          </span>
          <span className="flex items-center gap-1 text-white font-bold">
            現價: {formatPrice(pos.current_price)}
          </span>
        </div>
      </div>
    );
  };

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
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {/* Card 1: Current Equity */}
        <div className="rounded-none border border-white/10 bg-white/[0.03] p-3 sm:p-4 backdrop-blur-md transition-all hover:border-white/20 flex flex-col justify-between min-h-[96px] sm:min-h-[108px]">
          <div>
            <div className="flex items-center justify-between text-xs text-neutral-400">
              <span>當前帳戶淨值</span>
              <Wallet className="h-3.5 w-3.5 text-neutral-500" />
            </div>
            <div className="mt-1.5 sm:mt-2 font-mono text-lg sm:text-xl font-bold tracking-tight text-white">
              {formatUsd(state.equity_usd ?? state.current_equity ?? state.start_equity)}
            </div>
          </div>
          <div className="mt-1 flex items-center gap-1 font-mono text-[10px] sm:text-[11px] text-neutral-400">
            <span>初始本金: {formatUsd(state.start_equity)}</span>
          </div>
        </div>

        {/* Card 2: Realized PnL */}
        <div className="rounded-none border border-white/10 bg-white/[0.03] p-3 sm:p-4 backdrop-blur-md transition-all hover:border-white/20 flex flex-col justify-between min-h-[96px] sm:min-h-[108px]">
          <div>
            <div className="flex items-center justify-between text-xs text-neutral-400">
              <span>已實現損益</span>
              {isNetPositive ? (
                <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5 text-rose-400" />
              )}
            </div>
            <div className={`mt-1.5 sm:mt-2 font-mono text-lg sm:text-xl font-bold tracking-tight ${isNetPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
              {formatUsd(totalRealizedPnl, { showPlus: true })}
            </div>
          </div>
          <div className="mt-1 flex items-center gap-1 font-mono text-[10px] sm:text-[11px] text-neutral-400">
            <span>已平倉 {closedTrades.length} 筆</span>
          </div>
        </div>

        {/* Card 3: Win Rate */}
        <div className="rounded-none border border-white/10 bg-white/[0.03] p-3 sm:p-4 backdrop-blur-md transition-all hover:border-white/20 flex flex-col justify-between min-h-[96px] sm:min-h-[108px]">
          <div>
            <div className="flex items-center justify-between text-xs text-neutral-400">
              <span>勝率 (Win Rate)</span>
              <Percent className="h-3.5 w-3.5 text-neutral-500" />
            </div>
            <div className="mt-1.5 sm:mt-2 font-mono text-lg sm:text-xl font-bold tracking-tight text-white">
              {winRate.toFixed(0)}%
            </div>
          </div>
          <div className="mt-1 flex items-center gap-1 font-mono text-[10px] sm:text-[11px] text-neutral-400">
            <span className="text-emerald-400">{winningTrades.length} 勝</span>
            <span>/</span>
            <span className="text-rose-400">{closedTrades.length - winningTrades.length} 負</span>
          </div>
        </div>

        {/* Card 4: Gas Spent */}
        <div className="rounded-none border border-white/10 bg-white/[0.03] p-3 sm:p-4 backdrop-blur-md transition-all hover:border-white/20 flex flex-col justify-between min-h-[96px] sm:min-h-[108px]">
          <div>
            <div className="flex items-center justify-between text-xs text-neutral-400">
              <span>累積 Gas 磨損</span>
              <Flame className="h-3.5 w-3.5 text-amber-500" />
            </div>
            <div className="mt-1.5 sm:mt-2 font-mono text-lg sm:text-xl font-bold tracking-tight text-amber-400">
              ${totalGasUsd.toFixed(2)}
            </div>
          </div>
          <div className="mt-1 flex items-center gap-1 font-mono text-[10px] sm:text-[11px] text-neutral-400">
            <span>佔總資金 {((totalGasUsd / state.start_equity) * 100).toFixed(1)}%</span>
          </div>
        </div>

        {/* Card 5: Max Drawdown */}
        <div className="rounded-none border border-white/10 bg-white/[0.03] p-3 sm:p-4 backdrop-blur-md transition-all hover:border-white/20 flex flex-col justify-between min-h-[96px] sm:min-h-[108px]">
          <div>
            <div className="flex items-center justify-between text-xs text-neutral-400">
              <span>最大歷史回撤</span>
              <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />
            </div>
            <div className="mt-1.5 sm:mt-2 font-mono text-lg sm:text-xl font-bold tracking-tight text-rose-400">
              -{maxDrawdown.toFixed(1)}%
            </div>
          </div>
          <div className="mt-1 flex items-center gap-1 font-mono text-[10px] sm:text-[11px] text-neutral-400">
            <span>風控上限 25.0%</span>
          </div>
        </div>

        {/* Card 6: Worst Trade */}
        <div className="rounded-none border border-white/10 bg-white/[0.03] p-3 sm:p-4 backdrop-blur-md transition-all hover:border-white/20 flex flex-col justify-between min-h-[96px] sm:min-h-[108px]">
          <div>
            <div className="flex items-center justify-between text-xs text-neutral-400">
              <span>最深單筆虧損</span>
              <ShieldCheck className="h-3.5 w-3.5 text-neutral-500" />
            </div>
            <div className="mt-1.5 sm:mt-2 font-mono text-lg sm:text-xl font-bold tracking-tight text-rose-400">
              {worstTrade ? `${worstTrade.pnl_pct.toFixed(1)}%` : '無'}
            </div>
          </div>
          <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] sm:text-[11px] overflow-hidden">
            <span 
              className="rounded-none bg-rose-500/15 border border-rose-500/30 px-1.5 py-0.5 font-bold text-rose-300 truncate max-w-[110px]"
              title={worstTrade ? `$${worstTrade.symbol}` : '--'}
            >
              {worstTrade ? `$${worstTrade.symbol}` : '--'}
            </span>
            {worstTrade && (
              <span className="text-neutral-500 shrink-0 text-[10px]">
                (-${Math.abs(worstTrade.pnl_usd).toFixed(1)})
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Hero Asset Drawdown SVG Curve Card with Simulated Trailing Stop Overlay */}
      <div className="rounded-none border border-white/10 bg-white/[0.03] p-4 sm:p-6 backdrop-blur-md shadow-2xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <h2 className="text-sm sm:text-base font-bold text-white flex flex-wrap items-center gap-2">
              <span>資產淨值走勢與回測分叉軌跡</span>
              <span className="rounded-none bg-white/5 border border-white/10 px-1.5 sm:px-2 py-0.5 text-[9px] sm:text-[10px] font-mono text-neutral-400">
                逐筆平倉結算
              </span>
            </h2>
            <p className="text-[11px] sm:text-xs text-neutral-400 mt-0.5">
              對比原版未停利實況 vs 「若啟動動態移動停利 (+30% 啟動 / 65% 保底)」的利潤挽救軌跡
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
            {/* Toggle Overlay Button */}
            <button
              onClick={() => setShowSimulatedTrailing(!showSimulatedTrailing)}
              className={`flex items-center justify-center gap-1.5 rounded-none border px-2.5 sm:px-3 py-1.5 font-mono text-xs transition-all w-full sm:w-auto ${
                showSimulatedTrailing
                  ? 'border-emerald-500/50 bg-emerald-950/40 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                  : 'border-white/10 bg-white/5 text-neutral-400 hover:text-white'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>{showSimulatedTrailing ? '已疊加動態移動停利軌跡' : '隱藏模擬停利軌跡'}</span>
              {totalSavedUsd > 0 && (
                <span className="rounded-none bg-emerald-500/20 px-1.5 py-0.2 text-[10px] font-bold text-emerald-400">
                  挽回 +${totalSavedUsd.toFixed(2)}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Dedicated Responsive Info Banner */}
        <div className="mt-3 flex min-h-[2.25rem] py-1.5 items-center justify-between rounded-none border border-white/10 bg-black/40 px-3 font-mono text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            {hoveredPoint ? (
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2.5 text-[11px] sm:text-xs">
                <span className="text-neutral-400">
                  標的: <strong className="text-white">${hoveredPoint.trade_symbol}</strong>
                </span>
                <span className="text-neutral-600 hidden xs:inline">|</span>
                <span className="text-neutral-400">
                  淨值: <strong className="text-white">${hoveredPoint.equity.toFixed(2)}</strong>
                </span>
                <span className="text-neutral-600 hidden xs:inline">|</span>
                <span className="text-neutral-400">
                  損益:{' '}
                  <strong className={hoveredPoint.trade_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                    {hoveredPoint.trade_pnl >= 0 ? `+$${hoveredPoint.trade_pnl.toFixed(2)}` : `-$${Math.abs(hoveredPoint.trade_pnl).toFixed(2)}`}
                  </strong>
                </span>
                {showSimulatedTrailing && hoveredPoint.simulated_equity && (
                  <>
                    <span className="text-neutral-600 hidden sm:inline">|</span>
                    <span className="text-emerald-400">
                      動態停利後: <strong className="text-emerald-300">${hoveredPoint.simulated_equity.toFixed(2)}</strong>
                      <span className="ml-1 text-[10px] text-emerald-400">
                        (+${(hoveredPoint.simulated_equity - hoveredPoint.equity).toFixed(2)})
                      </span>
                    </span>
                  </>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[11px] sm:text-xs">
                {lastPoint ? (
                  <span className="text-neutral-300 flex items-center gap-1.5 flex-wrap">
                    <Activity className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    <span>最新平倉: <strong className="text-white font-mono">${lastPoint.trade_symbol}</strong></span>
                    <span className="text-neutral-600 hidden xs:inline">|</span>
                    <span className="text-neutral-400">損益: <strong className={lastPoint.trade_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{lastPoint.trade_pnl >= 0 ? `+$${lastPoint.trade_pnl.toFixed(2)}` : `-$${Math.abs(lastPoint.trade_pnl).toFixed(2)}`}</strong></span>
                    <span className="text-neutral-500 text-[10px] hidden sm:inline">(點選或觸控圖表節點查看各筆明細)</span>
                  </span>
                ) : (
                  <span className="text-neutral-500 flex items-center gap-1.5 text-[11px] sm:text-xs">
                    <Activity className="h-3.5 w-3.5 text-neutral-500 shrink-0" />
                    點選或觸控圖表節點即可查看各筆平倉實況與動態停利利潤挽救明細
                  </span>
                )}
              </div>
            )}
          </div>
          {hoveredPoint && (
            <span className="hidden sm:inline-block shrink-0 rounded-none bg-white/10 px-2 py-0.5 text-[10px] text-neutral-300 font-bold">
              第 {hoveredPoint.index + 1} / {equityPoints.length} 筆
            </span>
          )}
        </div>

        {/* SVG Curve Canvas */}
        <div className="mt-4 w-full overflow-hidden">
          <svg 
            viewBox={`0 0 ${chartWidth} ${chartHeight}`} 
            className="w-full h-auto overflow-visible select-none touch-manipulation"
            onMouseLeave={() => setHoveredPoint(null)}
          >
            <defs>
              <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#EF4444" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#EF4444" stopOpacity="0.0" />
              </linearGradient>

              <linearGradient id="simGapGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10B981" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#10B981" stopOpacity="0.05" />
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

            {/* Baseline starting equity */}
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

            {/* Salvaged Profit Area Gap (between simulated trailing stop and real curve) */}
            {showSimulatedTrailing && simGapPoints && (
              <polygon
                points={simGapPoints}
                fill="url(#simGapGrad)"
              />
            )}

            {/* Original Area fill */}
            <polygon
              points={realAreaPoints}
              fill="url(#equityGrad)"
            />

            {/* Simulated Trailing Stop Line (Dashed Green/Gold) */}
            {showSimulatedTrailing && (
              <polyline
                fill="none"
                stroke="#10B981"
                strokeWidth="2.5"
                strokeDasharray="6 4"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={simLinePoints}
              />
            )}

            {/* Main Original Equity Line (Solid) */}
            <polyline
              fill="none"
              stroke="url(#lineGrad)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={realLinePoints}
            />

            {/* Active Vertical Crosshair Guideline */}
            {hoveredPoint && (
              <line
                x1={getX(hoveredPoint.index)}
                y1={padding.top}
                x2={getX(hoveredPoint.index)}
                y2={chartHeight - padding.bottom}
                stroke="rgba(255, 255, 255, 0.25)"
                strokeWidth="1"
                strokeDasharray="3 3"
                pointerEvents="none"
              />
            )}

            {/* Interactive Data Points */}
            {equityPoints.map((pt, i) => {
              const x = getX(i);
              const y = getY(pt.equity);
              const isHovered = hoveredPoint?.index === pt.index;

              return (
                <g 
                  key={i}
                  onMouseEnter={() => setHoveredPoint(pt)}
                  onClick={() => setHoveredPoint(pt)}
                  onTouchStart={() => setHoveredPoint(pt)}
                  className="cursor-pointer"
                >
                  {/* Invisible wide hit column - prevents mouse leave flicker */}
                  <rect
                    x={x - colWidth / 2}
                    y={padding.top}
                    width={colWidth}
                    height={chartHeight - padding.top}
                    fill="transparent"
                  />

                  {/* Real point circle */}
                  <circle
                    cx={x}
                    cy={y}
                    r={isHovered ? 5.5 : 3.5}
                    fill={pt.trade_pnl >= 0 ? '#10B981' : '#EF4444'}
                    stroke="#050505"
                    strokeWidth={isHovered ? 2.5 : 1.5}
                    pointerEvents="none"
                  />

                  {/* Simulated point circle */}
                  {showSimulatedTrailing && pt.simulated_equity && pt.simulated_equity !== pt.equity && (
                    <circle
                      cx={x}
                      cy={getY(pt.simulated_equity)}
                      r={isHovered ? 5 : 3}
                      fill="#10B981"
                      stroke="#050505"
                      strokeWidth={1.5}
                      pointerEvents="none"
                    />
                  )}
                </g>
              );
            })}

            {/* X-axis Tick Marks and Adaptive Subsampled Labels (strictly avoids text overlap) */}
            {equityPoints.map((pt, i) => {
              const x = getX(i);
              const isFirst = i === 0;
              const isLast = i === equityPoints.length - 1;
              const isSampled = isFirst || isLast || (i % xLabelStep === 0);
              const isHovered = hoveredPoint?.index === pt.index;

              // Only render if sampled or currently active
              if (!isSampled && !isHovered) return null;

              const labelText = isHovered 
                ? `$${pt.trade_symbol}`
                : isFirst 
                  ? '起點' 
                  : isLast 
                    ? `最新 (#${i})` 
                    : `#${i}`;

              return (
                <g key={`x-tick-${i}`} pointerEvents="none">
                  <line
                    x1={x}
                    y1={chartHeight - padding.bottom}
                    x2={x}
                    y2={chartHeight - padding.bottom + (isHovered ? 6 : 4)}
                    stroke={isHovered ? '#10B981' : 'rgba(255, 255, 255, 0.2)'}
                    strokeWidth={isHovered ? 1.5 : 1}
                  />
                  <text
                    x={x}
                    y={chartHeight - padding.bottom + 16}
                    fill={isHovered ? '#10B981' : isLast ? '#E5E5E5' : '#737373'}
                    fontSize={isHovered ? '10' : '9'}
                    fontFamily="monospace"
                    textAnchor="middle"
                    fontWeight={isHovered || isLast ? 'bold' : 'normal'}
                  >
                    {labelText}
                  </text>
                </g>
              );
            })}

            {/* Interactive Floating Tooltip Badge on Active Point */}
            {hoveredPoint && (() => {
              const hX = getX(hoveredPoint.index);
              const hY = getY(hoveredPoint.equity);
              const isPositive = hoveredPoint.trade_pnl >= 0;
              const tooltipW = 138;
              const tooltipH = 50;
              
              // Clamp X so tooltip doesn't get clipped at chart edges
              const tipX = Math.max(padding.left + 4, Math.min(chartWidth - padding.right - tooltipW - 4, hX - tooltipW / 2));
              // Position above point if enough vertical room, otherwise below
              const tipY = hY - tooltipH - 12 < padding.top ? hY + 12 : hY - tooltipH - 12;

              return (
                <g pointerEvents="none">
                  {/* Tooltip Card Background */}
                  <rect
                    x={tipX}
                    y={tipY}
                    width={tooltipW}
                    height={tooltipH}
                    rx="4"
                    fill="#0A0A0A"
                    stroke={isPositive ? '#10B981' : '#EF4444'}
                    strokeWidth="1.2"
                    strokeOpacity="0.9"
                  />
                  {/* Anchor tick from point to tooltip */}
                  <line
                    x1={hX}
                    y1={hY}
                    x2={hX}
                    y2={hY > tipY ? tipY + tooltipH : tipY}
                    stroke={isPositive ? '#10B981' : '#EF4444'}
                    strokeWidth="1"
                    strokeDasharray="2 2"
                    strokeOpacity="0.6"
                  />
                  {/* Row 1: Symbol & Trade Index */}
                  <text
                    x={tipX + 8}
                    y={tipY + 18}
                    fill="#FFFFFF"
                    fontSize="11"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    ${hoveredPoint.trade_symbol}
                  </text>
                  <text
                    x={tipX + tooltipW - 8}
                    y={tipY + 18}
                    fill="#A3A3A3"
                    fontSize="9"
                    fontFamily="monospace"
                    textAnchor="end"
                  >
                    #{hoveredPoint.index}
                  </text>
                  {/* Row 2: Realized PnL & Current Equity */}
                  <text
                    x={tipX + 8}
                    y={tipY + 36}
                    fill={isPositive ? '#34D399' : '#F87171'}
                    fontSize="10"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    損益: {isPositive ? `+$${hoveredPoint.trade_pnl.toFixed(2)}` : `-$${Math.abs(hoveredPoint.trade_pnl).toFixed(2)}`}
                  </text>
                  <text
                    x={tipX + tooltipW - 8}
                    y={tipY + 36}
                    fill="#A3A3A3"
                    fontSize="9"
                    fontFamily="monospace"
                    textAnchor="end"
                  >
                    ${hoveredPoint.equity.toFixed(1)}
                  </text>
                </g>
              );
            })()}
          </svg>
        </div>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3 font-mono text-xs text-neutral-400">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-5 rounded bg-gradient-to-r from-emerald-500 to-rose-500" />
              <span>實盤淨值軌跡 (原始無移動停利)</span>
            </div>
            {showSimulatedTrailing && (
              <div className="flex items-center gap-1.5 text-emerald-400">
                <span className="h-0.5 w-5 border-t-2 border-dashed border-emerald-400" />
                <span>模擬動態移動停利 (挽回浮盈後淨值)</span>
              </div>
            )}
          </div>
          <div className="text-[11px] text-neutral-500">
            * 模擬參數：觸發峰值 ≥ +30% 時啟動，回撤跌破 65% 保底即鎖利退場
          </div>
        </div>
      </div>

      {/* Exit Reason Breakdown Section */}
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md shadow-2xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-rose-400" />
                <span>退場死因統計 (Exit Reason Breakdown)</span>
              </h2>
              <span className="rounded-full bg-rose-500/20 border border-rose-500/30 px-2 py-0.5 font-mono text-[10px] font-bold text-rose-300">
                虧損漏洞剖析
              </span>
            </div>
            <p className="text-xs text-neutral-400 mt-0.5">
              量化統計歷史交易出場原因比例與對應的虧損金額，直接揭示策略最容易失血的市場情境
            </p>
          </div>

          <div className="font-mono text-xs text-neutral-400">
            平倉樣本數: <span className="text-white font-bold">{closedTrades.length} 筆</span>
          </div>
        </div>

        {/* Visual Progress Bar Distribution */}
        <div className="mt-5">
          <div className="h-4 w-full overflow-hidden rounded-full bg-black/60 flex border border-white/10 p-0.5">
            {exitBreakdowns.map((item) => (
              <div
                key={item.category}
                style={{
                  width: `${item.percentage}%`,
                  backgroundColor: item.color,
                }}
                className="h-full rounded-full transition-all duration-300 relative group cursor-pointer"
                title={`${item.label}: ${item.percentage}% (${item.count} 筆)`}
              />
            ))}
          </div>

          {/* Breakdown cards grid */}
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {exitBreakdowns.map((item) => (
              <div
                key={item.category}
                className="rounded-2xl border border-white/10 bg-white/[0.02] p-3.5 transition-all hover:border-white/20"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span 
                      className="h-2.5 w-2.5 rounded-full" 
                      style={{ backgroundColor: item.color }} 
                    />
                    <span className="font-mono text-xs font-bold text-white">
                      {item.label}
                    </span>
                  </div>
                  <span 
                    className="font-mono text-xs font-bold"
                    style={{ color: item.color }}
                  >
                    {item.percentage}%
                  </span>
                </div>

                <p className="mt-1 text-[11px] text-neutral-400 line-clamp-2 leading-relaxed">
                  {item.description}
                </p>

                <div className="mt-3 flex items-center justify-between pt-2 border-t border-white/5 font-mono text-[11px]">
                  <span className="text-neutral-500">觸發次數: <b className="text-neutral-300">{item.count} 筆</b></span>
                  <span className="text-neutral-500">
                    累計虧損: <b className="text-rose-400">-${item.total_loss_usd.toFixed(2)}</b>
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Quant Doctor Diagnosis summary */}
          <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-950/20 p-3.5 font-mono text-xs text-neutral-300 flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-amber-300">量化審計診斷結論：</span>
              <span>
                系統虧損核心聚集在 <b className="text-white">【買盤崩落 (Flow Collapse)】</b> 與 <b className="text-white">【浮盈回吐 (Giveback)】</b>，兩者合計佔總虧損的 <b className="text-rose-400">75% 以上</b>。建議策略導入 1 分鐘委託單深度監控與動態移動階梯停利，可挽回超過 80% 的已流失利潤。
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Active Positions Monitor with 1H Sparkline */}
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
            <p className="text-xs text-neutral-400 mt-0.5">
              鏈上實時價格、1 小時 1m 走勢微圖、進場點 (In) 與最高浮盈 (Peak) 追蹤
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
                      {pos.address ? (
                        <div className="mt-1 font-mono text-xs text-neutral-400">
                          {pos.address.length > 14
                            ? `${pos.address.slice(0, 8)}...${pos.address.slice(-6)}`
                            : pos.address}
                        </div>
                      ) : (
                        <div className="mt-1 font-mono text-xs text-neutral-500">
                          持倉代碼 #{pos.symbol}
                        </div>
                      )}
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

                  {/* 1H Sparkline with In / Peak indicators */}
                  {renderSparkline(pos)}

                  {/* Position Details Row */}
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 rounded-none bg-black/40 p-2.5 font-mono text-xs">
                    <div>
                      <span className="text-neutral-500">開倉金額: </span>
                      <span className="text-neutral-200">
                        {pos.alloc_usd != null && !isNaN(pos.alloc_usd)
                          ? `$${pos.alloc_usd.toFixed(2)}`
                          : '—'}
                      </span>
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
