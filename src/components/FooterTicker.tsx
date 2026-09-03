import React from 'react';
import { Activity, Flame, ShieldAlert, Cpu } from 'lucide-react';

export const FooterTicker: React.FC = () => {
  const tickers = [
    { symbol: 'ETH', price: '$2,482.50', change: '+2.4%', isPositive: true },
    { symbol: 'HOOD', price: '$21.40', change: '+5.1%', isPositive: true },
    { symbol: 'HOUND', price: '$0.000486', change: '+18.0%', isPositive: true },
    { symbol: 'PEPEHOOD', price: '$0.000078', change: '-7.1%', isPositive: false },
    { symbol: 'GROKRH', price: '$0.000850', change: '-9.6%', isPositive: false },
    { symbol: 'MOONHOOD', price: '$0.000980', change: '-18.2%', isPositive: false },
  ];

  return (
    <footer id="footer-ticker-bar" className="fixed bottom-0 left-0 right-0 z-40 h-10 border-t border-white/10 bg-neutral-950/90 backdrop-blur-xl select-none">
      <div id="footer-ticker-container" className="mx-auto flex h-full max-w-7xl items-center justify-between px-3 sm:px-4 font-mono text-xs text-neutral-400 overflow-hidden">
        {/* Left: Heartbeat & Market status */}
        <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
          <div className="flex items-center gap-1.5" title="Robinhood Chain 即時心跳監聽中">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-none bg-rose-500 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-none bg-rose-600"></span>
            </span>
            <span className="font-bold text-white uppercase text-[11px]">LIVE HEARTBEAT</span>
          </div>

          <div className="hidden sm:flex items-center gap-1 rounded-none border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-400" title="市場處於高波動/高磨損狀態">
            <ShieldAlert className="h-3 w-3" />
            <span>BLOOD BATH MODE</span>
          </div>
          
          <div className="hidden lg:flex items-center gap-1 rounded-none border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-neutral-400" title="5-Agent 聯席會議量化篩選標的池">
            <span>5-Agent 監控池</span>
          </div>
        </div>

        {/* Center: Token ticker scroll */}
        <div className="hidden md:flex items-center gap-4 lg:gap-6 overflow-hidden px-2 lg:px-4" title="Robinhood Chain 5-Agent 審核與監聽標的">
          {tickers.map((t, idx) => (
            <div key={idx} className="flex items-center gap-1.5 shrink-0 text-xs">
              <span className="font-bold text-neutral-200">${t.symbol}</span>
              <span className="text-neutral-400 text-[11px]">{t.price}</span>
              <span className={`text-[11px] font-semibold ${t.isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                {t.change}
              </span>
            </div>
          ))}
        </div>

        {/* Right: RPC & Gas */}
        <div className="flex items-center gap-3 shrink-0 text-[11px]">
          <div className="hidden sm:flex items-center gap-1">
            <Cpu className="h-3 w-3 text-neutral-500" />
            <span className="text-neutral-500">RPC:</span>
            <span className="text-emerald-400">Robinhood L2 (24ms)</span>
          </div>
          <span className="hidden sm:inline text-neutral-700">|</span>
          <div className="flex items-center gap-1">
            <Flame className="h-3 w-3 text-amber-500" />
            <span className="text-neutral-500">Gas:</span>
            <span className="text-amber-400">0.001 Gwei</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
