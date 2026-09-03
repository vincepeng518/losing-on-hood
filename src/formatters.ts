import { AgentName, ExitMethod } from './types';

// 36+ Traditional Chinese translation rules for quant agent decisions and signals
const ZH_RULES: [RegExp, string][] = [
  [/^dev sold \(paper override\)/i, '開發者已賣出（模擬倉放行）'],
  [/^dev sold/i, '開發者已賣出'],
  [/^honeypot/i, '蜜罐幣風險偵測'],
  [/^bundled/i, '發現捆綁買入 (Bundled Buy)'],
  [/^liq<\$?([0-9.]+)/i, '流動性低於 $$1'],
  [/^mc band/i, '市值超出策略區間'],
  [/^holders<([0-9.]+)/i, '持有者少於 $1 人'],
  [/^top10 concentrated/i, '前十大持倉過度集中 (Whale Dump Risk)'],
  [/^narrative L(\d+): (.*)$/i, '命中 L$1 主題：「$2」'],
  [/^no narrative match: symbol\/name='(.*)'/i, '無主題命中：$1'],
  [/^no narrative match$/i, '無熱點主題命中'],
  [/^insufficient gas for trade \(\$(.*)\)/i, 'Gas 儲備不足（可用 $1）'],
  [/^risk gate passed: (.*)$/i, '風控閘門通過：$1'],
  [/^passed global risk gate$/i, '全局風控閘門放行'],
  [/^ok: /i, '審核通過：'],
  [/^ok$/i, '放行（無異常指標）'],
  [/^bad momentum 5m (.*%) red=(\d+)/i, '5 分鐘動能轉弱 $1（連續紅 K $2 根）'],
  [/^strong pump (.*)/i, '強勢拉升突破 $1'],
  [/^up (.*)/i, '上升通道走勢 $1'],
  [/^flat (.*)/i, '橫盤低量整理 $1'],
  [/^weak (.*)/i, '買盤動能偏弱 $1'],
  [/^insufficient kline/i, 'K 線資料不足（新發代幣）'],
  [/^seen recently/i, '48 小時內已否決過，防重複追高'],
  [/^seen before, no previous loss/i, '曾開倉過且無虧損歷史'],
  [/^seen before$/i, '歷史審查清單已有紀錄'],
  [/^lost on this before \((.*)\)/i, '此代幣上次交易發生虧損（$1）'],
  [/^symbol (.*) lost (\d+)x/i, '同名代幣 $1 已累計虧損 $2 次'],
  [/^fast dump (.*%) \(peak \+(.*)%\)/i, '短線急殺 $1（峰值 +$2%）'],
  [/^flow collapse s1=(\d+)\/b1=(\d+) s5=(\d+)\/b5=(\d+) (.*)/i, '買盤崩落：1m 賣$1/買$2、5m 賣$3/買$4，變化 $5'],
  [/^downtrend (.*%) (\d+)min/i, '下行陰跌 $1，已持倉 $2 分鐘'],
  [/^giveback \(peak \+(.*)%, now (.*)%\)/i, '利潤回吐過深（峰值 +$1%，現 $2%）'],
  [/^stale 12h (.*)/i, '持倉逾 12 小時無動靜 $1'],
  [/^no momentum 45min \((.*)\)/i, '45 分鐘毫無買量突破（$1）'],
  [/^disaster (.*)/i, '閃崩重挫 $1'],
  [/^condition order filled/i, '達到條件單停利線成交'],
  [/^swap timeout/i, '鏈上 Swap 交易逾時'],
];

export function zh(raw: string | undefined | null): string {
  if (!raw) return '無附加訊號';
  let s = String(raw).trim();
  for (const [pattern, replacement] of ZH_RULES) {
    if (pattern.test(s)) {
      s = s.replace(pattern, replacement);
      break;
    }
  }
  return s
    .replace(/\bsmart_wallets=/gi, '聰明錢包數 ')
    .replace(/\bsmart_buy_30m=/gi, '30分鐘聰明錢買入 ')
    .replace(/\bliq=\$/gi, '池子流動性 $')
    .replace(/\bmc=\$/gi, '流通市值 $')
    .replace(/\bequity=\$/gi, '帳戶淨值 $')
    .replace(/\bcash=\$/gi, '可用現金 $')
    .replace(/\bopen=(\d+)\/(\d+)/gi, '持倉槽位 $1/$2')
    .replace(/\bholders=/gi, '持有人數 ')
    .replace(/\bscore=/gi, '綜合評分 ');
}

export const translateReason = zh;

