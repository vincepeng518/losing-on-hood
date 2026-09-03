import React, { useState, useMemo, useEffect } from 'react';
import { ClosedTrade } from '../types';
import { formatUsd, formatPercent, formatTimestamp, translateReason, getExitDiagnosis } from '../formatters';
import { Pagination } from './Pagination';
import { Flame, AlertOctagon, TrendingDown, ArrowRight, ShieldAlert, Award } from 'lucide-react';

interface WallOfShameProps {
  trades: ClosedTrade[];
  onGoToSimulator: () => void;
}

export const WallOfShame: React.FC<WallOfShameProps> = ({ trades, onGoToSimulator }) => {
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);

  // Filter trades that had high peak (>= 30%) and either closed negative or gave back > 60% of peak
  const shameCandidates = useMemo(() => {
    return trades
      .filter((t) => (t.peak || 0) >= 30)
      .map((t) => {
        const peak = t.peak || 0;
        const alloc = t.alloc_usd ?? (t.pnl_pct && t.pnl_usd ? Math.abs((t.pnl_usd / t.pnl_pct) * 100) : 0);
        const peakUsd = (alloc * peak) / 100;
        const realizedUsd = t.pnl_usd || 0;
        const evaporatedUsd = Math.max(0, peakUsd - realizedUsd);
        // Giveback ratio = how much of peak was wiped out
        const givebackRatio = peakUsd > 0 ? (evaporatedUsd / peakUsd) * 100 : 0;
        return {
          ...t,
          peakUsd,
          evaporatedUsd,
          givebackRatio,
        };
      })
      .sort((a, b) => b.evaporatedUsd - a.evaporatedUsd);
  }, [trades]);

  // Reset page when trades list or pageSize changes
  useEffect(() => {
    setCurrentPage(1);
  }, [trades, pageSize]);

  const paginatedCandidates = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return shameCandidates.slice(start, start + pageSize);
  }, [shameCandidates, currentPage, pageSize]);

  const totalEvaporated = shameCandidates.reduce((sum, item) => sum + item.evaporatedUsd, 0);

  return (
    <div className="space-y-6">
      {/* Hero Banner for Wall of Shame */}
      <div className="relative overflow-hidden rounded-none border border-red-500/40 bg-gradient-to-br from-red-950/40 via-neutral-900/60 to-black p-4 sm:p-6 shadow-2xl backdrop-blur-md">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3 sm:gap-4">
            <div className="flex h-11 w-11 sm:h-14 sm:w-14 shrink-0 items-center justify-center rounded-none bg-red-500/20 border border-red-500/40 text-red-400 shadow-[0_0_30px_rgba(239,68,68,0.3)]">
              <Flame className="h-5 w-5 sm:h-7 sm:w-7 animate-bounce" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white">
                  浮盈回吐恥辱榜 (Wall of Shame)
                </h2>
                <span className="rounded-none bg-red-500/20 border border-red-500/40 px-2 py-0.5 font-mono text-[10px] sm:text-xs font-bold text-red-300 uppercase">
                  LETHAL GIVEBACKS
                </span>
              </div>
              <p className="mt-1 text-xs text-neutral-300 max-w-2xl">
                專門審計「曾高位爆賺、卻因缺乏動態移動停利 (Trailing Stop) 而一路看著利潤蒸發、甚至翻虧倒貼手續費」的悲劇標的。
              </p>
            </div>
          </div>

          <div className="rounded-none border border-red-500/30 bg-black/60 p-3.5 sm:p-4 font-mono text-left sm:text-right w-full sm:w-auto">
            <div className="text-xs text-neutral-400">歷史總蒸發浮盈</div>
            <div className="text-xl sm:text-2xl font-bold text-red-400">${totalEvaporated.toFixed(2)}</div>
            <button
              onClick={onGoToSimulator}
              className="mt-2 flex items-center justify-center sm:justify-end gap-1.5 rounded-none bg-red-500/20 border border-red-500/30 px-3 py-1 text-xs text-red-200 hover:bg-red-500/30 transition-all font-mono w-full sm:w-auto"
            >
              <span>前往回測儀模擬挽回</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Shame Rankings List */}
      <div className="space-y-4">
        {shameCandidates.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-white/[0.02] py-16 text-center font-mono text-xs text-neutral-400">
            目前無重大浮盈回吐標的，策略停利執行穩健
          </div>
        ) : (
          paginatedCandidates.map((item, index) => {
            const diagnosis = getExitDiagnosis(item.exit_reason, item.method);
            const isNegative = item.pnl_usd < 0;
            const rankNum = (currentPage - 1) * pageSize + index + 1;

            return (
              <div
                key={item.id}
                className="overflow-hidden rounded-none border border-white/10 bg-white/[0.03] p-4 sm:p-5 backdrop-blur-md shadow-xl transition-all hover:border-red-500/40 hover:bg-white/[0.04]"
              >
                <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
                  {/* Rank & Token Info */}
                  <div className="flex items-start gap-3 sm:gap-4">
                    <div className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-none bg-white/5 border border-white/10 font-mono text-xs sm:text-sm font-bold text-neutral-300">
                      #{rankNum}
                    </div>

                    <div>
                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                        <span className="font-mono text-base sm:text-lg font-bold text-white">${item.symbol}</span>
                        <span className="rounded-none border border-amber-500/40 bg-amber-500/20 px-1.5 sm:px-2 py-0.5 font-mono text-[10px] sm:text-xs font-bold text-amber-300">
                          最高曾達 +{item.peak.toFixed(1)}% (${item.peakUsd.toFixed(2)})
                        </span>
                        <span className={`rounded-none border px-1.5 sm:px-2 py-0.5 font-mono text-[10px] sm:text-xs ${
                          isNegative ? 'border-red-500/30 bg-red-950/40 text-red-300' : 'border-emerald-500/30 bg-emerald-950/40 text-emerald-300'
                        }`}>
                          最終結算: {formatPercent(item.pnl_pct, { showPlus: true })}
                        </span>
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-xs text-neutral-400">
                        <span>{formatTimestamp(item.time)}</span>
                        <span>·</span>
                        <span>持倉 {item.held_min} 分鐘</span>
                        <span>·</span>
                        <span className="text-neutral-300">退場觸發: {translateReason(item.exit_reason)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Evaporation Stats */}
                  <div className="w-full lg:w-auto grid grid-cols-2 sm:flex items-center gap-2 sm:gap-4 font-mono">
                    <div className="rounded-none border border-red-500/30 bg-red-950/20 p-2.5 sm:p-3 text-left sm:text-right">
                      <span className="text-[10px] text-neutral-400 block">蒸發利潤金額</span>
                      <span className="text-sm sm:text-base font-bold text-red-400">
                        -${item.evaporatedUsd.toFixed(2)}
                      </span>
                      <span className="text-[10px] text-neutral-500 block">
                        回吐比例: {item.givebackRatio.toFixed(0)}%
                      </span>
                    </div>

                    <div className="rounded-none border border-emerald-500/30 bg-emerald-950/20 p-2.5 sm:p-3 text-left sm:text-right">
                      <span className="text-[10px] text-neutral-400 block">若設 70% 停利保護</span>
                      <span className="text-sm sm:text-base font-bold text-emerald-400">
                        +${(item.peakUsd * 0.7).toFixed(2)}
                      </span>
                      <span className="text-[10px] text-emerald-300/80 block">
                        挽回 +${Math.max(0, item.peakUsd * 0.7 - item.pnl_usd).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Retrospective Box */}
                <div className="mt-4 rounded-none bg-black/50 p-3 border border-white/5 font-mono text-xs text-neutral-400">
                  <span className="text-red-400 font-bold">覆盤審查結論: </span>
                  5-Agent 順利捕捉動能開倉，但出場機制過度依賴靜態指標；在極短線爆發 +{item.peak}% 後買量崩落 (Flow Collapse)，缺乏階梯式移動鎖利，利潤瞬間灰飛煙滅。
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination Footer */}
      {shameCandidates.length > 0 && (
        <Pagination
          currentPage={currentPage}
          totalItems={shameCandidates.length}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          pageSizeOptions={[10, 25, 50]}
          onPageSizeChange={(newSize) => {
            setPageSize(newSize);
            setCurrentPage(1);
          }}
          itemLabel="筆恥辱榜紀錄"
          accentColor="red"
        />
      )}
    </div>
  );
};
