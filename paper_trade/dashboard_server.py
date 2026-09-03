#!/usr/bin/env python3
"""dashboard_server.py — serves dashboard.html with SSR + /api/state + /api/live."""
import http.server, json, os, re

PORT = 8321
DASHBOARD = "/root/rh_live/paper_trade/dashboard.html"
PAPER_STATE = "/root/rh_live/paper_trade/paper_state.json"
LIVE_STATE = "/root/rh_live/state.json"

def load_json(path):
    try:
        return json.load(open(path))
    except:
        return {}

def esc(s):
    return str(s).replace('&','&amp;').replace('<','&lt;').replace('>','&gt;').replace('"','&quot;')

def _safe_ts(v):
    """Parse ts that might be float epoch, milli-epoch, ISO string, or 0/None."""
    import datetime
    if isinstance(v, str):
        try:
            return datetime.datetime.fromisoformat(v)
        except:
            return datetime.datetime.now()
    try:
        ts_f = float(v) if v else 0
    except (TypeError, ValueError):
        return datetime.datetime.now()
    if ts_f <= 0:
        return datetime.datetime.now()
    if ts_f > 1e12:
        ts_f /= 1000
    try:
        return datetime.datetime.fromtimestamp(ts_f)
    except:
        return datetime.datetime.now()

# ---------------------------------------------------------------------------
# Discussion SSR – matches dashboard.html JS discH() output exactly
# ---------------------------------------------------------------------------
TMPL = {"", "-", "ok", "passed global risk gate", "no narrative match"}

def is_tmpl(r):
    return str(r or "").strip().lower() in TMPL

def build_disc_ssr(log):
    if not log:
        return ''
    # group by token, preserve insertion order
    groups = {}
    order = []
    for a in log:
        t = a.get("token", "?")
        if t not in groups:
            groups[t] = []
            order.append(t)
        groups[t].append(a)

    nc = {"scanner": "sc", "narrative": "na", "risk": "ri", "sniper": "sn", "judge": "ju"}
    h = ''
    for tk in order:
        items = groups[tk]
        sc = sum(i.get("score", 0) for i in items)
        ok = all(i.get("verdict") == "approve" for i in items)
        # js onclick: this.classList.toggle('open')
        # 5-agent pipeline: sniper/risk/judge — a short-circuited meeting has fewer entries
        agents_ran = len(set(i.get("agent", "?") for i in items))
        short = agents_ran < 5

        h += '<div class="dcard" onclick="this.classList.toggle(\'open\')">'
        h += '<div class="dcard-h">'
        h += f'<span class="dcard-sym">{esc(tk)}</span>'
        if short:
            # short-circuited meeting: label how many of the 5 agents actually ran
            h += f'<span class="pill partial">提早否決 {agents_ran}/5</span>'
        h += f'<span class="pill {"ok" if ok else "no"}">{"通過" if ok else "否決"}</span>'
        h += f'<span class="dcard-sc" style="color:{"var(--green)" if ok else "var(--red)"}">{sc}</span>'
        dt = _safe_ts(items[-1].get("ts"))
        h += f'<span class="dcard-ts">{dt.strftime("%H:%M")}</span>'
        h += '<span class="dcard-arr">▸</span></div>'
        h += '<div class="dcard-b">'
        for m in items:
            agent = m.get("agent", "?")
            verdict = m.get("verdict", "?")
            score = m.get("score", 0)
            reason = esc(zh(m.get("reason", "")))
            tmpl = is_tmpl(m.get("reason", ""))
            nc_cls = nc.get(agent, "")
            h += f'<div class="aline"><span class="a-nm {nc_cls}">{esc(agent)}</span>'
            h += f'<span class="a-sc">{score}</span>'
            h += f'<span class="a-bd {"ok" if verdict == "approve" else "no"}">{"OK" if verdict == "approve" else "NO"}</span>'
            h += f'<span class="a-rs{" tmpl" if tmpl else ""}">{reason}</span></div>'
        h += '</div></div>'
    return h

