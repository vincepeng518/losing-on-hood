import React from 'react';
import { DangerToast } from '../types';
import { ShieldAlert, AlertOctagon, X, BellRing, Sparkles } from 'lucide-react';
import { formatTimestamp } from '../formatters';

interface ToastAlertContainerProps {
  toasts: DangerToast[];
  onDismiss: (id: string) => void;
  onSimulateDangerAlert: () => void;
}

export const ToastAlertContainer: React.FC<ToastAlertContainerProps> = ({
  toasts,
  onDismiss,
  onSimulateDangerAlert,
}) => {
  return (
    <div className="fixed top-20 right-4 z-50 flex flex-col gap-3 max-w-sm sm:max-w-md w-full pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto group relative overflow-hidden rounded-2xl border-2 border-rose-500/80 bg-black/85 p-4 shadow-[0_10px_35px_rgba(225,29,72,0.45)] backdrop-blur-xl transition-all animate-fadeIn"
        >
          {/* Pulsing red top edge highlight */}
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-rose-500 via-red-500 to-amber-500 animate-pulse" />
          
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-400">
              <AlertOctagon className="h-5 w-5 animate-bounce" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="rounded-md bg-rose-600 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white uppercase tracking-wider">
                    {t.level === 'critical' ? 'CRITICAL VETO' : 'RISK ALERT'}
                  </span>
                  <span className="font-mono text-xs font-bold text-white">${t.token}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="font-mono text-[10px] text-neutral-400">
                    {formatTimestamp(t.ts)}
                  </span>
                  <button
                    onClick={() => onDismiss(t.id)}
                    className="rounded-md p-1 text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <h4 className="mt-1 font-mono text-xs font-bold text-rose-300">
                {t.title}
              </h4>
              <p className="mt-0.5 text-xs text-neutral-300 leading-relaxed break-words">
                {t.detail}
              </p>

              <div className="mt-2.5 flex items-center justify-between pt-2 border-t border-white/10 font-mono text-[10px]">
                <span className="text-neutral-400">
                  攔截代理: <span className="font-bold text-rose-300 uppercase">{t.agent}</span>
                </span>
                <span className="flex items-center gap-1 text-emerald-400 font-bold">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                  已攔截，買單自動終止
                </span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
