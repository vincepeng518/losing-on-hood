import express, { Request, Response } from "express";
import fs from "fs";
import path from "path";

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";

const DASHBOARD_FILE = fs.existsSync(path.resolve(process.cwd(), "index.html"))
  ? path.resolve(process.cwd(), "index.html")
  : path.resolve(process.cwd(), "paper_trade/dashboard.html");

function getPaperStateFile(): string {
  const dataPath = path.resolve(process.cwd(), "paper_data/paper_state.json");
  const tradePath = path.resolve(process.cwd(), "paper_trade/paper_state.json");
  if (fs.existsSync(dataPath)) {
    if (!fs.existsSync(tradePath)) return dataPath;
    const dataStat = fs.statSync(dataPath);
    const tradeStat = fs.statSync(tradePath);
    return dataStat.size >= tradeStat.size ? dataPath : tradePath;
  }
  return tradePath;
}
const LIVE_STATE_FILE = path.resolve(process.cwd(), "state.json");

function loadJson(filePath: string, fallback: any = {}): any {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
        return parsed;
      }
    }
  } catch (err) {
    console.error(`Failed to load ${filePath}:`, err);
  }
  return fallback;
}

function esc(s: any): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeTs(v: any): Date {
  if (typeof v === "string") {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  const tsNum = Number(v) || 0;
  if (tsNum <= 0) return new Date();
  const adjusted = tsNum > 1e12 ? tsNum : tsNum * 1000;
  const d = new Date(adjusted);
  return isNaN(d.getTime()) ? new Date() : d;
}

const TMPL_SET = new Set(["", "-", "ok", "passed global risk gate", "no narrative match"]);

function isTmpl(r: any): boolean {
  return TMPL_SET.has(String(r || "").trim().toLowerCase());
}

const ZH_RULES: [RegExp, string][] = [
  [/^dev sold \(paper override\)/, "開發者已賣出（模擬倉放行）"],
  [/^dev sold/, "開發者已賣出"],
  [/^honeypot/, "蜜罐幣"],
  [/^bundled/, "捆綁買入偵測"],
  [/^liq<\$?([0-9.]+)/, "流動性低於 $$1"],
  [/^mc band/, "市值超出區間"],
  [/^holders<([0-9.]+)/, "持有者少於 $1 人"],
  [/^top10 concentrated/, "前十大持倉過度集中"],
  [/^narrative L(\d+): (.*)$/, "命中 L$1 主題：「$2」"],
  [/^no narrative match: symbol\/name='(.*)' /, "無主題命中：symbol/name='$1' "],
  [/^no narrative match$/, "無主題命中"],
  [/^insufficient gas for trade \(\$(.*)\)$/, "交易資金不足（可用 $1）"],
  [/^risk gate passed: (.*)$/, "風控通過：$1"],
  [/^passed global risk gate$/, "風控閘門通過"],
  [/^ok: /, "通過："],
  [/^ok$/, "通過（無異常）"],
  [/^bad momentum 5m (.*%) red=(\d+)$/, "5 分鐘動能轉差 $1（紅 K $2 根）"],
  [/^strong pump (.*)$/, "強勢拉升 $1"],
  [/^up (.*)$/, "上行走勢 $1"],
  [/^flat (.*)$/, "橫盤整理 $1"],
  [/^weak (.*)$/, "動能偏弱 $1"],
  [/^insufficient kline$/, "K 線資料不足"],
  [/^seen recently$/, "48 小時內已拒絕過"],
  [/^seen before$/, "曾看過此代幣"],
  [/^lost on this before \((.*)\)$/, "此代幣上次交易虧損（$1）"],
  [/^symbol (.*) lost (\d+)x$/, "同名代幣 $1 已虧損 $2 次"],
  [/^fast dump (.*%) \(peak \+(.*)%\)$/, "急殺 $1（峰值 +$2%）"],
  [/^flow collapse s1=(\d+)\/b1=(\d+) s5=(\d+)\/b5=(\d+) (.*)$/, "買盤崩落：1m 賣$1/買$2、5m 賣$3/買$4，變化 $5"],
  [/^downtrend (.*%) (\d+)min$/, "下行趨勢 $1，已持倉 $2 分鐘"],
  [/^giveback \(peak \+(.*)%, now (.*)%\)$/, "獲利回吐（峰值 +$1%，現 $2%）"],
  [/^stale 12h (.*)$/, "閒置逾 12 小時 $1"],
  [/^no momentum 45min \((.*)\)$/, "45 分鐘無動能（$1）"],
  [/^disaster (.*)$/, "崩盤 $1"],
  [/^condition order filled$/, "條件單成交"],
  [/^swap timeout$/, "swap 逾時"],
];

function zh(r: any): string {
  if (r == null) return "";
  let s = String(r);
  for (const [pattern, replacement] of ZH_RULES) {
    if (pattern.test(s)) {
      s = s.replace(pattern, replacement);
      break;
    }
  }
  return s
    .replace(/\bsmart_wallets=/g, "聰明錢包數 ")
    .replace(/\bsmart_buy_30m=/g, "30 分鐘聰明錢買入 ")
    .replace(/\bliq=\$/g, "流動性 $")
    .replace(/\bmc=\$/g, "市值 $")
    .replace(/\bequity=\$/g, "權益 $")
    .replace(/\bcash=\$/g, "現金 $")
    .replace(/\bopen=(\d+)\/(\d+)/g, "持倉 $1/$2")
    .replace(/\bholders=/g, "持有者 ")
    .replace(/\bscore=/g, "評分 ");
}

function kv(k: string, v: string): string {
  return `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`;
}

function snapMatrix(c: any): string {
  const mtg = c?.meeting || [];
  if (!mtg.length) return "";
  const nc: Record<string, string> = { scanner: "sc", narrative: "na", risk: "ri", sniper: "sn", judge: "ju" };
  let h = '<div class="snap-matrix"><div class="snap-t">決策快照</div>';
  for (const m of mtg) {
    const agent = m.agent || "?";
    const verdict = m.verdict || "?";
    const score = m.score;
    const reason = esc(zh(String(m.reason || "")));
    const tmpl = isTmpl(String(m.reason || ""));
    const ncCls = nc[agent] || "";
    const scTxt = score != null ? String(score) : "-";
    const bdCls = verdict === "approve" ? "ok" : "no";
    const bdTxt = verdict === "approve" ? "OK" : "NO";
    const rsCls = tmpl ? " tmpl" : "";
    h += `<div class="aline"><span class="a-nm ${ncCls}">${esc(agent)}</span>`;
    h += `<span class="a-sc">${scTxt}</span>`;
    h += `<span class="a-bd ${bdCls}">${bdTxt}</span>`;
    h += `<span class="a-rs${rsCls}">${reason}</span></div>`;
  }
  h += "</div>";
  return h;
}

function meetingWarn(c: any): string {
  const mtg = c?.meeting || [];
  if (!mtg.length) {
    return '<div class="warn">歷史無留痕快照 · 策略早期紀錄</div>';
  }
  const bad = mtg.filter((m: any) => isTmpl(String(m.reason || ""))).length;
  if (bad === mtg.length) {
    return '<div class="warn">快照理由均為預設模板</div>';
  }
  if (bad > 0) {
    return `<div class="warn">${bad} 項理由為模板</div>`;
  }
  return "";
}

function buildDiscSsr(log: any[]): string {
  if (!log || !log.length) return "";
  const groups: Record<string, any[]> = {};
  const order: string[] = [];
  for (const a of log) {
    const t = a.token || "?";
    if (!groups[t]) {
      groups[t] = [];
      order.push(t);
    }
    groups[t].push(a);
  }

  const nc: Record<string, string> = { scanner: "sc", narrative: "na", risk: "ri", sniper: "sn", judge: "ju" };
  let h = "";
  for (const tk of order) {
    const items = groups[tk];
    const sc = items.reduce((sum, i) => sum + (Number(i.score) || 0), 0);
    const ok = items.every((i) => i.verdict === "approve");
    const agentsRan = new Set(items.map((i) => i.agent || "?")).size;
    const short = agentsRan < 5;

    h += '<div class="dcard" onclick="this.classList.toggle(\'open\')">';
    h += '<div class="dcard-h">';
    h += `<span class="dcard-sym">${esc(tk)}</span>`;
    if (short) {
      h += `<span class="pill partial">提早否決 ${agentsRan}/5</span>`;
    }
    h += `<span class="pill ${ok ? "ok" : "no"}">${ok ? "通過" : "否決"}</span>`;
    h += `<span class="dcard-sc" style="color:${ok ? "var(--green)" : "var(--red)"}">${sc}</span>`;
    const dt = safeTs(items[items.length - 1]?.ts);
    const dtStr = `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
    h += `<span class="dcard-ts">${dtStr}</span>`;
    h += '<span class="dcard-arr">▸</span></div>';
    h += '<div class="dcard-b">';
    h += '<div class="snap-title">決策快照</div>';
    for (const m of items) {
      const agent = m.agent || "?";
      const verdict = m.verdict || "?";
      const score = m.score != null ? m.score : 0;
      const reason = esc(zh(m.reason || ""));
      const tmpl = isTmpl(m.reason || "");
      const ncCls = nc[agent] || "";
      h += `<div class="aline"><span class="a-nm ${ncCls}">${esc(agent)}</span>`;
      h += `<span class="a-sc">${score}</span>`;
      h += `<span class="a-bd ${verdict === "approve" ? "ok" : "no"}">${verdict === "approve" ? "OK" : "NO"}</span>`;
      h += `<span class="a-rs${tmpl ? " tmpl" : ""}">${reason}</span></div>`;
    }
    h += "</div></div>";
  }
  return h;
}

function buildTradesSsr(closed: any[]): string {
  if (!closed || !closed.length) {
    return '<div style="color:var(--muted);padding:20px;text-align:center;font-size:12px">尚無交易紀錄</div>';
  }
  let h = "";
  const reversed = [...closed].reverse();
  for (const c of reversed) {
    const pnl = parseFloat(c.pnl_usd || 0);
    const pct = parseFloat(c.pnl_pct || 0);
    const dt = safeTs(c.time);
    const tsS = `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
    const rawReason = String(c.exit_reason || c.reason || c.method || "-");
    const reasonZh = zh(rawReason);
    const reasonShort = esc(reasonZh.slice(0, 32));
    const isRt = isTmpl(rawReason);
    const sym = esc(c.symbol || "?");
    const uid = "d" + Math.random().toString(36).substring(2, 8);
    const gcCls = pnl >= 0 ? "g" : "r";

    const peakVal = parseFloat(c.peak || 0);
    const peakHtml = peakVal > 0 ? `<span class="peak-tag">PEAK +${peakVal.toFixed(1)}%</span>` : "";

    // summary row
    h += `<div class="trow" onclick="var d=document.getElementById('${uid}');this.classList.toggle('open');d.style.display=d.style.display==='block'?'none':'block'">`;
    h += `<div><div class="trow-s">${sym}${peakHtml}</div><div class="trow-sub">${tsS} · <span class="${isRt ? "reason-tmpl" : ""}">${reasonShort}</span></div></div>`;
    h += `<span class="trow-pct ${gcCls}">${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%</span>`;
    h += `<span class="trow-pnl ${gcCls}">${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}</span>`;
    h += "</div>";

    // detail row
    h += `<div class="trow-d" id="${uid}">`;
    const alloc = parseFloat(c.alloc_usd || 5);
    h += kv("倉位", `$${alloc.toFixed(2)}`);
    if (c.entry_price) {
      const ep = parseFloat(c.entry_price);
      h += kv("進場", ep > 10 ? ep.toPrecision(4) : ep.toFixed(6));
    }
    if (c.entry_eth) {
      h += kv("進場", `${parseFloat(c.entry_eth).toFixed(5)} ETH`);
    }
    if (c.exit_price) {
      const xp = parseFloat(c.exit_price);
      h += kv("出場", xp > 10 ? xp.toPrecision(4) : xp.toFixed(6));
    }
    if (c.exit_eth) {
      h += kv("出場", `${parseFloat(c.exit_eth).toFixed(5)} ETH`);
    }
    const slip = parseFloat(c.slippage_pct || c.slip_pct || 0);
    h += kv("滑價", `${slip.toFixed(2)}%`);
    h += kv("燃料費", `$${parseFloat(c.gas_usd || 0).toFixed(3)}`);
    h += kv("方式", esc(c.method || "-"));
    const detailReason = c.exit_reason || c.reason || "-";
    const isDetailTmpl = isTmpl(detailReason);
    h += kv("理由", `<span class="${isDetailTmpl ? "reason-tmpl" : ""}">${esc(zh(detailReason))}</span>`);

    if (c.held_min) {
      h += kv("持倉時間", `${c.held_min} 分鐘`);
    }
    h += snapMatrix(c);
    h += meetingWarn(c);
    h += "</div>";
  }
  return h;
}

function injectSsr(html: string, paper: any, live: any): string {
  const cash = Number(paper?.cash_usd || 0);
  const closed = paper?.closed || [];
  const real = closed.reduce((acc: number, c: any) => acc + (Number(c.pnl_usd) || 0), 0);
  const wins = closed.filter((c: any) => (Number(c.pnl_usd) || 0) > 0).length;
  const wr = closed.length ? Math.round((wins / closed.length) * 100) : 0;
  const nOpen = Object.keys(paper?.positions || {}).length;
  const gas = closed.reduce((acc: number, c: any) => acc + (Number(c.gas_usd) || 0), 0);

  const fmt = (v: number) => (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2));
  const pCls = (v: number) => (v >= 0 ? "g" : "r");

  const kpiCells = (arr: [string, string, string][]) =>
    arr.map(([k, v, c]) => `<div class="kpi"><div class="l">${k}</div><div class="v ${c || ""}">${v}</div></div>`).join("");

  const pkpiHtml = kpiCells([
    ["現金", `$${cash.toFixed(2)}`, ""],
    ["已實現", fmt(real), pCls(real)],
    ["勝率", `${wr}%`, ""],
    ["燃料費", `$${gas.toFixed(2)}`, ""],
    ["持倉中", String(nOpen), ""],
    ["已平倉", String(closed.length), ""],
  ]);
  html = html.replace(/(<div[^>]*\bid="pkpi"[^>]*>)([\s\S]*?)(<\/div>)/, (_m, open, _mid, close) => `${open}${pkpiHtml}${close}`);

  const leq = Number(live?._onchain_usd || live?.equity_usd || 0);
  const lbk = Number(live?.equity_usd || 0);
  const lc = live?.closed || [];
  const lreal = lc.reduce((acc: number, c: any) => acc + (Number(c.pnl_usd) || 0), 0);
  const lgas = lc.reduce((acc: number, c: any) => acc + (Number(c.gas_usd) || 0), 0);
  const lkpiHtml = kpiCells([
    ["鏈上餘額", `$${leq.toFixed(2)}`, ""],
    ["帳面價值", `$${lbk.toFixed(2)}`, ""],
    ["已實現", fmt(lreal), pCls(lreal)],
    ["燃料費", `$${lgas.toFixed(2)}`, ""],
    ["已平倉", String(lc.length), ""],
    ["持倉中", String(Object.keys(live?.positions || {}).length), ""],
  ]);
  html = html.replace(/(<div[^>]*\bid="lkpi"[^>]*>)([\s\S]*?)(<\/div>)/, (_m, open, _mid, close) => `${open}${lkpiHtml}${close}`);

  // SSR script injection before the first <script>
  const ssrData = JSON.stringify({ paper, live });
  const ssrScript = `<script>window.__SSR=${ssrData};</script>`;
  html = html.replace("<script>", () => `${ssrScript}\n<script>`);

  // Agent Discussion SSR
  const discHtml = buildDiscSsr(paper?.agent_log || []);
  html = html.replace(/(<div[^>]*\bid="pdisc"[^>]*>)([\s\S]*?)(<\/div>)/, (_m, open, _mid, close) => `${open}${discHtml}${close}`);

  // Paper trades SSR
  const ptHtml = buildTradesSsr(paper?.closed || []);
  html = html.replace(/(<div[^>]*\bid="ptrades"[^>]*>)([\s\S]*?)(<\/div>)/, (_m, open, _mid, close) => `${open}${ptHtml}${close}`);

  // Live trades SSR
  const ltHtml = buildTradesSsr(live?.closed || []);
  html = html.replace(/(<div[^>]*\bid="ltrades"[^>]*>)([\s\S]*?)(<\/div>)/, (_m, open, _mid, close) => `${open}${ltHtml}${close}`);

  return html;
}