# ---------------------------------------------------------------------------
# Trades SSR – matches dashboard.html JS tradesH() output exactly
# ---------------------------------------------------------------------------
def _kv(k, v):
    return f'<div class="kv"><span class="k">{k}</span><span class="v">{v}</span></div>'

TMPL_SET = {"ok", "-", "", "passed global risk gate", "no narrative match"}

import re as _re

_ZH_RULES = [
    (r'^dev sold \(paper override\)', '開發者已賣出（模擬倉放行）'),
    (r'^dev sold', '開發者已賣出'),
    (r'^honeypot', '蜜罐幣'),
    (r'^bundled', '捆綁買入偵測'),
    (r'^liq<\$?([0-9.]+)', r'流動性低於 $\1'),
    (r'^mc band', '市值超出區間'),
    (r'^holders<([0-9.]+)', r'持有者少於 \1 人'),
    (r'^top10 concentrated', '前十大持倉過度集中'),
    (r"^narrative L(\d+): (.*)$", r'命中 L\1 主題：「\2」'),
    (r"^no narrative match: symbol/name='(.*)' ", r"無主題命中：symbol/name='\1' "),
    (r'^no narrative match$', '無主題命中'),
    (r'^insufficient gas for trade \(\$(.*)\)$', r'交易資金不足（可用 $\1）'),
    (r'^risk gate passed: (.*)$', r'風控通過：\1'),
    (r'^passed global risk gate$', '風控閘門通過'),
    (r'^ok: ', '通過：'),
    (r'^ok$', '通過（無異常）'),
    (r'^bad momentum 5m (.*%) red=(\d+)$', r'5 分鐘動能轉差 \1（紅 K \2 根）'),
    (r'^strong pump (.*)$', r'強勢拉升 \1'),
    (r'^up (.*)$', r'上行走勢 \1'),
    (r'^flat (.*)$', r'橫盤整理 \1'),
    (r'^weak (.*)$', r'動能偏弱 \1'),
    (r'^insufficient kline$', 'K 線資料不足'),
    (r'^seen recently$', '48 小時內已拒絕過'),
    (r'^seen before$', '曾看過此代幣'),
    (r'^lost on this before \((.*)\)$', r'此代幣上次交易虧損（\1）'),
    (r'^symbol (.*) lost (\d+)x$', r'同名代幣 \1 已虧損 \2 次'),
    (r'^fast dump (.*%) \(peak \+(.*)%\)$', r'急殺 \1（峰值 +\2%）'),
    (r'^flow collapse s1=(\d+)/b1=(\d+) s5=(\d+)/b5=(\d+) (.*)$', r'買盤崩落：1m 賣\1/買\2、5m 賣\3/買\4，變化 \5'),
    (r'^downtrend (.*%) (\d+)min$', r'下行趨勢 \1，已持倉 \2 分鐘'),
    (r'^giveback \(peak \+(.*)%, now (.*)%\)$', r'獲利回吐（峰值 +\1%，現 \2%）'),
    (r'^stale 12h (.*)$', r'閒置逾 12 小時 \1'),
    (r'^no momentum 45min \((.*)\)$', r'45 分鐘無動能（\1）'),
    (r'^disaster (.*)$', r'崩盤 \1'),
    (r'^condition order filled$', '條件單成交'),
    (r'^swap timeout$', 'swap 逾時'),
]
_ZH_COMPILED = [( _re.compile(p), t) for p, t in _ZH_RULES]

