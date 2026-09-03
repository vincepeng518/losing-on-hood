import React, { useState } from 'react';
import { TradingMode, AccountState } from './types';
import { initialPaperState, initialLiveState } from './data/mockData';
import { Header } from './components/Header';
import { PortfolioDashboard } from './components/PortfolioDashboard';
import { TradesAudit } from './components/TradesAudit';
import { WallOfShame } from './components/WallOfShame';
import { AgentCouncil } from './components/AgentCouncil';
import { StrategyDoctor } from './components/StrategyDoctor';
import { FooterTicker } from './components/FooterTicker';

export const App: React.FC = () => {
  const [mode, setMode] = useState<TradingMode>('paper');
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [tradesFilter, setTradesFilter] = useState<string>('all');

  const [paperState, setPaperState] = useState<AccountState>(initialPaperState);
  const [liveState, setLiveState] = useState<AccountState>(initialLiveState);

  const currentState = mode === 'paper' ? paperState : liveState;

  // Calculate current unrealized PnL from active positions
  const unrealizedPnl = Object.values(currentState.positions || {}).reduce(
    (sum, pos) => sum + (pos.current_pnl_usd || 0),
    0
  );

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

  return (
    <div className="relative min-h-screen bg-[#050505] text-neutral-100 selection:bg-rose-500/30 selection:text-white font-sans antialiased overflow-x-hidden pb-16">
      {/* Frosted Dark Luxury Ambient Glow Backgrounds */}
      <div 
        className="pointer-events-none fixed -top-40 -left-40 h-[550px] w-[550px] rounded-full bg-rose-950/25 blur-[140px]"
        aria-hidden="true"
      />
      <div 
        className="pointer-events-none fixed top-1/3 -right-40 h-[600px] w-[600px] rounded-full bg-amber-950/20 blur-[150px]"
        aria-hidden="true"
      />
      <div 
        className="pointer-events-none fixed -bottom-40 left-1/3 h-[500px] w-[500px] rounded-full bg-red-950/20 blur-[140px]"
        aria-hidden="true"
      />

      {/* Main App Bar Header */}
      <Header
        mode={mode}
        onModeChange={setMode}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        currentEquity={currentState.current_equity}
        unrealizedPnl={unrealizedPnl}
      />

      {/* Main Content Workspace */}
      <main className="relative z-10 mx-auto max-w-7xl px-4 py-8">
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
          <AgentCouncil logs={currentState.agent_log || []} />
        )}

        {activeTab === 'doctor' && (
          <StrategyDoctor trades={currentState.closed || []} />
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
