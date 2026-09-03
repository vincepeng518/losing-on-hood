import React, { useState } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  ChevronsLeft, 
  ChevronsRight 
} from 'lucide-react';

export interface PaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  pageSizeOptions?: number[];
  onPageSizeChange?: (pageSize: number) => void;
  itemLabel?: string;
  accentColor?: 'rose' | 'indigo' | 'red' | 'amber' | 'neutral';
  className?: string;
}

export const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
  pageSizeOptions = [10, 25, 50],
  onPageSizeChange,
  itemLabel = '筆歷史紀錄',
  accentColor = 'rose',
  className = '',
}) => {
  const [jumpInput, setJumpInput] = useState('');
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  const startIndex = totalItems === 0 ? 0 : (safeCurrentPage - 1) * pageSize + 1;
  const endIndex = Math.min(totalItems, safeCurrentPage * pageSize);

  // If there are no items, nothing to paginate
  if (totalItems === 0) {
    return null;
  }

  // Accent styling mapping
  const colorMap = {
    rose: {
      active: 'bg-rose-500/20 text-rose-300 border-rose-500/50 font-bold',
      focus: 'focus:border-rose-500/50',
      badge: 'text-rose-300',
    },
    indigo: {
      active: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/50 font-bold',
      focus: 'focus:border-indigo-500/50',
      badge: 'text-indigo-300',
    },
    red: {
      active: 'bg-red-500/20 text-red-300 border-red-500/50 font-bold',
      focus: 'focus:border-red-500/50',
      badge: 'text-red-300',
    },
    amber: {
      active: 'bg-amber-500/20 text-amber-300 border-amber-500/50 font-bold',
      focus: 'focus:border-amber-500/50',
      badge: 'text-amber-300',
    },
    neutral: {
      active: 'bg-white/20 text-white border-white/50 font-bold',
      focus: 'focus:border-white/50',
      badge: 'text-neutral-200',
    },
  };

  const theme = colorMap[accentColor] || colorMap.rose;

  // Generate page numbers with ellipsis
  const getPageNumbers = () => {
    const pages: (number | '...')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (safeCurrentPage > 3) {
        pages.push('...');
      }
      const start = Math.max(2, safeCurrentPage - 1);
      const end = Math.min(totalPages - 1, safeCurrentPage + 1);
      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
      if (safeCurrentPage < totalPages - 2) {
        pages.push('...');
      }
      pages.push(totalPages);
    }
    return pages;
  };

  const handleJump = (e: React.FormEvent) => {
    e.preventDefault();
    const target = parseInt(jumpInput, 10);
    if (!isNaN(target) && target >= 1 && target <= totalPages) {
      onPageChange(target);
      setJumpInput('');
    }
  };

  return (
    <div
      className={`flex flex-col md:flex-row items-center justify-between gap-3.5 rounded-2xl border border-white/10 bg-white/[0.02] p-3.5 backdrop-blur-md font-mono text-xs ${className}`}
    >
      {/* Left: Summary & Records Range */}
      <div className="flex flex-wrap items-center gap-2 text-neutral-400">
        <span>
          顯示第 <span className="text-white font-bold">{startIndex}</span> ~{' '}
          <span className="text-white font-bold">{endIndex}</span> 筆，
          共 <span className={`font-bold ${theme.badge}`}>{totalItems}</span> {itemLabel}
        </span>

        {/* Page Size Selector */}
        {pageSizeOptions && onPageSizeChange && (
          <div className="flex items-center gap-1.5 ml-0 sm:ml-2 pl-0 sm:pl-2 border-t sm:border-t-0 sm:border-l border-white/10 pt-1.5 sm:pt-0">
            <span className="text-neutral-500">每頁上限:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                const newSize = Number(e.target.value);
                onPageSizeChange(newSize);
              }}
              className={`rounded-lg border border-white/10 bg-black/60 px-2 py-0.5 text-white font-mono focus:outline-none ${theme.focus}`}
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt} className="bg-neutral-900 text-white">
                  {opt} 筆 / 頁
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Right: Pagination Controls (when totalPages > 1) */}
      {totalPages > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {/* First Page */}
          <button
            onClick={() => onPageChange(1)}
            disabled={safeCurrentPage === 1}
            title="第一頁"
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-neutral-300 transition-all hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </button>

          {/* Previous Page */}
          <button
            onClick={() => onPageChange(safeCurrentPage - 1)}
            disabled={safeCurrentPage === 1}
            title="上一頁"
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-neutral-300 transition-all hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>

          {/* Page Numbers */}
          <div className="flex items-center gap-1">
            {getPageNumbers().map((pageNum, idx) => {
              if (pageNum === '...') {
                return (
                  <span
                    key={`ellipsis-${idx}`}
                    className="flex h-7 w-7 items-center justify-center text-neutral-600 select-none"
                  >
                    ...
                  </span>
                );
              }
              const isActive = pageNum === safeCurrentPage;
              return (
                <button
                  key={pageNum}
                  onClick={() => onPageChange(pageNum as number)}
                  className={`flex h-7 min-w-[28px] px-1.5 items-center justify-center rounded-lg border text-xs transition-all ${
                    isActive
                      ? theme.active
                      : 'border-white/10 bg-black/40 text-neutral-400 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
          </div>

          {/* Next Page */}
          <button
            onClick={() => onPageChange(safeCurrentPage + 1)}
            disabled={safeCurrentPage === totalPages}
            title="下一頁"
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-neutral-300 transition-all hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>

          {/* Last Page */}
          <button
            onClick={() => onPageChange(totalPages)}
            disabled={safeCurrentPage === totalPages}
            title="最後一頁"
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-neutral-300 transition-all hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </button>

          {/* Quick Jump Input when totalPages > 5 */}
          {totalPages > 5 && (
            <form onSubmit={handleJump} className="hidden sm:flex items-center gap-1 ml-1 pl-2 border-l border-white/10">
              <span className="text-[11px] text-neutral-500">跳至</span>
              <input
                type="number"
                min={1}
                max={totalPages}
                value={jumpInput}
                onChange={(e) => setJumpInput(e.target.value)}
                placeholder={String(safeCurrentPage)}
                className={`h-7 w-12 rounded-lg border border-white/10 bg-black/60 px-1 text-center font-mono text-xs text-white focus:outline-none ${theme.focus}`}
              />
              <span className="text-[11px] text-neutral-500">頁</span>
            </form>
          )}
        </div>
      ) : (
        <div className="text-[11px] text-neutral-500">
          第 1 / 1 頁（未達分頁上限）
        </div>
      )}
    </div>
  );
};