def zh(r):
    """英文 reason → 繁中顯示層翻譯（不動 state 原文），與前端 zh() 同步。"""
    if r is None:
        return ''
    s = str(r)
    for pat, rep in _ZH_COMPILED:
        if pat.search(s):
            return pat.sub(rep, s, count=1)
    s = _re.sub(r'\bsmart_wallets=', '聰明錢包數 ', s)
    s = _re.sub(r'\bsmart_buy_30m=', '30 分鐘聰明錢買入 ', s)
    s = _re.sub(r'\bliq=\$', '流動性 $', s)
    s = _re.sub(r'\bmc=\$', '市值 $', s)
    s = _re.sub(r'\bequity=\$', '權益 $', s)
    s = _re.sub(r'\bcash=\$', '現金 $', s)
    s = _re.sub(r'\bopen=(\d+)/(\d+)', r'持倉 \1/\2', s)
    s = _re.sub(r'\bholders=', '持有者 ', s)
    s = _re.sub(r'\bscore=', '評分 ', s)
    return s


def _snap_matrix(c):
    """Render snap-matrix for meeting data, matching JS snapMatrix()."""
    nc = {"scanner": "sc", "narrative": "na", "risk": "ri", "sniper": "sn", "judge": "ju"}
    mtg = c.get("meeting") or []
    if not mtg:
        return ""
    h = '<div class="snap-matrix"><div class="snap-t">決策快照</div>'
    for m in mtg:
        agent = m.get("agent", "?")
        verdict = m.get("verdict", "?")
        score = m.get("score")
        reason = esc(zh(str(m.get("reason", ""))))
        tmpl = is_tmpl(str(m.get("reason", "")))
        nc_cls = nc.get(agent, "")
        sc_txt = str(score) if score is not None else "-"
        bd_cls = "ok" if verdict == "approve" else "no"
        bd_txt = "OK" if verdict == "approve" else "NO"
        rs_cls = " tmpl" if tmpl else ""
        h += f'<div class="aline"><span class="a-nm {nc_cls}">{esc(agent)}</span>'
        h += f'<span class="a-sc">{sc_txt}</span>'
        h += f'<span class="a-bd {bd_cls}">{bd_txt}</span>'
        h += f'<span class="a-rs{rs_cls}">{reason}</span></div>'
    h += '</div>'
    return h

def _meeting_warn(c):
    """Render meetingWarn, matching JS meetingWarn()."""
    mtg = c.get("meeting") or []
    if not mtg:
        return '<div class="warn">歷史無留痕快照 · 策略早期紀錄</div>'
    bad = sum(1 for m in mtg if is_tmpl(str(m.get("reason", ""))))
    if bad == len(mtg):
        return '<div class="warn">快照理由均為預設模板</div>'
    if bad:
        return f'<div class="warn">{bad} 項理由為模板</div>'
    return ""