export function formatUsd(val: number, options?: { showPlus?: boolean; decimals?: number }): string {
  const decimals = options?.decimals ?? 2;
  const isPositive = val > 0;
  const formatted = Math.abs(val).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  if (val < 0) return `-$${formatted}`;
  if (isPositive && options?.showPlus) return `+$${formatted}`;
  return `$${formatted}`;
}

export function formatPercent(val: number, options?: { showPlus?: boolean; decimals?: number }): string {
  const decimals = options?.decimals ?? 1;
  const formatted = Math.abs(val).toFixed(decimals);
  if (val < 0) return `-${formatted}%`;
  if (val > 0 && options?.showPlus) return `+${formatted}%`;
  return `${formatted}%`;
}

export function formatPrice(price: number): string {
  if (price === 0) return '$0.00';
  if (price >= 1) return `$${price.toFixed(4)}`;
  if (price >= 0.0001) return `$${price.toFixed(6)}`;
  return `$${price.toFixed(8)}`;
}

export function formatEth(eth?: number | null): string {
  if (eth == null || isNaN(eth)) return '—';
  return `${eth.toFixed(5)} ETH`;
}

export function formatTimestamp(tsOrDate: number | string): string {
  if (!tsOrDate) return '--:--';
  let d: Date;
  if (typeof tsOrDate === 'number') {
    d = new Date(tsOrDate > 1e12 ? tsOrDate : tsOrDate * 1000);
  } else if (!isNaN(Number(tsOrDate)) && !tsOrDate.includes('-') && !tsOrDate.includes('T')) {
    const num = Number(tsOrDate);
    d = new Date(num > 1e12 ? num : num * 1000);
  } else {
    d = new Date(tsOrDate);
  }
  if (isNaN(d.getTime())) return String(tsOrDate);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${m}/${day} ${h}:${min}`;
}

export function getAgentColor(agent: AgentName | string): { bg: string; text: string; border: string } {
  switch (agent) {
    case 'scanner':
      return { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30' };
    case 'narrative':
      return { bg: 'bg-indigo-500/10', text: 'text-indigo-400', border: 'border-indigo-500/30' };
    case 'sniper':
      return { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30' };
    case 'judge':
      return { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/30' };
    case 'risk':
      return { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/30' };
    default:
      return { bg: 'bg-neutral-500/10', text: 'text-neutral-400', border: 'border-neutral-500/30' };
  }
}

export function getExitDiagnosis(reason: string, method?: string): { tag: string; color: string; desc: string } {
  const text = (reason + ' ' + (method || '')).toLowerCase();
  if (text.includes('flow collapse') || text.includes('買盤崩落')) {
    return { tag: '買盤崩落', color: 'text-rose-400 border-rose-500/30 bg-rose-950/40', desc: '1m / 5m 賣單大量湧現，買量驟降' };
  }
  if (text.includes('fast dump') || text.includes('急殺')) {
    return { tag: '短線急殺', color: 'text-red-400 border-red-500/30 bg-red-950/40', desc: '極短線跌幅過大引發強制清倉' };
  }
  if (text.includes('reversal loss') || text.includes('反轉')) {
    return { tag: '反轉虧損', color: 'text-red-400 border-red-500/30 bg-red-950/40', desc: '衝高後反轉跌破進場價，真實死因是虧損而非獲利回吐' };
  }
  if (text.includes('giveback') || text.includes('獲利回吐')) {
    return { tag: '獲利回吐（浮盈收縮）', color: 'text-amber-400 border-amber-500/30 bg-amber-950/40', desc: '平倉時仍有浮盈，利潤自高點收縮落袋' };
  }
  if (text.includes('downtrend') || text.includes('下行') || text.includes('陰跌')) {
    return { tag: '陰跌下行', color: 'text-orange-400 border-orange-500/30 bg-orange-950/40', desc: '長時間缺乏買盤推進，趨勢轉空' };
  }
  if (text.includes('condition') || text.includes('take_profit') || text.includes('條件單')) {
    return { tag: '條件單成交', color: 'text-emerald-400 border-emerald-500/30 bg-emerald-950/40', desc: '觸及既定停利/目標價平倉' };
  }
  if (text.includes('stale') || text.includes('no momentum')) {
    return { tag: '動能枯竭', color: 'text-zinc-400 border-zinc-500/30 bg-zinc-900/40', desc: '45分鐘至12小時無交易突破' };
  }
  return { tag: '審查平倉', color: 'text-cyan-400 border-cyan-500/30 bg-cyan-950/40', desc: '5-Agent 判定退場條件達成' };
}
