import React, { useState, useRef, useEffect } from 'react';
import { DangerToast } from '../types';
import { Bell, ShieldAlert, AlertOctagon, CheckCheck, Trash2, X, PlusCircle, ShieldCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatTimestamp } from '../formatters';

interface NotificationBellProps {
  notifications: DangerToast[];
  onDismiss: (id: string) => void;
  onClearAll: () => void;
  onSimulateDangerAlert: () => void;
}

export const NotificationBell: React.FC<NotificationBellProps> = ({
  notifications,
  onDismiss,
  onClearAll,
  onSimulateDangerAlert,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [simulatedSuccess, setSimulatedSuccess] = useState<boolean>(false);
  const [page, setPage] = useState<number>(1);
  const pageSize = 5;
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const count = notifications.length;
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  // Reset page when count changes and safePage exceeds totalPages
  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [totalPages, page]);

  const paginatedNotifications = notifications.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        id="notification-bell-btn"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="集中通知中心"
        title="即時安全通知中心"
        className={`relative flex h-8 w-8 items-center justify-center rounded-none border transition-all ${
          isOpen
            ? 'border-rose-500/60 bg-rose-500/20 text-rose-300 shadow-md'
            : count > 0
            ? 'border-white/20 bg-neutral-900/80 text-neutral-200 hover:border-rose-500/40 hover:text-white'
            : 'border-white/10 bg-neutral-900/50 text-neutral-400 hover:border-white/20 hover:text-neutral-200'
        }`}
      >
        <Bell className={`h-4 w-4 ${count > 0 ? 'text-rose-400' : ''}`} />

        {/* Unread badge count */}
        {count > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-none bg-rose-600 px-1 font-mono text-[10px] font-bold text-white shadow-sm ring-1 ring-neutral-950">
            {count > 99 ? '99+' : count}
          </span>
        )}

        {/* Pulsing indicator when active notifications exist */}
        {count > 0 && !isOpen && (
          <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-none bg-rose-500 animate-ping opacity-75" />
        )}
      </button>

      {/* Dropdown Notification Center Popover */}
      {isOpen && (
        <div
          id="notification-popover-panel"
          className="absolute right-0 mt-2 w-80 sm:w-96 max-w-[90vw] z-50 rounded-none border border-white/15 bg-neutral-950/95 shadow-2xl backdrop-blur-2xl ring-1 ring-black/80 animate-fadeIn text-neutral-200"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-2.5 bg-neutral-900/70">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-rose-400" />
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-white">
                安全通知中心
              </span>
              <span className="rounded-none bg-rose-500/20 border border-rose-500/40 px-1.5 py-0.2 font-mono text-[10px] font-bold text-rose-300">
                {count} 則警報
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              {count > 0 && (
                <button
                  onClick={onClearAll}
                  title="清空所有通知"
                  className="flex items-center gap-1 rounded-none px-2 py-1 text-[11px] font-mono text-neutral-400 hover:bg-white/5 hover:text-neutral-200 transition-colors"
                >
                  <Trash2 className="h-3 w-3" />
                  <span>清空</span>
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 text-neutral-400 hover:text-white transition-colors"
                title="關閉"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Quick Simulation Trigger inside dropdown */}
          <div className="flex items-center justify-between border-b border-white/5 bg-black/40 px-3.5 py-1.5 text-[11px] font-mono text-neutral-400">
            <span className="text-neutral-500">測試 5-Agent 攔截管線:</span>
            <div className="flex items-center gap-2">
              {simulatedSuccess && (
                <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-bold animate-pulse">
                  <CheckCheck className="h-3 w-3 text-emerald-400" />
                  已新增至下方
                </span>
              )}
              <button
                onClick={() => {
                  onSimulateDangerAlert();
                  setSimulatedSuccess(true);
                  setTimeout(() => setSimulatedSuccess(false), 3500);
                }}
                className="flex items-center gap-1 text-rose-400 hover:text-rose-300 font-bold transition-colors"
              >
                <PlusCircle className="h-3 w-3" />
                <span>觸發模擬警報</span>
              </button>
            </div>
          </div>

          {/* Notification Items List */}
          <div className="max-h-80 overflow-y-auto divide-y divide-white/5 font-sans">
            {count === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-none bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 mb-2">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <p className="font-mono text-xs font-bold text-neutral-200">
                  目前無未讀警報
                </p>
                <p className="mt-1 text-[11px] text-neutral-400 max-w-xs leading-relaxed">
                  5-Agent 交易室威脅防護網持續運行中，惡意蜜罐與鯨魚異動將即時集中於此。
                </p>
              </div>
            ) : (
              paginatedNotifications.map((t) => (
                <div
                  key={t.id}
                  className="group relative p-3 transition-colors hover:bg-white/[0.03]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`rounded-none px-1.5 py-0.2 font-mono text-[9px] font-bold uppercase tracking-wider ${
                          t.level === 'critical'
                            ? 'bg-rose-600/30 border border-rose-500/50 text-rose-300'
                            : 'bg-amber-600/30 border border-amber-500/50 text-amber-300'
                        }`}
                      >
                        {t.level === 'critical' ? 'CRITICAL VETO' : 'RISK ALERT'}
                      </span>
                      <span className="font-mono text-xs font-bold text-white">
                        ${t.token}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] text-neutral-500">
                        {formatTimestamp(t.ts)}
                      </span>
                      <button
                        onClick={() => onDismiss(t.id)}
                        className="text-neutral-500 hover:text-neutral-200 transition-colors p-0.5"
                        title="標記已讀/移除"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>

                  <h5 className="mt-1 font-mono text-xs font-semibold text-rose-300">
                    {t.title}
                  </h5>
                  <p className="mt-0.5 text-[11px] text-neutral-400 leading-relaxed break-words">
                    {t.detail}
                  </p>

                  <div className="mt-2 flex items-center justify-between text-[10px] font-mono border-t border-white/5 pt-1.5">
                    <span className="text-neutral-500">
                      攔截: <span className="text-neutral-300 uppercase font-bold">{t.agent}</span>
                    </span>
                    <span className="text-emerald-400 font-bold">
                      ● 已自動終止買單
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Mini Pagination Bar when totalPages > 1 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-white/10 bg-neutral-900/90 px-3 py-1.5 font-mono text-[11px] text-neutral-400">
              <span>
                第 <span className="text-white font-bold">{safePage}</span> / {totalPages} 頁 (共 {count} 則)
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(Math.max(1, safePage - 1))}
                  disabled={safePage === 1}
                  className="flex h-5 w-5 items-center justify-center rounded border border-white/10 bg-black/40 text-neutral-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
                  title="上一頁"
                >
                  <ChevronLeft className="h-3 w-3" />
                </button>
                <button
                  onClick={() => setPage(Math.min(totalPages, safePage + 1))}
                  disabled={safePage === totalPages}
                  className="flex h-5 w-5 items-center justify-center rounded border border-white/10 bg-black/40 text-neutral-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
                  title="下一頁"
                >
                  <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="border-t border-white/10 bg-neutral-950 px-3.5 py-2 text-center text-[10px] font-mono text-neutral-500">
            Robinhood Chain Meme · 5-Agent 自動威脅防禦中樞
          </div>
        </div>
      )}
    </div>
  );
};