def build_trades_ssr(closed):
    if not closed:
        return '<div style="color:var(--muted);padding:20px;text-align:center;font-size:12px">尚無交易紀錄</div>'
    import math
    h = ''
    for c in reversed(closed):
        pnl = float(c.get("pnl_usd") or 0)
        pct = float(c.get("pnl_pct") or 0)
        dt = _safe_ts(c.get("time"))
        ts_s = f"{dt.month}/{dt.day} {dt.hour:02d}:{dt.minute:02d}"
        reason = zh(c.get("exit_reason") or c.get("reason") or c.get("method") or "-")
        reason_short = esc(reason[:32])
        is_tmpl = reason.strip().lower() in TMPL_SET
        reason_cls = ' class="reason-tmpl"' if is_tmpl else ''
        sym = esc(c.get("symbol", "?"))
        uid = f'd{math.floor(int.from_bytes(os.urandom(4),"big")%2**26):06x}'
        gc_cls = "g" if pnl >= 0 else "r"

        peak_val = float(c.get("peak") or 0)
        peak_html = ""
        if peak_val > 0:
            peak_html = f'<span class="peak-tag">PEAK +{peak_val:.1f}%</span>'

        # summary row
        h += f'<div class="trow" onclick="var d=document.getElementById(\'{uid}\');this.classList.toggle(\'open\');d.style.display=d.style.display===\'block\'?\'none\':\'block\'">'
        h += f'<div><div class="trow-s">{sym}</div><div class="trow-sub">{ts_s} · {reason_short}</div>'
        h += f'<span class="peak-tag">PEAK +{peak_val:.1f}%</span>' if peak_val > 0 else ''
        h += '</div>'
        h += f'<span class="trow-pct {gc_cls}">{"+" if pct >= 0 else ""}{pct:.1f}%</span>'
        h += f'<span class="trow-pnl {gc_cls}">{"+" if pnl >= 0 else ""}{pnl:.2f}</span>'
        h += '</div>'

        # detail row
        h += f'<div class="trow-d" id="{uid}">'
        alloc = float(c.get("alloc_usd") or 5)
        h += _kv("倉位", f"${alloc:.2f}")
        if c.get("entry_price"):
            ep = float(c["entry_price"])
            h += _kv("進場", f"{ep:.4g}" if ep > 10 else f"{ep:.6f}")
        if c.get("entry_eth"):
            h += _kv("進場", f"{float(c['entry_eth']):.5f} ETH")
        if c.get("exit_price"):
            xp = float(c["exit_price"])
            h += _kv("出場", f"{xp:.4g}" if xp > 10 else f"{xp:.6f}")
        if c.get("exit_eth"):
            h += _kv("出場", f"{float(c['exit_eth']):.5f} ETH")
        slip = float(c.get("slippage_pct") or c.get("slip_pct") or 0)
        h += _kv("滑價", f"{slip:.2f}%")
        h += _kv("燃料費", f"${float(c.get('gas_usd') or 0):.3f}")
        h += _kv("方式", esc(c.get("method") or "-"))
        h += _kv("理由", esc(reason[:64]))

        if c.get("held_min"):
            h += _kv("持倉時間", f"{c['held_min']} 分鐘")
        
        mtg = c.get("meeting") or []
        if not mtg:
            h += '<div class="warn">歷史無留痕快照 · 策略早期紀錄</div>'
        else:
            bad = sum(1 for m in mtg if str(m.get("reason", "")).strip().lower() in TMPL_SET)
            if bad:
                h += f'<div class="warn">{bad} 項理由為模板</div>'
        h += '</div>'
    return h

def build_trades_ssr_live(closed):
    return build_trades_ssr(closed)

