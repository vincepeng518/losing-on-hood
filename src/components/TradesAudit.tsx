import React, { useState, useMemo } from 'react';
import { ClosedTrade } from '../types';
import { 
  formatUsd, 
  formatPercent, 
  formatPrice, 
  formatEth, 
  formatTimestamp, 
  translateReason, 
  getAgentColor,
  getExitDiagnosis 
} from '../formatters';
import { 
  Search, 
  Filter, 
  ChevronDown, 
  ChevronUp, 
  Flame, 
  ArrowUpRight, 
  ShieldCheck, 
  ExternalLink,
  Code2,
  CheckCircle2,
  XCircle,
  HelpCircle
} from 'lucide-react';

interface TradesAuditProps {
  trades: ClosedTrade[];
  initialFilter?: string;
}

export const TradesAudit: React.FC<TradesAuditProps> = ({ trades, initialFilter = 'all' }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState(initialFilter);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [showRawSignals, setShowRawSignals] = useState(false);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const expandAll = () => {
    const all: Record<string, boolean> = {};
    trades.forEach((t) => (all[t.id] = true));
    setExpandedIds(all);
  };

  const collapseAll = () => {
    setExpandedIds({});
  };

  // time 可能是 unix 秒數、ISO 字串（+08:00 / +00:00 混雜時區）——統一轉 ms
  const tsNum = (t: unknown): number => {
    if (typeof t === 'number') return t > 1e12 ? t : t * 1000;
    if (typeof t === 'string') {
      if (!isNaN(Number(t)) && !t.includes('-') && !t.includes('T')) return Number(t) > 1e12 ? Number(t) : Number(t) * 1000;
      const d = new Date(t);
      return isNaN(d.getTime()) ? 0 : d.getTime();
    }
    return 0;
  };

  const filteredTrades = useMemo(() => {
    return trades.filter((t) => {
      // Filter tab
      if (activeFilter === 'profit' && t.pnl_usd <= 0) return false;
      if (activeFilter === 'loss' && t.pnl_usd >= 0) return false;
      if (activeFilter === 'giveback' && (t.peak < 30 || t.pnl_usd > 0)) return false;
      if (activeFilter === 'meeting' && (!t.meeting || t.meeting.length === 0)) return false;

      // Search term
      if (!searchTerm) return true;
      const q = searchTerm.toLowerCase();
      const matchSymbol = (t.symbol || '').toLowerCase().includes(q);
      const matchReason = (t.exit_reason || '').toLowerCase().includes(q);
      const matchMethod = String(t.method || '').toLowerCase().includes(q);
      const matchAgent = t.meeting?.some(
        (m) => (m.agent || '').toLowerCase().includes(q) || (m.reason || '').toLowerCase().includes(q)
      );
      return matchSymbol || matchReason || matchMethod || matchAgent;
    }).sort((a, b) => tsNum(b.time) - tsNum(a.time)); // 由新到舊（time 可能是 ISO 字串+混雜時區）
  }, [trades, activeFilter, searchTerm]);

  return (
    <div className="space-y-6">
      {/* Top Search, Filter & Action Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-md">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            placeholder="搜尋代幣符號 (如 HOUND, PEPEHOOD)、退場理由或 Agent 訊號..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-2xl border border-white/10 bg-black/50 py-2 pl-10 pr-4 font-mono text-xs text-white placeholder-neutral-500 focus:border-rose-500/50 focus:outline-none focus:ring-1 focus:ring-rose-500/50"
          />
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          {/* Filter Pills */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar rounded-none bg-black/40 p-1 border border-white/10 text-xs w-full sm:w-auto touch-pan-x">
            {[
              { id: 'all', label: '全部交易' },
              { id: 'meeting', label: '5-Agent 決策' },
              { id: 'profit', label: '獲利結算' },
              { id: 'loss', label: '虧損結算' },
              { id: 'giveback', label: '嚴重回吐' },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setActiveFilter(f.id)}
                className={`shrink-0 whitespace-nowrap rounded-none px-2.5 sm:px-3 py-1 font-mono transition-all min-h-[32px] ${
                  activeFilter === f.id
                    ? 'bg-rose-500/20 text-rose-300 font-bold border border-rose-500/30'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Toggle buttons */}
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap sm:flex-nowrap w-full sm:w-auto justify-end">
            <button
              onClick={() => setShowRawSignals(!showRawSignals)}
              className={`flex items-center gap-1 rounded-none px-2.5 py-1 font-mono text-xs border transition-all min-h-[32px] ${
                showRawSignals
                  ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                  : 'bg-white/5 text-neutral-400 border-white/10 hover:text-white'
              }`}
            >
              <Code2 className="h-3 w-3" />
              <span>{showRawSignals ? '隱藏底層信號' : '顯示底層信號'}</span>
            </button>

            <button
              onClick={expandAll}
              className="rounded-none border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-xs text-neutral-400 hover:text-white transition-colors min-h-[32px]"
            >
              展開全部
            </button>
            <button
              onClick={collapseAll}
              className="rounded-none border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-xs text-neutral-400 hover:text-white transition-colors min-h-[32px]"
            >
              收合全部
            </button>
          </div>
        </div>
      </div>

      {/* Trades List */}
      <div className="space-y-4">
        {filteredTrades.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-white/[0.02] py-16 text-center">
            <HelpCircle className="mx-auto h-8 w-8 text-neutral-600 mb-2" />
            <p className="font-mono text-xs text-neutral-400">沒有符合搜尋或篩選條件的交易紀錄</p>
          </div>
        ) : (
          filteredTrades.map((t) => {
            const isExpanded = !!expandedIds[t.id];
            const isProfit = t.pnl_usd >= 0;
            const diagnosis = getExitDiagnosis(t.exit_reason, t.method);
            const peakVal = t.peak || 0;
            const isBigGiveback = peakVal >= 50 && t.pnl_usd < 0;

            return (
              <div
                key={t.id}
                className={`overflow-hidden rounded-3xl border transition-all ${
                  isBigGiveback
                    ? 'border-rose-500/40 bg-gradient-to-br from-rose-950/20 via-neutral-900/60 to-black/80'
                    : 'border-white/10 bg-white/[0.03] hover:border-white/20'
                } backdrop-blur-md shadow-xl`}
              >
                {/* Trade Header Row (Clickable) */}
                <div
                  onClick={() => toggleExpand(t.id)}
                  className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 sm:p-5 cursor-pointer select-none"
                >
                  <div className="flex items-center gap-3">
                    <button className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/5 border border-white/10 text-neutral-400">
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>

                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-base font-bold text-white">${t.symbol}</span>
                        {peakVal > 0 && (
                          <span className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                            isBigGiveback 
                              ? 'border-rose-500/40 bg-rose-500/20 text-rose-300 animate-pulse' 
                              : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                          }`}>
                            PEAK +{peakVal.toFixed(1)}%
                          </span>
                        )}
                        <span className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold ${diagnosis.color}`}>
                          {diagnosis.tag}
                        </span>
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-neutral-400">
                        <span>{formatTimestamp(t.time)}</span>
                        <span>·</span>
                        <span>{(translateReason(t.exit_reason) || '').slice(0, 38)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 self-end sm:self-center">
                    <div className="text-right">
                      <div className={`font-mono text-base font-bold ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {formatPercent(t.pnl_pct, { showPlus: true })}
                      </div>
                      <div className={`font-mono text-xs ${isProfit ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>
                        {formatUsd(t.pnl_usd, { showPlus: true })}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expanded Details Section */}
                {isExpanded && (
                  <div className="border-t border-white/10 bg-black/40 p-4 sm:p-6 space-y-6 animate-fadeIn">
                    {/* Diagnosis & Giveback Evaporation Banner */}
                    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <span className="font-mono text-xs font-bold text-neutral-400 uppercase">出場觸發診斷 (Exit Diagnosis)</span>
                          <div className="mt-1 text-sm font-semibold text-white">
                            {translateReason(t.exit_reason)}
                          </div>
                          <p className="mt-1 text-xs text-neutral-400">
                            {diagnosis.desc}
                          </p>
                        </div>
                        {t.evaporated_usd && t.evaporated_usd > 0 ? (
                          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-right font-mono">
                            <span className="text-[10px] text-rose-400 block">利潤回吐蒸發</span>
                            <span className="text-sm font-bold text-rose-300">
                              -${t.evaporated_usd.toFixed(2)}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {/* On-Chain Execution Details */}
                    <div>
                      <span className="font-mono text-xs font-bold text-neutral-400 uppercase">鏈上 Execution 參數</span>
                      <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 font-mono text-xs">
                        <div className="rounded-xl bg-white/[0.03] p-2.5 border border-white/5">
                          <span className="text-neutral-500 block text-[10px]">開倉金額</span>
                          <span className="font-semibold text-white">
                            {t.alloc_usd != null && !isNaN(t.alloc_usd)
                              ? `$${t.alloc_usd.toFixed(2)}`
                              : '—'}
                          </span>
                        </div>
                        <div className="rounded-xl bg-white/[0.03] p-2.5 border border-white/5">
                          <span className="text-neutral-500 block text-[10px]">進場價格 (USD / ETH)</span>
                          <span className="font-semibold text-white">{formatPrice(t.entry_price)}</span>
                          <span className="text-neutral-400 block text-[10px]">{formatEth(t.entry_eth)}</span>
                        </div>
                        <div className="rounded-xl bg-white/[0.03] p-2.5 border border-white/5">
                          <span className="text-neutral-500 block text-[10px]">出場價格 (USD / ETH)</span>
                          <span className="font-semibold text-white">{formatPrice(t.exit_price)}</span>
                          <span className="text-neutral-400 block text-[10px]">{formatEth(t.exit_eth)}</span>
                        </div>
                        <div className="rounded-none bg-white/[0.03] p-2.5 border border-white/5">
                          <span className="text-neutral-500 block text-[10px]">持倉時長</span>
                          <span className="font-semibold text-white">{t.held_min} 分鐘</span>
                        </div>
                        <div className="rounded-none bg-white/[0.03] p-2.5 border border-white/5">
                          <span className="text-neutral-500 block text-[10px]">滑價 (Slippage)</span>
                          <span className="font-semibold text-neutral-200">{(t.slip_pct ?? t.slippage_pct ?? 0).toFixed(2)}%</span>
                        </div>
                        <div className="rounded-none bg-white/[0.03] p-2.5 border border-white/5">
                          <span className="text-neutral-500 block text-[10px]">手續費 (Gas USD)</span>
                          <span className="font-semibold text-amber-400">${t.gas_usd.toFixed(3)}</span>
                        </div>
                      </div>

                      {(t as any).address && (
                        <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[11px] text-neutral-500">
                          <span>合約地址: {(t as any).address}</span>
                        </div>
                      )}
                    </div>

                    {/* 5-Agent Council Deliberations Table */}
                    {t.meeting && t.meeting.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-mono text-xs font-bold text-neutral-400 uppercase">
                            5-Agent 開倉委員會審查決策 (Meeting Deliberation)
                          </span>
                          <span className="rounded-none bg-white/5 px-2 py-0.5 font-mono text-[10px] text-neutral-400">
                            全體通過
                          </span>
                        </div>

                        <div className="space-y-2 rounded-none border border-white/10 bg-black/60 p-3">
                          {t.meeting.map((m, idx) => {
                            const style = getAgentColor(m.agent);
                            const isApproved = m.verdict === 'approve';

                            return (
                              <div
                                key={idx}
                                className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 rounded-none bg-white/[0.02] p-2.5 border border-white/5 font-mono text-xs"
                              >
                                <div className="flex items-center gap-2">
                                  <span className={`w-20 rounded-none border ${style.border} ${style.bg} ${style.text} px-2 py-0.5 text-center font-bold uppercase`}>
                                    {m.agent}
                                  </span>
                                  <span className="rounded-none bg-white/5 px-1.5 py-0.5 text-[10px] text-neutral-400">
                                    {m.score} 分
                                  </span>
                                  <span className={`flex items-center gap-0.5 rounded-none px-1.5 py-0.5 text-[10px] font-bold ${
                                    isApproved ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                                  }`}>
                                    {isApproved ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                                    <span>{isApproved ? '放行 (OK)' : '否決 (VETO)'}</span>
                                  </span>
                                </div>

                                <div className="flex-1 sm:text-right text-neutral-300">
                                  <div>{translateReason(m.reason)}</div>
                                  {showRawSignals && (
                                    <div className="mt-0.5 text-[10px] text-neutral-500 font-mono">
                                      原始理由: {m.reason}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
