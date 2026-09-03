import React from 'react';
import { TradingMode } from '../types';
import { 
  Activity, 
  ShieldAlert, 
  FileText, 
  Flame, 
  Users, 
  Stethoscope, 
  Zap,
  Terminal
} from 'lucide-react';
import { DangerToast } from '../types';
import { NotificationBell } from './NotificationBell';

interface HeaderProps {
  mode: TradingMode;
  onModeChange: (mode: TradingMode) => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
  currentEquity: number;
  unrealizedPnl: number;
  isConnected?: boolean;
  isFallbackMode?: boolean;
  lastSyncTime?: Date | null;
  notifications?: DangerToast[];
  onDismissNotification?: (id: string) => void;
  onClearAllNotifications?: () => void;
  onSimulateDangerAlert?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  mode,
  onModeChange,
  activeTab,
  onTabChange,
  currentEquity,
  unrealizedPnl,
  isConnected = false,
  isFallbackMode = false,
  lastSyncTime = null,
  notifications = [],
  onDismissNotification = () => {},
  onClearAllNotifications = () => {},
  onSimulateDangerAlert = () => {},
}) => {
  const tabs = [
    { id: 'dashboard', label: '總覽看板', icon: Activity, badge: null },
    { id: 'trades', label: '持倉與5-Agent審計', icon: FileText, badge: '5-Agent' },
    { id: 'shame', label: '浮盈回吐恥辱榜', icon: Flame, badge: 'Wall of Shame' },
    { id: 'council', label: '5-Agent決策圓桌', icon: Users, badge: 'Live Stream' },
    { id: 'doctor', label: '策略診斷與回測', icon: Stethoscope, badge: 'Simulator' },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/10 bg-neutral-950/90 backdrop-blur-xl rounded-none">
      {/* Top Banner Status Bar */}
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2 text-xs text-neutral-400">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-mono">
            <span className="relative flex h-2 w-2">
              <span className={`absolute inline-flex h-full w-full animate-ping rounded-none opacity-75 ${
                isConnected ? 'bg-emerald-400' : 'bg-amber-400'
              }`}></span>
              <span className={`relative inline-flex h-2 w-2 rounded-none ${
                isConnected ? 'bg-emerald-500' : 'bg-amber-500'
              }`}></span>
            </span>
            <span className="font-semibold text-neutral-200">Robinhood Chain</span>
            <span className="text-neutral-500">· RPC 24ms</span>
          </div>
          <span className="hidden text-neutral-600 sm:inline">|</span>
          <div className="hidden items-center gap-1.5 font-mono sm:flex text-[11px]">
            {isConnected ? (
              <span className="text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded-none font-bold">
                ● LIVE API (5秒輪詢中)
              </span>
            ) : isFallbackMode ? (
              <span className="text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded-none">
                ○ 示範 Fallback 模式 (API重試中)
              </span>
            ) : (
              <span className="text-neutral-400">連接中...</span>
            )}
            {lastSyncTime && (
              <span className="text-neutral-500">
                同步於 {lastSyncTime.toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 font-mono text-xs">
            <span className="text-neutral-400">當前總資產:</span>
            <span className="font-bold text-white">${currentEquity.toFixed(2)}</span>
            {unrealizedPnl !== 0 && (
              <span className={`text-[11px] font-semibold ${unrealizedPnl > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                ({unrealizedPnl > 0 ? '+' : ''}${unrealizedPnl.toFixed(2)})
              </span>
            )}
          </div>

          {/* Paper / Live Mode Switcher */}
          <div className="flex items-center rounded-none bg-white/5 p-0.5 border border-white/10">
            <button
              id="mode-paper-btn"
              onClick={() => onModeChange('paper')}
              className={`flex items-center gap-1.5 rounded-none px-3 py-1 text-xs font-medium transition-all ${
                mode === 'paper'
                  ? 'bg-amber-500/20 text-amber-300 shadow-sm border border-amber-500/40'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Zap className="h-3 w-3" />
              <span>模擬盤 (/api/state)</span>
            </button>
            <button
              id="mode-live-btn"
              onClick={() => onModeChange('live')}
              className={`flex items-center gap-1.5 rounded-none px-3 py-1 text-xs font-medium transition-all ${
                mode === 'live'
                  ? 'bg-rose-500/20 text-rose-300 shadow-sm border border-rose-500/40'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <ShieldAlert className="h-3 w-3" />
              <span>實盤 (/api/live)</span>
            </button>
          </div>

          {/* Centralized Notification Bell */}
          <NotificationBell
            notifications={notifications}
            onDismiss={onDismissNotification}
            onClearAll={onClearAllNotifications}
            onSimulateDangerAlert={onSimulateDangerAlert}
          />
        </div>
      </div>

      {/* Main Brand & Navigation */}
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-none bg-gradient-to-br from-rose-600/30 via-red-950/40 to-neutral-900 border border-rose-500/30 shadow-[0_0_20px_rgba(225,29,72,0.25)]">
            <Terminal className="h-5 w-5 text-rose-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold tracking-tight text-white sm:text-lg">
                LOSING ON HOOD
              </h1>
              <span className="rounded-none border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-red-400 uppercase tracking-wide">
                5-AGENT QUANT AUDIT
              </span>
            </div>
            <p className="text-xs text-neutral-400">
              Robinhood Chain Meme 策略審計 · 利潤回吐診斷 · 實時動態回測終端
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex flex-wrap items-center gap-1.5">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`tab-${tab.id}`}
                onClick={() => onTabChange(tab.id)}
                className={`relative flex items-center gap-2 rounded-none px-3.5 py-2 text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-white/10 text-white shadow-lg shadow-black/40 border border-white/20'
                    : 'text-neutral-400 hover:bg-white/5 hover:text-neutral-200 border border-transparent'
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? 'text-rose-400' : 'text-neutral-400'}`} />
                <span>{tab.label}</span>
                {tab.badge && (
                  <span
                    className={`hidden rounded-none px-1.5 py-0.2 text-[10px] font-mono font-semibold lg:inline-block ${
                      isActive ? 'bg-rose-500/30 text-rose-300' : 'bg-white/5 text-neutral-400'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