def inject_ssr(html, paper, live):
    """直接把 API 資料寫進 HTML 的 value div 裡，JS 載入前就有數字。"""
    cash = paper.get("cash_usd", 0)
    closed = paper.get("closed", [])
    real = sum(c.get("pnl_usd", 0) for c in closed)
    wins = sum(1 for c in closed if c.get("pnl_usd", 0) > 0)
    wr = round(wins / len(closed) * 100) if closed else 0
    n_open = len(paper.get("positions", {}))
    gas = sum(c.get("gas_usd", 0) for c in closed)
    op = 0
    for p in paper.get("positions", {}).values():
        e = p.get("entry_price", 0); l = p.get("last_price", 0)
        op += (p.get("alloc_usd", 5)) * ((l/e-1) if e > 0 else 0)
    fmt = lambda v: f"+{v:.2f}" if v >= 0 else f"{v:.2f}"
    fmt_pct = lambda v: f"{wr}%"

    # paper KPI
    def kpi_cells(arr):
        return ''.join(f'<div class="kpi"><div class="l">{k}</div><div class="v {c if c else ""}">{v}</div></div>' for k, v, c in arr)
    p_cls = lambda v: 'g' if v >= 0 else 'r'
    pkpi_html = kpi_cells([
        ("現金", f"${cash:.2f}", ""),
        ("已實現", fmt(real), p_cls(real)),
        ("勝率", f"{wr}%", ""),
        ("燃料費", f"${gas:.2f}", ""),
        ("持倉中", str(n_open), ""),
        ("已平倉", str(len(closed)), ""),
    ])
    html = re.sub(r'<div[^>]*id="pkpi"[^>]*>(.*?)</div>', '<div id="pkpi">' + pkpi_html + '</div>', html, count=1)

    leq = live.get("_onchain_usd") or live.get("equity_usd", 0)
    lbk = live.get("equity_usd", 0)
    lc = live.get("closed", [])
    lreal = sum(float(c.get("pnl_usd", 0) or 0) for c in lc)
    lgas = sum(float(c.get("gas_usd", 0) or 0) for c in lc)
    lkpi_html = kpi_cells([
        ("鏈上餘額", f"${leq:.2f}", ""),
        ("帳面價值", f"${lbk:.2f}", ""),
        ("已實現", fmt(lreal), p_cls(lreal)),
        ("燃料費", f"${lgas:.2f}", ""),
        ("已平倉", str(len(lc)), ""),
        ("持倉中", str(len(live.get("positions", {}))), ""),
    ])
    html = re.sub(r'<div[^>]*id="lkpi"[^>]*>(.*?)</div>', '<div id="lkpi">' + lkpi_html + '</div>', html, count=1)

    # 注入 SSR script：在 main poll 之前跑，確保首次 render 就有資料
    ssr_data = json.dumps({"paper": paper, "live": live}, default=str)
    ssr_script = f"""
<script>window.__SSR={ssr_data};</script>"""
    html = html.replace('<script>', ssr_script + '\n<script>', 1)

    # Agent Discussion SSR
    disc_html = build_disc_ssr(paper.get("agent_log", []))
    html = re.sub(r'<div[^>]*id="pdisc"[^>]*>(.*?)</div>', '<div id="pdisc">' + disc_html + '</div>', html, count=1)

    # Paper trades SSR
    pt_html = build_trades_ssr(paper.get("closed", []))
    html = re.sub(r'<div[^>]*id="ptrades"[^>]*>(.*?)</div>', '<div id="ptrades">' + pt_html + '</div>', html, count=1)

    # Live trades SSR
    lt_html = build_trades_ssr_live(live.get("closed", []))
    html = re.sub(r'<div[^>]*id="ltrades"[^>]*>(.*?)</div>', '<div id="ltrades">' + lt_html + '</div>', html, count=1)

    return html

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        if self.path == "/api/state":
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            s = load_json(PAPER_STATE)
            self.wfile.write(json.dumps(s, default=str).encode())
        elif self.path == "/api/live":
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            s = load_json(LIVE_STATE)
            try:
                import sys
                sys.path.insert(0, "/root/rh_live")
                from grok_bot import gm, NATIVE, WALLET, CHAIN, eth_price
                d = gm("portfolio","token-balance","--chain",CHAIN,"--wallet",WALLET,"--token",NATIVE)
                eth = float(d["balances"][0]["balance"])
                s["_onchain_eth"] = eth
                s["_onchain_usd"] = round(eth * eth_price(), 2)
            except:
                s["_onchain_usd"] = s.get("equity_usd", 0)
            self.wfile.write(json.dumps(s, default=str).encode())
        elif self.path == "/" or self.path == "/index.html":
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            html = open(DASHBOARD, "rb").read().decode()
            paper = load_json(PAPER_STATE)
            live = load_json(LIVE_STATE)
            live["_onchain_usd"] = live.get("equity_usd", 0)
            try:
                import sys
                sys.path.insert(0, "/root/rh_live")
                from grok_bot import gm, NATIVE, WALLET, CHAIN, eth_price
                d = gm("portfolio","token-balance","--chain",CHAIN,"--wallet",WALLET,"--token",NATIVE)
                eth = float(d["balances"][0]["balance"])
                live["_onchain_usd"] = round(eth * eth_price(), 2)
            except:
                pass
            html = inject_ssr(html, paper, live)
            self.wfile.write(html.encode())
        else:
            self.send_response(404)
            self.end_headers()
    def log_message(self, format, *args):
        pass

server = http.server.HTTPServer(("0.0.0.0", PORT), Handler)
print(f"dashboard on http://0.0.0.0:{PORT}")
server.serve_forever()