app.use(express.json());

// API health endpoint
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", port: PORT });
});

// API paper state endpoint
app.get("/api/state", (_req: Request, res: Response) => {
  const paper = loadJson(getPaperStateFile());
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.json(paper);
});

// API live state endpoint
app.get("/api/live", (_req: Request, res: Response) => {
  const live = loadJson(LIVE_STATE_FILE);
  if (!live._onchain_usd && live.equity_usd) {
    live._onchain_usd = live.equity_usd;
  }
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.json(live);
});

// Serve the dashboard with SSR
app.get(["/", "/index.html"], (_req: Request, res: Response) => {
  if (!fs.existsSync(DASHBOARD_FILE)) {
    res.status(404).send("Dashboard HTML file not found");
    return;
  }
  const rawHtml = fs.readFileSync(DASHBOARD_FILE, "utf-8");
  const paper = loadJson(getPaperStateFile());
  const live = loadJson(LIVE_STATE_FILE);
  if (!live._onchain_usd && live.equity_usd) {
    live._onchain_usd = live.equity_usd;
  }
  const ssrHtml = injectSsr(rawHtml, paper, live);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(ssrHtml);
});

// Serve static assets if requested
app.use(express.static(process.cwd()));

// Catch-all route for SPA/dashboard navigation
app.get("*", (_req: Request, res: Response) => {
  if (!fs.existsSync(DASHBOARD_FILE)) {
    res.status(404).send("Dashboard HTML file not found");
    return;
  }
  const rawHtml = fs.readFileSync(DASHBOARD_FILE, "utf-8");
  const paper = loadJson(getPaperStateFile());
  const live = loadJson(LIVE_STATE_FILE);
  if (!live._onchain_usd && live.equity_usd) {
    live._onchain_usd = live.equity_usd;
  }
  const ssrHtml = injectSsr(rawHtml, paper, live);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(ssrHtml);
});

app.listen(PORT, HOST, () => {
  console.log(`Losing on Hood dashboard listening on http://${HOST}:${PORT}`);
});
