import React, { useState, useMemo } from 'react';
import { AgentCouncilLogItem, AgentName, AgentVerdict } from '../types';
import { formatTimestamp, translateReason, getAgentColor } from '../formatters';
import { 
  Users, 
  ShieldCheck, 
  ShieldAlert, 
  Search, 
  Filter, 
  CheckCircle2, 
  XCircle, 
  Radar, 
  BookOpen, 
  Crosshair, 
  Scale, 
  AlertTriangle 
} from 'lucide-react';

interface AgentCouncilProps {
  logs: AgentCouncilLogItem[];
}

export const AgentCouncil: React.FC<AgentCouncilProps> = ({ logs }) => {
  const [selectedAgent, setSelectedAgent] = useState<string>('all');
  const [selectedVerdict, setSelectedVerdict] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const agentIcons: Record<AgentName, React.ReactNode> = {
    scanner: <Radar className="h-3.5 w-3.5" />,
    narrative: <BookOpen className="h-3.5 w-3.5" />,
    sniper: <Crosshair className="h-3.5 w-3.5" />,
    judge: <Scale className="h-3.5 w-3.5" />,
    risk: <AlertTriangle className="h-3.5 w-3.5" />,
  };

  const agentDescriptions: Record<AgentName, string> = {
    scanner: '監控池子流動性 (>$20k)、流通市值區間、聰明錢包買盤與前十大持倉集中度，過濾蜜罐與撤池。',
    narrative: '審核 Robinhood Chain 熱點文化符號、Mascot 生態、推特/社群傳播熱度（L1/L2/L3 階級）。',
    sniper: '捕捉 1m/5m 爆發拉升突破動能、Volume 放量倍數，嚴禁在連續大紅 K 或動能背離時追高。',
    judge: '歷史數據審查員，調取同代幣/同地址歷史交易虧損紀錄，避免在同一隻割韭菜幣上連輸兩次。',
    risk: '全局風控閘門守門員，強制執行現金警戒線、持倉槽位上限（最多4檔）與單日最大回撤熔斷。',
  };

  const filteredLogs = useMemo(() => {
    return logs.filter((item) => {
      if (selectedAgent !== 'all' && item.agent !== selectedAgent) return false;
      if (selectedVerdict !== 'all' && item.verdict !== selectedVerdict) return false;
      if (!searchTerm) return true;
      const q = searchTerm.toLowerCase();
      return (
        item.token.toLowerCase().includes(q) ||
        item.reason.toLowerCase().includes(q) ||
        item.agent.toLowerCase().includes(q)
      );
    });
  }, [logs, selectedAgent, selectedVerdict, searchTerm]);

  // Statistics
  const totalLogs = logs.length;
  const approvedCount = logs.filter((l) => l.verdict === 'approve').length;
  const vetoCount = logs.filter((l) => l.verdict === 'veto').length;

  return (
    <div className="space-y-6">
      {/* Council Overview Card */}
      <div className="relative overflow-hidden rounded-3xl border border-indigo-500/30 bg-gradient-to-br from-indigo-950/40 via-neutral-900/60 to-black p-6 shadow-2xl backdrop-blur-md">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-400">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight text-white">
                  5-Agent 決策圓桌即時串流 (Agent Council)
                </h2>
                <span className="rounded-full bg-indigo-500/20 border border-indigo-500/30 px-2.5 py-0.5 font-mono text-xs font-bold text-indigo-300">
                  REAL-TIME PIPELINE
                </span>
              </div>
              <p className="mt-1 text-xs text-neutral-300 max-w-2xl">
                所有代幣開倉前必須經過 5 位專業 AI Agent 的層層審計，任一 Agent 投出否決票 (VETO) 立即終止開倉，全票通過方可執行鏈上買入。
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 font-mono text-xs">
            <div className="rounded-2xl border border-white/10 bg-black/60 p-3 text-center">
              <span className="text-neutral-500 block text-[10px]">歷史審核事件</span>
              <span className="text-base font-bold text-white">{totalLogs} 次</span>
            </div>
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/30 p-3 text-center">
              <span className="text-neutral-500 block text-[10px]">放行通過</span>
              <span className="text-base font-bold text-emerald-400">{approvedCount}</span>
            </div>
            <div className="rounded-2xl border border-rose-500/30 bg-rose-950/30 p-3 text-center">
              <span className="text-neutral-500 block text-[10px]">風控否決 (VETO)</span>
              <span className="text-base font-bold text-rose-400">{vetoCount}</span>
            </div>
          </div>
        </div>

        {/* 5-Agent Architecture Cards */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {(['scanner', 'narrative', 'sniper', 'judge', 'risk'] as AgentName[]).map((ag) => {
            const style = getAgentColor(ag);
            const count = logs.filter((l) => l.agent === ag).length;
            const vetoes = logs.filter((l) => l.agent === ag && l.verdict === 'veto').length;

            return (
              <div
                key={ag}
                onClick={() => setSelectedAgent(selectedAgent === ag ? 'all' : ag)}
                className={`cursor-pointer rounded-2xl border p-3 transition-all ${
                  selectedAgent === ag
                    ? `${style.border} bg-white/10 shadow-lg`
                    : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 font-mono text-xs font-bold uppercase text-white">
                    <span className={style.text}>{agentIcons[ag]}</span>
                    <span>{ag}</span>
                  </div>
                  <span className="font-mono text-[10px] text-neutral-400">
                    {vetoes > 0 ? `${vetoes} 否決` : '全放行'}
                  </span>
                </div>
                <p className="text-[11px] text-neutral-400 line-clamp-2">
                  {agentDescriptions[ag]}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-md">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            placeholder="搜尋代幣 (如 RUGPUMP, FAKEDOGE) 或審核原因..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-2xl border border-white/10 bg-black/50 py-2 pl-10 pr-4 font-mono text-xs text-white placeholder-neutral-500 focus:border-indigo-500/50 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Agent Filter */}
          <select
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
            className="rounded-2xl border border-white/10 bg-black/50 px-3 py-2 font-mono text-xs text-white focus:outline-none"
          >
            <option value="all">全部 Agent</option>
            <option value="scanner">Scanner</option>
            <option value="narrative">Narrative</option>
            <option value="sniper">Sniper</option>
            <option value="judge">Judge</option>
            <option value="risk">Risk</option>
          </select>

          {/* Verdict Filter */}
          <select
            value={selectedVerdict}
            onChange={(e) => setSelectedVerdict(e.target.value)}
            className="rounded-2xl border border-white/10 bg-black/50 px-3 py-2 font-mono text-xs text-white focus:outline-none"
          >
            <option value="all">全部裁決 (All)</option>
            <option value="approve">放行通過 (Approve)</option>
            <option value="veto">一票否決 (Veto)</option>
          </select>
        </div>
      </div>

      {/* Log List Matrix */}
      <div className="space-y-3">
        {filteredLogs.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-white/[0.02] py-16 text-center font-mono text-xs text-neutral-400">
            查無符合條件的 5-Agent 審計事件
          </div>
        ) : (
          filteredLogs.map((log) => {
            const style = getAgentColor(log.agent);
            const isApproved = log.verdict === 'approve';

            return (
              <div
                key={log.id}
                className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-2xl border p-4 backdrop-blur-md transition-all ${
                  isApproved
                    ? 'border-white/10 bg-white/[0.02] hover:border-white/20'
                    : 'border-rose-500/30 bg-rose-950/10 hover:border-rose-500/50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-neutral-500">
                    {formatTimestamp(log.ts)}
                  </span>

                  <span className={`w-24 rounded-md border ${style.border} ${style.bg} ${style.text} px-2 py-0.5 text-center font-mono text-xs font-bold uppercase`}>
                    {log.agent}
                  </span>

                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-white">${log.token}</span>
                      <span className={`flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                        isApproved ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                      }`}>
                        {isApproved ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                        <span>{isApproved ? '放行 (OK)' : '一票否決 (VETO)'}</span>
                      </span>
                    </div>

                    <div className="mt-1 font-mono text-xs text-neutral-300">
                      {translateReason(log.reason)}
                    </div>
                  </div>
                </div>

                <div className="self-end sm:self-center text-right font-mono text-xs">
                  <span className="text-neutral-500">評分: </span>
                  <span className="font-bold text-white">{log.score} 分</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
