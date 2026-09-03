import React, { useState } from 'react';
import { ClosedTrade, TradingMode } from '../types';
import { simulateTrailingStop } from '../tradeEnricher';
import { formatUsd } from '../formatters';
import { initialPaperState } from '../data/mockData';
import { 
  Stethoscope, 
  Sliders, 
  Flame, 
  Check, 
  Copy, 
  Code2, 
  ShieldCheck,
  Radio,
  AlertCircle
} from 'lucide-react';

interface StrategyDoctorProps {
  trades: ClosedTrade[];
  isRealData?: boolean;
  mode?: TradingMode;
}

export const StrategyDoctor: React.FC<StrategyDoctorProps> = ({ 
  trades,
  isRealData = false,
  mode = 'paper'
}) => {
  // Demo mode override when real trades are 0 or explicitly requested
  const [forceDemoMode, setForceDemoMode] = useState<boolean>(false);

  // Trailing stop sliders
  const [triggerPeak, setTriggerPeak] = useState<number>(30); // Peak % to arm trailing stop
  const [lockRatio, setLockRatio] = useState<number>(65); // Lock 65% of peak

  // Gas erosion slider
  const [positionAlloc, setPositionAlloc] = useState<number>(8); // $8 default
  const [copiedCode, setCopiedCode] = useState(false);

  // Determine active trades for backtesting
  const hasRealTrades = isRealData && trades.length > 0;
  const isDemonstrationMode = !isRealData || forceDemoMode || trades.length === 0;
  const activeTrades = (isDemonstrationMode && trades.length === 0)
    ? initialPaperState.closed
    : (forceDemoMode ? initialPaperState.closed : trades);

  // Run backtest on active trades
  const backtest = simulateTrailingStop(activeTrades, triggerPeak, lockRatio);

  // Gas calculation
  const avgGasPerTrade = 0.42; // Avg gas spent per buy+sell
  const gasHandicapPct = (avgGasPerTrade / positionAlloc) * 100;

  const pythonBotCode = `def check_trailing_stop(pos, current_price, current_pnl_pct):
    """
    5-Agent 策略修復補丁：動態移動階梯停利與浮盈鎖定
    防止 PEPEHOOD, MOONHOOD 等衝高 +200% 後回吐翻虧倒貼
    """
    peak = pos.get("peak", 0.0)
    if current_pnl_pct > peak:
        pos["peak"] = current_pnl_pct
        peak = current_pnl_pct

    # 參數設定：觸發門檻 ${triggerPeak}%，利潤保護比例 ${lockRatio}%
    TRIGGER_PEAK_PCT = ${triggerPeak}.0
    LOCK_RATIO_PCT = ${lockRatio}.0 / 100.0

    if peak >= TRIGGER_PEAK_PCT:
        min_locked_pnl = peak * LOCK_RATIO_PCT
        # 若當前利潤跌破保底線，立即市價平倉落袋
        if current_pnl_pct < min_locked_pnl:
            return {
                "exit": True,
                "reason": f"trailing_stop_triggered: peak=+{peak:.1f}%, exit at {current_pnl_pct:.1f}% (locked {min_locked_pnl:.1f}%)",
                "method": "trailing_stop"
            }

    # 基礎硬止損 (Hard Stop Loss)
    if current_pnl_pct <= -15.0:
        return {"exit": True, "reason": "hard_stop_loss_hit", "method": "stop_loss"}

    return {"exit": False}`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(pythonBotCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header Doctor Banner */}
      <div className={`relative overflow-hidden rounded-none border p-4 sm:p-6 shadow-2xl backdrop-blur-md ${
        isDemonstrationMode 
          ? 'border-amber-500/40 bg-gradient-to-br from-amber-950/30 via-neutral-900/70 to-black'
          : 'border-emerald-500/40 bg-gradient-to-br from-emerald-950/30 via-neutral-900/70 to-black'
      }`}>
        <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
          <div className="flex items-start gap-3 sm:gap-4">
            <div className={`flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-none border ${
              isDemonstrationMode 
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-400' 
                : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
            }`}>
              <Stethoscope className="h-5 w-5 sm:h-6 sm:w-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white">
                  策略診斷與動態回測儀 (Strategy Doctor)
                </h2>
                {isDemonstrationMode ? (
                  <span className="rounded-none bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 font-mono text-[10px] sm:text-xs font-bold text-amber-300">
                    示範模式 (DEMO MODE)
                  </span>
                ) : (
                  <span className="rounded-none bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 font-mono text-[10px] sm:text-xs font-bold text-emerald-300 flex items-center gap-1">
                    <Radio className="h-3 w-3 animate-pulse text-emerald-400" />
                    鏈上真實平倉數據 · 即時回測中
                  </span>
                )}
              </div>

              <p className="mt-1 text-xs text-neutral-300 max-w-3xl">
                {isDemonstrationMode ? (
                  <span>
                    【示範模式說明】：當前為示範回測模式（
                    {trades.length === 0 
                      ? '真實 API 目前尚未產生已平倉交易記錄，已自動帶入歷史示範樣本供您回測驗證' 
                      : 'API 離線或使用者手動切換為示範資料'}
                    ）。此處回測使用內建 {activeTrades.length} 筆經典回吐交易進行演算。
                  </span>
                ) : (
                  <span>
                    【真實鏈上資料源】：當前回測直接讀取自 <code className="text-emerald-300 font-mono">/api/{mode === 'paper' ? 'state' : 'live'}</code> 的即時平倉紀錄，共計 <strong className="text-white">{trades.length} 筆</strong> 真實平倉樣本！
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* Toggle button between Real and Demo */}
          {hasRealTrades && (
            <button
              onClick={() => setForceDemoMode(!forceDemoMode)}
              className="shrink-0 rounded-none border border-white/20 bg-white/5 hover:bg-white/10 px-3 py-1.5 font-mono text-xs text-neutral-300 transition-all w-full sm:w-auto text-center"
            >
              {forceDemoMode ? '切回真實平倉資料' : '切換為示範模式'}
            </button>
          )}
        </div>

        {/* Real trades empty alert */}
        {isRealData && trades.length === 0 && (
          <div className="mt-4 flex items-center gap-2 rounded-none border border-amber-500/30 bg-amber-950/20 p-2.5 text-xs text-amber-300 font-mono">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" />
            <span>
              即時 API 連線正常：目前鏈上持倉持續巡航中，尚未產生已平倉單。下方回測儀已自動啟用示範資料，方便您即時測試移動停利與 Gas 磨損演算法。
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Module 1: Trailing Take-Profit Simulator */}
        <div className="rounded-none border border-white/10 bg-white/[0.03] p-4 sm:p-6 backdrop-blur-md shadow-xl space-y-6">
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div className="flex items-center gap-2">
              <Sliders className="h-5 w-5 text-emerald-400" />
              <h3 className="font-bold text-white text-base">
                動態移動停利回測 (Trailing Stop)
              </h3>
            </div>
            <span className="rounded-none bg-emerald-500/20 px-2 py-0.5 font-mono text-xs text-emerald-300 font-bold">
              回測樣本: {activeTrades.length} 筆{isDemonstrationMode ? ' (示範)' : ' (真實)'}
            </span>
          </div>

          {/* Sliders */}
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between font-mono text-xs mb-2">
                <span className="text-neutral-300">啟動門檻 (Peak Trigger %):</span>
                <span className="font-bold text-emerald-400">+{triggerPeak}%</span>
              </div>
              <input
                type="range"
                min="10"
                max="80"
                step="5"
                value={triggerPeak}
                onChange={(e) => setTriggerPeak(Number(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer"
              />
              <span className="text-[11px] text-neutral-500 block mt-1">
                當代幣最高浮盈達到此百分比時，自動武裝啟用移動停利演算法。
              </span>
            </div>

            <div>
              <div className="flex items-center justify-between font-mono text-xs mb-2">
                <span className="text-neutral-300">浮盈鎖定保底 (Lock Profit Ratio %):</span>
                <span className="font-bold text-emerald-400">{lockRatio}%</span>
              </div>
              <input
                type="range"
                min="30"
                max="85"
                step="5"
                value={lockRatio}
                onChange={(e) => setLockRatio(Number(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer"
              />
              <span className="text-[11px] text-neutral-500 block mt-1">
                若代幣曾達到 +100%，鎖定 {lockRatio}% 意味著利潤跌破 +{lockRatio}% 立即強制平倉。
              </span>
            </div>
          </div>

          {/* Simulation Output Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 font-mono">
            <div className="rounded-none border border-white/10 bg-black/40 p-3">
              <span className="text-neutral-500 text-[10px] block">
                {isDemonstrationMode ? '示範歷史 PnL' : '原始真實 PnL'}
              </span>
              <span className={`text-base font-bold ${backtest.originalPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {formatUsd(backtest.originalPnlUsd, { showPlus: true })}
              </span>
            </div>

            <div className="rounded-none border border-emerald-500/30 bg-emerald-950/20 p-3">
              <span className="text-neutral-500 text-[10px] block">回測優化後 PnL</span>
              <span className="text-base font-bold text-emerald-400">
                {formatUsd(backtest.simulatedPnlUsd, { showPlus: true })}
              </span>
            </div>

            <div className="rounded-none border border-emerald-500/40 bg-emerald-500/20 p-3 sm:col-span-1 col-span-2">
              <span className="text-emerald-300 text-[10px] block">為帳戶多挽回資金</span>
              <span className="text-lg font-bold text-emerald-300">
                +${backtest.savedUsd.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="rounded-none bg-black/40 p-3 border border-white/5 font-mono text-xs text-neutral-400">
            在當前參數下，此規則將直接改善 <span className="font-bold text-white">{backtest.improvedTradesCount} 筆</span> 嚴重回吐交易，整體損益大幅改善 <span className="font-bold text-emerald-400">+{backtest.avgPnlChangePct}%</span>。
          </div>
        </div>

        {/* Module 2: Gas Handicap Calculator */}
        <div className="rounded-none border border-white/10 bg-white/[0.03] p-4 sm:p-6 backdrop-blur-md shadow-xl space-y-6">
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div className="flex items-center gap-2">
              <Flame className="h-5 w-5 text-amber-500" />
              <h3 className="font-bold text-white text-base">
                單筆開倉 Gas 磨損診斷
              </h3>
            </div>
            <span className="rounded-none bg-amber-500/20 px-2 py-0.5 font-mono text-xs text-amber-300 font-bold">
              平均 Gas $0.42 / 筆
            </span>
          </div>

          {/* Allocation Slider */}
          <div>
            <div className="flex items-center justify-between font-mono text-xs mb-2">
              <span className="text-neutral-300">單筆開倉金額 (Position Size USD):</span>
              <span className="font-bold text-amber-400">${positionAlloc.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="5"
              max="50"
              step="1"
              value={positionAlloc}
              onChange={(e) => setPositionAlloc(Number(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer"
            />
            <span className="text-[11px] text-neutral-500 block mt-1">
              Meme 代幣極短線交易中，固定 Gas 手續費若佔開倉比率過高，將產生「勝率 70% 依舊虧損」的假性獲利陷阱。
            </span>
          </div>

          {/* Gas Ratio Cards */}
          <div className="grid grid-cols-2 gap-3 font-mono">
            <div className="rounded-none border border-white/10 bg-black/40 p-3">
              <span className="text-neutral-500 text-[10px] block">進出雙向 Gas 成本</span>
              <span className="text-base font-bold text-amber-400">${avgGasPerTrade.toFixed(2)}</span>
            </div>

            <div className={`rounded-none border p-3 ${
              gasHandicapPct > 4.0 ? 'border-red-500/30 bg-red-950/20' : 'border-emerald-500/30 bg-emerald-950/20'
            }`}>
              <span className="text-neutral-500 text-[10px] block">本金初始負重 (Handicap)</span>
              <span className={`text-base font-bold ${gasHandicapPct > 4.0 ? 'text-red-400' : 'text-emerald-400'}`}>
                {gasHandicapPct.toFixed(2)}%
              </span>
            </div>
          </div>

          <div className="rounded-none bg-black/40 p-3 border border-white/5 font-mono text-xs text-neutral-400">
            {gasHandicapPct > 4.0 ? (
              <span className="text-red-300">
                ⚠️ 當前倉位 ${positionAlloc} 下，手續費磨損高達 {gasHandicapPct.toFixed(1)}%，意味著每筆交易未漲先輸 {gasHandicapPct.toFixed(1)}%！建議將單筆開倉資金調整至 $15~$25 以上，或限制交易次數。
              </span>
            ) : (
              <span className="text-emerald-300">
                ✅ 手續費佔比僅 {gasHandicapPct.toFixed(1)}%，處於健康的量化風控區間，策略有足夠利潤空間承受滑價與盤整震盪。
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Module 3: Bot Code Patch */}
      <div className="rounded-none border border-white/10 bg-white/[0.03] p-4 sm:p-6 backdrop-blur-md shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div className="flex items-center gap-2">
            <Code2 className="h-5 w-5 text-purple-400" />
            <div>
              <h3 className="font-bold text-white text-base">
                機器人代碼修復指南 (Bot Code Fix)
              </h3>
              <p className="text-xs text-neutral-400">
                可直接複製並移植到 Python 交易機器人 (如 live_bot.py 或 grok_bot.py) 的動態移動停利函式
              </p>
            </div>
          </div>

          <button
            onClick={copyToClipboard}
            className="flex items-center justify-center gap-1.5 rounded-none bg-purple-500/20 border border-purple-500/40 px-3.5 py-1.5 font-mono text-xs font-bold text-purple-300 hover:bg-purple-500/30 transition-all shadow-lg w-full sm:w-auto"
          >
            {copiedCode ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            <span>{copiedCode ? '已複製到剪貼簿' : '複製 Python 修復代碼'}</span>
          </button>
        </div>

        <div className="overflow-hidden rounded-none border border-white/10 bg-black/80 p-4 font-mono text-xs text-neutral-300">
          <pre className="overflow-x-auto whitespace-pre">
            <code>{pythonBotCode}</code>
          </pre>
        </div>
      </div>
    </div>
  );
};

