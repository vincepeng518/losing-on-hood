import React, { useState, useEffect, useRef } from 'react';
import { TradingMode, AccountState, DangerToast, AgentWeightsConfig } from './types';
import { initialPaperState, initialLiveState } from './data/mockData';
import { normalizeAccountState } from './data/stateNormalizer';
import { Header } from './components/Header';
import { PortfolioDashboard } from './components/PortfolioDashboard';
import { TradesAudit } from './components/TradesAudit';
import { WallOfShame } from './components/WallOfShame';
import { AgentCouncil } from './components/AgentCouncil';
import { StrategyDoctor } from './components/StrategyDoctor';
import { FooterTicker } from './components/FooterTicker';
import { Check, BellRing } from 'lucide-react';

export const App: React.FC = () => {
  const [mode, setMode] = useState<TradingMode>('paper');
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [tradesFilter, setTradesFilter] = useState<string>('all');

  // Account states - initialized with fallback, replaced by real API data
  const [paperState, setPaperState] = useState<AccountState>(initialPaperState);
  const [liveState, setLiveState] = useState<AccountState>(initialLiveState);

  // Connection & Polling status
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isFallbackMode, setIsFallbackMode] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

  // Agent Weights State
  const [agentWeights, setAgentWeights] = useState<AgentWeightsConfig>({
    scanner: 8,
    narrative: 6,
    sniper: 5,
    judge: 7,
    risk: 10,
    sniper_chase_tolerance: 'conservative',
  });

  // Danger Toasts State
  const [toasts, setToasts] = useState<DangerToast[]>([
    {
      id: 'toast_init_1',
      ts: Date.now() - 3 * 60 * 1000,
      token: 'HONEYRH',
      agent: 'scanner',
      title: '偵測到極度危險蜜罐代幣 (Honeypot Detected)',
      detail: '模擬賣單交易失敗，賣出手續費高達 99% 或未開放賣出函數，Scanner 已執行一票否決！',
      level: 'critical',
      danger_type: 'honeypot',
    },
    {
      id: 'toast_init_2',
      ts: Date.now() - 1 * 60 * 1000,
      token: 'RUGPUMP',
      agent: 'scanner',
      title: '持倉鯨魚高度集中警報 (Whale Concentration > 60%)',
      detail: '前十大持幣地址佔比達 68% (超過風控門檻 35%)，隨時有集體撤池砸盤風險，已終止買入。',
      level: 'warning',
      danger_type: 'whale_concentration',
    },
  ]);

  // Success tip state when user triggers a test alert
  const [alertSuccessTip, setAlertSuccessTip] = useState<{ token: string; title: string; ts: number } | null>(null);
  const alertSuccessTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Requirement 1: Poll /api/state and /api/live every 5 seconds
  useEffect(() => {
    let isMounted = true;

    // First check if server-side injected SSR data exists
    if (typeof window !== 'undefined' && (window as any).__SSR) {
      try {
        const ssr = (window as any).__SSR;
        if (ssr.paper && typeof ssr.paper === 'object' && Object.keys(ssr.paper).length > 0) {
          setPaperState(normalizeAccountState(ssr.paper, 'paper', initialPaperState));
          setIsConnected(true);
          setIsFallbackMode(false);
          setLastSyncTime(new Date());
        }
        if (ssr.live && typeof ssr.live === 'object' && Object.keys(ssr.live).length > 0) {
          setLiveState(normalizeAccountState(ssr.live, 'live', initialLiveState));
          setIsConnected(true);
          setIsFallbackMode(false);
          setLastSyncTime(new Date());
        }
      } catch (err) {
        console.warn('Failed to parse window.__SSR initial payload:', err);
      }
    }

    const pollApiData = async () => {
      try {
        const [paperRes, liveRes] = await Promise.allSettled([
          fetch('/api/state', { cache: 'no-store' }),
          fetch('/api/live', { cache: 'no-store' }),
        ]);

        if (!isMounted) return;

        let anySuccess = false;

        if (paperRes.status === 'fulfilled' && paperRes.value.ok) {
          try {
            const data = await paperRes.value.json();
            if (data && typeof data === 'object' && Object.keys(data).length > 0) {
              setPaperState((prev) => normalizeAccountState(data, 'paper', prev));
              anySuccess = true;
            }
          } catch (e) {
            console.error('Failed to parse /api/state JSON:', e);
          }
        }

        if (liveRes.status === 'fulfilled' && liveRes.value.ok) {
          try {
            const data = await liveRes.value.json();
            if (data && typeof data === 'object' && Object.keys(data).length > 0) {
              setLiveState((prev) => normalizeAccountState(data, 'live', prev));
              anySuccess = true;
            }
          } catch (e) {
            console.error('Failed to parse /api/live JSON:', e);
          }
        }

        if (anySuccess) {
          setIsConnected(true);
          setIsFallbackMode(false);
          setLastSyncTime(new Date());
        } else {
          // If neither API responded, fallback mode is active
          setIsFallbackMode(true);
        }
      } catch (err) {
        console.warn('API polling error, retaining visual fallback:', err);
        if (isMounted) {
          setIsFallbackMode(true);
        }
      }
    };

    // Initial immediate fetch
    pollApiData();

    // 5-second polling interval
    const intervalId = setInterval(pollApiData, 5000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, []);

  const currentState = mode === 'paper' ? paperState : liveState;

  // Calculate current unrealized PnL from active positions dict
  const unrealizedPnl = Object.values(currentState.positions || {}).reduce(
    (sum, pos) => sum + (pos.current_pnl_usd || 0),
    0
  );

  const currentEquity = currentState.equity_usd ?? currentState.current_equity ?? currentState.start_equity;

  const handleNavigateToTrades = (filter?: string) => {
    if (filter) setTradesFilter(filter);
    setActiveTab('trades');
  };

  const handleNavigateToShame = () => {
    setActiveTab('shame');
  };

  const handleNavigateToDoctor = () => {
    setActiveTab('doctor');
  };

  const handleDismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const handleClearAllToasts = () => {
    setToasts([]);
  };

  const handleSimulateDangerAlert = () => {
    const dangerDemos: Omit<DangerToast, 'id' | 'ts'>[] = [
      {
        token: 'FAKEPEPE',
        agent: 'scanner',
        title: '偵測到蜜罐陷阱代幣 (Honeypot Detected)',
        detail: '合約具有黑名單限制轉移邏輯，Robinhood 測試網買入後無法授權賣出，已即刻否決！',
        level: 'critical',
        danger_type: 'honeypot',
      },
      {
        token: 'INSIDERX',
        agent: 'scanner',
        title: '老鼠倉鯨魚集中度異常 (Whale Concentration 74%)',
        detail: '同一批關聯錢包在創池首秒吃進 74% 總流通量，高機率惡意砸盤 (Dump Trap)，已強制攔截。',
        level: 'warning',
        danger_type: 'whale_concentration',
      },
      {
        token: 'QUICKRUG',
        agent: 'scanner',
        title: '池子流動性鎖定缺失警示 (Liquidity Unlocked)',
        detail: '池子流動性未經合約鎖定，隨時可能被 Deployer 單筆撤乾，已觸發 Scanner 一票否決！',
        level: 'critical',
        danger_type: 'liquidity_drain',
      },
    ];

    const randomChoice = dangerDemos[Math.floor(Math.random() * dangerDemos.length)];
    const newToast: DangerToast = {
      ...randomChoice,
      id: `toast_${Date.now()}`,
      ts: Date.now(),
    };

    setToasts((prev) => [newToast, ...(prev || []).slice(0, 15)]);

    // Trigger success tip beside the button
    setAlertSuccessTip({
      token: newToast.token,
      title: newToast.title,
      ts: Date.now(),
    });
    if (alertSuccessTimer.current) {
      clearTimeout(alertSuccessTimer.current);
    }
    alertSuccessTimer.current = setTimeout(() => {
      setAlertSuccessTip(null);
    }, 6000);
  };

  return (
    <div className="relative min-h-screen bg-[#09090b] text-neutral-100 selection:bg-rose-500/30 selection:text-white font-sans antialiased overflow-x-hidden pb-16 rounded-none">
      {/* Main App Bar Header with Centralized Notification Bell */}
      <Header
        mode={mode}
        onModeChange={setMode}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        currentEquity={currentEquity}
        unrealizedPnl={unrealizedPnl}
        isConnected={isConnected}
        isFallbackMode={isFallbackMode}
        lastSyncTime={lastSyncTime}
        notifications={toasts}
        onDismissNotification={handleDismissToast}
        onClearAllNotifications={handleClearAllToasts}
        onSimulateDangerAlert={handleSimulateDangerAlert}
      />

      {/* Main Content Workspace */}
      <main className="relative z-10 mx-auto max-w-7xl px-3 sm:px-4 py-3 sm:py-6">
        {/* Threat Warning Banner with zero-border Linear styling */}
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-none border border-white/10 bg-neutral-900/60 px-3 sm:px-4 py-2 font-mono text-xs text-neutral-400">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-none bg-rose-500 animate-ping" />
            <span className="text-neutral-200 text-[11px] sm:text-xs">5-Agent 交易室威脅防護網：即時監聽惡意蜜罐合約與鯨魚異動</span>
          </div>
          <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2">
            {/* 測試警報成功提示 */}
            {alertSuccessTip && (
              <div 
                id="test-alert-success-tip"
                className="flex items-center gap-1.5 rounded-none border border-emerald-500/40 bg-emerald-950/70 px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs text-emerald-300 font-mono shadow-sm transition-all animate-pulse"
              >
                <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span>測試警報已送出！「${alertSuccessTip.token}」已存入右上角鈴鐺</span>
                <span className="ml-1 rounded-none bg-emerald-500/20 px-1 py-0.2 text-[10px] text-emerald-200 font-bold border border-emerald-500/30">
                  鈴鐺 +1
                </span>
              </div>
            )}

            {isFallbackMode && (
              <span className="text-amber-400 text-[10px] sm:text-[11px]">
                ⚠️ API 離線中，使用視覺 Fallback
              </span>
            )}
            <button
              id="test-danger-alert-btn"
              onClick={handleSimulateDangerAlert}
              title="點擊模擬偵測到蜜罐或惡意合約，觸發 5-Agent 一票否決並推播至右上角通知鈴鐺"
              className={`flex items-center gap-1.5 rounded-none border px-2.5 sm:px-3 py-1 text-[11px] sm:text-xs font-mono transition-all ${
                alertSuccessTip
                  ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/50'
                  : 'border-rose-500/40 bg-rose-950/40 text-rose-300 hover:bg-rose-900/60 hover:text-white'
              }`}
            >
              {alertSuccessTip ? (
                <>
                  <Check className="h-3 w-3 text-emerald-400 shrink-0" />
                  <span>警報已送出 (再點測試)</span>
                </>
              ) : (
                <>
                  <BellRing className="h-3 w-3 shrink-0" />
                  <span>+ 測試警報通知</span>
                </>
              )}
            </button>
          </div>
        </div>

        {activeTab === 'dashboard' && (
          <PortfolioDashboard
            state={currentState}
            onNavigateToTrades={handleNavigateToTrades}
            onNavigateToShame={handleNavigateToShame}
          />
        )}

        {activeTab === 'trades' && (
          <TradesAudit
            trades={currentState.closed || []}
            initialFilter={tradesFilter}
          />
        )}

        {activeTab === 'shame' && (
          <WallOfShame
            trades={currentState.closed || []}
            onGoToSimulator={handleNavigateToDoctor}
          />
        )}

        {activeTab === 'council' && (
          <AgentCouncil 
            logs={currentState.agent_log || []} 
            closedTrades={currentState.closed || []}
            weights={agentWeights}
            onUpdateWeights={setAgentWeights}
          />
        )}

        {activeTab === 'doctor' && (
          <StrategyDoctor 
            trades={currentState.closed || []} 
            isRealData={isConnected && !isFallbackMode}
            mode={mode}
          />
        )}
      </main>

      {/* Fixed Bottom Real-time Ticker */}
      <FooterTicker />

      {/* Hidden SSR Anchors for backward compatibility verification */}
      <div id="pkpi" className="hidden" aria-hidden="true" />
      <div id="pdisc" className="hidden" aria-hidden="true" />
      <div id="ptrades" className="hidden" aria-hidden="true" />
      <div id="lkpi" className="hidden" aria-hidden="true" />
      <div id="ltrades" className="hidden" aria-hidden="true" />
    </div>
  );
};

