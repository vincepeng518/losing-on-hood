#!/usr/bin/env python3
"""grok_bot.py — Multi-Agent Robinhood Chain Meme Trader (5 agents + Referee).

Architecture:
  Scanner -> Narrative -> Risk -> Sniper -> Judge
  Only 1 position open at a time. All agents vote, Risk has veto.
  Adaptive review loop adjusts thresholds based on closed trades.

Usage:
  python3 grok_bot.py              # live tick
  python3 grok_bot.py --dry-run    # score only, no swap
  python3 grok_bot.py --review     # adaptive review + threshold update
  python3 grok_bot.py --monitor    # exit-only monitor (like rh_live)
  python3 grok_bot.py --scan-only  # scan + score, no action
"""
import json, csv, os, time, subprocess, sys, fcntl, hashlib
from datetime import datetime, timezone
from typing import Optional

# ================= SHARED CONSTANTS =================
STATE = "/root/rh_live/state.json"
LOG = "/root/rh_live/trades.csv"
LOCK = "/root/rh_live/bot.lock"
REVIEW_FILE = "/root/rh_live/review_history.json"
CHAIN = "robinhood"
WALLET = "0x4d4e93fc85133b372ea6d360e0ba57293f6ea801"
NATIVE = "0x0000000000000000000000000000000000000000"
START_EQUITY = 5.07
PER_TRADE = 5.0
MAX_OPEN = 4
MIN_GAS_ETH = 0.002
GAS_PRICE = "0.3"
SEEN_TTL = 48 * 3600
ETH_DECIMALS = 10**18
HOUR_BETWEEN_BUYS = 1
MAX_SCAN = 10  # 最多評幾幣（原30，降速）

# ================= SCORING THRESHOLDS (adaptive) =================
THRESHOLDS = {
    "min_total_score": 10,  # 原14→10（策略審查建議）
    "min_scanner": 2,       # 原4→2（降門檻，用smart_buy≥2過濾）
    "min_narrative": 0,     # 原1→0（改為加成，不作獨立否決）
    "min_sniper": 2,        # 原3→2
    "min_judge": 2,
    "liq_min": 15000,
    "mc_min": 30000,
    "mc_max": 3_000_000,
    "holders_min": 100,
    "top10_max": 0.35,
    "bundler_max": 0.3,
    "smart_buy_min": 2,     # Scanner門檻：≥2才給分，≥2才通過
}

# ================= BOT LOCK =================
class BotLock:
    def __enter__(self):
        self.f = open(LOCK, "w")
        try:
            fcntl.flock(self.f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("another tick running, skip"); sys.exit(0)
        return self
    def __exit__(self, *a):
        fcntl.flock(self.f, fcntl.LOCK_UN); self.f.close()

# ================= GMGN CLI WRAPPER =================
def gm(*args, timeout=90):
    r = subprocess.run(["gmgn-cli", *args, "--raw"],
                       capture_output=True, text=True, timeout=timeout)
    out = (r.stdout or "").strip()
    if "[gmgn-cli] error" in out or r.returncode != 0:
        raise RuntimeError(f"gmgn {args[0]}: {out[:200]}")
    return json.loads(out)

# ================= ETH PRICE (cached) =================
_EP_CACHE = None
def eth_price():
    global _EP_CACHE
    try:
        import urllib.request
        r = urllib.request.Request(
            "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
            headers={"User-Agent": "Mozilla/5.0"})
        _EP_CACHE = json.load(urllib.request.urlopen(r, timeout=10))["ethereum"]["usd"]
        return _EP_CACHE
    except Exception:
        return _EP_CACHE or 2400.0
_EP_CACHE = eth_price()

# ================= TOKEN HELPERS =================
def token_info(addr):
    try: return gm("token", "info", "--chain", CHAIN, "--address", addr)
    except Exception: return None

# token_info cache (TTL 300s)
_TI_CACHE = {}
def token_info_cached(addr):
    hit = _TI_CACHE.get(addr)
    if hit and time.time() - hit[0] < 300:
        return hit[1]
    info = token_info(addr)
    _TI_CACHE[addr] = (time.time(), info)
    return info

def token_balance_raw(addr):
    try:
        d = gm("portfolio", "token-balance", "--chain", CHAIN, "--wallet", WALLET, "--token", addr)
        return int(float(d["balances"][0]["balance"]))
    except Exception:
        return None

# ================= KLINE (shared cache) =================
_KLINE_CACHE = {}
def klines_res(addr, resolution="1m"):
    key = (addr, resolution)
    hit = _KLINE_CACHE.get(key)
    if hit and time.time() - hit[0] < 90:  # TTL 90s（原25s）
        return hit[1]
    try:
        d = gm("market", "kline", "--chain", CHAIN, "--address", addr, "--resolution", resolution)
        ks = d.get("list") or []
        _KLINE_CACHE[key] = (time.time(), ks)
        return ks
    except Exception:
        return (hit[1] if hit else [])

def kline_chg(p, addr):
    entry_ts = int(p["opened_ts"])
    held = time.time() - entry_ts
    res = "1m" if held < 7200 else ("15m" if held < 86400 else "1h")
    ks = klines_res(addr, res)
    if not ks: return 0.0, 0.0
    entry_px = p.get("entry_kline_px")
    if not entry_px:
        before = [k for k in ks if k["time"]//1000 <= entry_ts]
        if not before: return 0.0, 0.0
        entry_px = float(before[-1]["close"])
        p["entry_kline_px"] = entry_px
    after = [k for k in ks if k["time"]//1000 >= entry_ts - 60]
    now_px = float(after[-1]["close"])
    peak_px = max(float(k["high"]) for k in after)
    chg = (now_px - entry_px) / entry_px
    peak = (peak_px - entry_px) / entry_px
    return chg, max(0.0, peak)

# ================= ACTIVITY HELPERS =================
def fetch_activity():
    try:
        d = gm("portfolio", "activity", "--chain", CHAIN, "--wallet", WALLET)
        return d.get("activities") or []
    except Exception:
        return []

def fetch_activities_map(acts):
    m = {}
    for a in acts:
        addr = (a.get("token") or {}).get("address", "")
        if not addr: continue
        m.setdefault(addr, {"buy": None, "sells": []})
        if a.get("event_type") == "buy" and m[addr]["buy"] is None:
            m[addr]["buy"] = a
        elif a.get("event_type") == "sell":
            m[addr]["sells"].append(a)
    return m

def latest_buy(addr):
    try:
        act = gm("portfolio", "activity", "--chain", CHAIN, "--wallet", WALLET)
        for a in (act.get("activities") or []):
            if a.get("event_type") == "buy" and (a.get("token") or {}).get("address") == addr:
                return a
    except Exception: pass
    return None

def latest_sell(addr, since_ts):
    try:
        act = gm("portfolio", "activity", "--chain", CHAIN, "--wallet", WALLET)
        for a in (act.get("activities") or []):
            if (a.get("event_type") == "sell"
                and (a.get("token") or {}).get("address") == addr
                and a.get("timestamp", 0) >= since_ts):
                return a
    except Exception: pass
    return None

def strategy_open_ids_all():
    ids = {}
    try:
        d = gm("order", "strategy", "list", "--chain", CHAIN, "--group-tag", "STMix")
        for o in (d.get("list") or []):
            if o.get("status") == "open":
                ids[(o.get("base_token") or "")] = o.get("order_id")
    except Exception: pass
    return ids

def gas_eth():
    try:
        d = gm("portfolio", "token-balance", "--chain", CHAIN, "--wallet", WALLET, "--token", NATIVE)
        return float(d["balances"][0]["balance"])
    except Exception:
        return 0.0

def fetch_trending():
    d = gm("market", "trending", "--chain", CHAIN, "--interval", "5m")
    if d.get("code") != 0: raise RuntimeError(f"trending code={d.get('code')}")
    return d["data"]["rank"]

# ================= STATE =================
def load():
    if os.path.exists(STATE):
        s = json.load(open(STATE))
        s.setdefault("settled_txs", [])
        s.setdefault("pending_close", [])
        s.setdefault("thresholds", dict(THRESHOLDS))
        return s
    return {"equity_usd": START_EQUITY, "positions": {}, "closed": [], "seen": {},
            "settled_txs": [], "pending_close": [], "pending_entry": [],
            "live": True, "thresholds": dict(THRESHOLDS)}

def save(s):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE + ".tmp", "w") as f:
        json.dump(s, f, indent=1)
        f.flush(); os.fsync(f.fileno())
    os.replace(STATE + ".tmp", STATE)
    with open(LOG, "a", newline="") as f:
        w = csv.writer(f)
        for c in s["closed"]:
            if not c.get("logged"):
                w.writerow([c["time"], c["symbol"], c["address"],
                    c.get("tx_in","")[:20], c.get("tx_out","")[:26],
                    f"{c.get('entry_eth') or 0:.4g}", f"{c.get('pnl_pct',0):.1f}%",
                    f"{c.get('pnl_usd','')}", c.get("method",""), c["reason"]])
                c["logged"] = True

def prune_seen(s):
    now = time.time()
    s["seen"] = {k: v for k, v in s["seen"].items()
                 if v == 1 or (isinstance(v, (int, float)) and now - v < SEEN_TTL)}

# ================= AGENT 1: SCANNER =================
class Scanner:
    """Fetch trending tokens, apply hard filters, score remaining."""
    
    @staticmethod
    def fetch_smb_map(window=1800):
        """smartmoney 一次拉（原來每幣拉一次，30幣=30次純浪費）"""
        try:
            d = gm("track", "smartmoney", "--chain", CHAIN, "--limit", "100", "--side", "buy")
        except Exception:
            return {}
        m = {}
        now = time.time()
        for x in (d.get("list") or []):
            if now - (x.get("timestamp") or 0) > window:
                continue
            a = (x.get("base_address") or "").lower()
            if a:
                m[a] = m.get(a, 0) + 1
        return m
    
    @staticmethod
    def scan(seen, th=None):
        th = th or THRESHOLDS
        try:
            toks = fetch_trending()[:30]
        except Exception as e:
            print(f"  [Scanner] trending fail: {e}")
            return []
        smb_map = Scanner.fetch_smb_map()  # 一次拉
        results = []
        for t in toks:
            addr = t.get("address", "")
            if not addr or addr in seen:
                continue
            score, reason, snap = Scanner._score(t, toks, th, smb_map)
            if score > 0:
                results.append({"token": t, "score": score, "snap": snap, "rej": None})
            else:
                results.append({"token": t, "score": 0, "snap": snap, "rej": reason})
        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:MAX_SCAN]
    
    @staticmethod
    def _score(t, toks, th, smb_map):
        liq = t.get("liquidity") or 0
        mc = t.get("market_cap") or 0
        holders = t.get("holder_count") or 0
        top10 = t.get("top_10_holder_rate")
        addr = (t.get("address") or "").lower()
        if t.get("is_honeypot"): return 0, "honeypot", {}
        if t.get("creator_close"): return 0, "dev sold", {}
        if (t.get("bundler_rate") or 0) > th["bundler_max"]: return 0, "bundled", {}
        if liq < th["liq_min"]: return 0, f"liq<{th['liq_min']}", {}
        if mc < th["mc_min"] or mc > th["mc_max"]: return 0, "mc band", {}
        if holders < th["holders_min"]: return 0, f"holders<{th['holders_min']}", {}
        if top10 is not None and top10 > th["top10_max"]: return 0, "top10 concentrated", {}
        
        score = 0
        tags = (t.get("wallet_tags_stat") or {})
        smart = tags.get("smart_wallets") or t.get("smart_degen_count") or 0
        if smart >= 50: score += 3
        elif smart >= 25: score += 2
        elif smart >= 10: score += 1
        
        smb_count = smb_map.get(addr, 0)
        if smb_count >= th["smart_buy_min"]: score += 3
        elif smb_count >= 1: score += 1
        
        if (t.get("rug_ratio") or 0) < 0.1: score += 1
        if (t.get("bot_degen_rate") or 0) < 0.4: score += 1
        snap = {"holders": holders, "mc": mc, "liq": liq, "smart": smart, "smb": smb_count}
        return max(score, 0), None, snap


# ================= AGENT 2: NARRATIVE =================
class Narrative:
    """Score narrative/thematic fit — Robinhood-themed, AI-themed, cultural meme."""
    
    KEYWORDS = {
        3: ["robinhood", "hood", "hoodai", "gme", "amc", "diamond", "ape", "stonk"],
        2: ["ai", "grok", "gpt", "neural", "bot", "agent", "deepseek"],
        1: ["doge", "pepe", "frog", "cat", "moon", "rocket", "inu", "shib"],
    }
    
    @staticmethod
    def score(token):
        name = (token.get("symbol") or "").lower()
        desc = (token.get("name") or "").lower()
        combined = name + " " + desc
        for level in [3, 2, 1]:
            for kw in Narrative.KEYWORDS[level]:
                if kw in combined:
                    return level, f"narrative L{level}: {kw}"
        return 0, "no narrative match"

# ================= AGENT 3: RISK =================
class Risk:
    """Veto gate — returns (pass, reason). Risk pass=False = veto = trade cancelled."""
    
    @staticmethod
    def check(s, th=None):
        th = th or THRESHOLDS
        gas = gas_eth()
        if gas < MIN_GAS_ETH:
            return False, f"gas too low {gas:.5f}"
        
        available = gas - MIN_GAS_ETH
        ep = eth_price()
        if available * ep * 0.9 < 2.5:
            return False, f"insufficient gas for trade (${available*ep*0.9:.1f})"
        
        if len(s["positions"]) >= MAX_OPEN:
            return False, f"max open {MAX_OPEN}"
        
        open_ts = [p.get("opened_ts") or 0 for p in s["positions"].values()]
        last_ts = max(open_ts) if open_ts else (s["closed"][-1].get("_buy_ts", 0) if s["closed"] else 0)
        if last_ts > time.time() - HOUR_BETWEEN_BUYS * 3600:
            return False, "too soon since last buy"
        
        today_pnl = 0
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        for c in s.get("closed", []):
            if c.get("time", "").startswith(today):
                today_pnl += c.get("pnl_usd", 0)
        if today_pnl < -15:
            return False, f"daily loss limit ${today_pnl:.1f}"
        
        return True, "ok"


# ================= REASON ENRICHMENT (mirror paper_bot.py) =================
def rich_scanner_reason(c, th):
    """scanner reason: 引用 smart wallet / smb / 流動性等具體快照值"""
    if c.get("rej"):
        return c["rej"]
    snap = c.get("snap") or {}
    parts = [f"score={c['score']}"]
    smart = snap.get("smart", 0)
    smb = snap.get("smb", 0)
    liq = snap.get("liq", 0)
    mc = snap.get("mc", 0)
    holders = snap.get("holders", 0)
    if smart:
        parts.append(f"smart_wallets={smart}")
    if smb:
        parts.append(f"smart_buy_30m={smb}")
    if liq:
        parts.append(f"liq=${liq/1000:.0f}k")
    if mc:
        parts.append(f"mc=${mc/1e6:.2f}M" if mc >= 1e6 else f"mc=${mc/1000:.0f}k")
    if holders:
        parts.append(f"holders={holders}")
    return " ".join(parts)

def rich_narrative_reason(t, score, reason):
    """narrative reason: 命中時說明等級與關鍵字；不命中時列出檢查過的名稱"""
    sym = (t.get("symbol") or "?")
    if score > 0:
        return f"{reason} (symbol='{sym}' 命中 L{score} 主題關鍵字)"
    kw_all = [k for kws in Narrative.KEYWORDS.values() for k in kws]
    return (f"no narrative match: symbol/name='{sym}' "
            f"不含任何主題關鍵字({len(kw_all)}個: {', '.join(kw_all[:8])}...)")

def rich_judge_reason(t, s, score, reason):
    """judge reason: approve 時引用歷史紀錄（無虧損/無重複），veto 時保留原細節"""
    if score > 0:
        addr = (t.get("address") or "").lower()
        sym = (t.get("symbol") or "").lower()
        n_closed = len(s.get("closed", []))
        n_loss_addr = sum(1 for c in s.get("closed", [])
                          if (c.get("address") or "").lower() == addr and (c.get("pnl_usd") or 0) < 0)
        n_loss_sym = sum(1 for c in s.get("closed", [])
                         if (c.get("symbol") or "").lower() == sym and (c.get("pnl_usd") or 0) < 0)
        first_seen = "new token (未交易過)" if not s.get("seen", {}).get(addr) else "seen before"
        return (f"{reason}: {first_seen}, 歷史 {n_closed} 筆平倉中 "
                f"此地址虧損 {n_loss_addr} 次、同名校虧損 {n_loss_sym} 次 → 通過")
    return reason

def rich_risk_reason(s, alloc_hint):
    """risk reason: 引用現金、持倉數、冷卻時間等具體數字"""
    open_n = len(s["positions"])
    open_ts = [p.get("opened_ts") or 0 for p in s["positions"].values()]
    last_ts = max(open_ts) if open_ts else (s["closed"][-1].get("_buy_ts", 0) if s["closed"] else 0)
    since_min = (time.time() - last_ts) / 60 if last_ts else -1
    return (f"risk gate passed: equity=${s['equity_usd']:.2f}, open={open_n}/{MAX_OPEN}, "
            f"距上次交易 {since_min:.0f} 分鐘 (需>{HOUR_BETWEEN_BUYS*60}), 下筆預估 alloc≈${alloc_hint:.2f}")


# ================= AGENT 4: SNIPER =================
class Sniper:
    """Pre-trade kline momentum check + execute entry."""
    
    @staticmethod
    def pre_check(token):
        addr = token.get("address", "")
        ks = klines_res(addr, "1m")
        if not ks or len(ks) < 5:
            return 0, "insufficient kline"
        closes = [float(b["close"]) for b in ks[-5:]]
        drop5 = closes[-1] / closes[0] - 1
        red = sum(1 for i in range(1, len(closes)) if closes[i] < closes[i-1])
        if drop5 < -0.06 or red >= 4:
            return 0, f"bad momentum 5m {drop5*100:+.1f}% red={red}"
        # 2026-09-03 復盤修正：14 筆實證「strong pump 5m>10%」追進 11 筆全虧（-3~-43%），
        # 進場即接最後一棒。唯一獲利 GBC(+2.1%) 是 5m 溫和 +9.2%。
        # 改為反向評分：暴漲=風險訊號，溫和上升=最佳，配合量能衰竭檢查。
        if drop5 > 0.10:
            # 2026-09-03 反測：11 筆暴漲全虧（-3~-43%），量能遞增的也只有理論放行價值，
            # 實證上「追 5m>10% 暴漲」= 接最後一棒。直接否決，等回踩或換標的。
            return 0, f"pump exhaustion {drop5*100:+.1f}% (chasing 5m pump: 11/11 loss)"
        if drop5 > 0.02:
            return 5, f"steady up {drop5*100:+.1f}%"
        if drop5 > -0.02:
            return 3, f"flat {drop5*100:+.1f}%"
        return 2, f"weak {drop5*100:+.1f}%"
    
    @staticmethod
    def execute(token, alloc_usd, ep, sl_pct=40):
        """路1+路4: 裸 swap 進場（不帶 condition-orders，SL 由 tick 補掛）+ auto gas（去掉 --gas-price）"""
        addr = token.get("address", "")
        alloc_eth = alloc_usd / ep
        args = ["swap", "--chain", CHAIN, "--from", WALLET,
                "--input-token", NATIVE, "--output-token", addr,
                "--amount", str(int(alloc_eth * ETH_DECIMALS)),
                "--slippage", "8", "--yes"]  # 2026-09-03: 15→8 砍 MEV 夾子利潤空間（buy_cost 實測虛高 8.6%）
        t0 = time.time()
        r = subprocess.run(["gmgn-cli", *args, "--raw"],
                           capture_output=True, text=True, timeout=60)  # 180→60
        out = (r.stdout or "").strip()
        try:
            res = json.loads(out)
        except Exception:
            print(f"  [Sniper] parse fail: {out[:200]}")
            return False, None, None
        if res.get("status") != "submitted" or not res.get("order_id"):
            print(f"  [Sniper] fail: {out[:200]}")
            return False, None, None
        order_id = res["order_id"]
        # 階梯 poll：2/3/5/8/8/8/8/8/8 = 57s 上限（原 8×11=88s）
        poll_intervals = [2, 3, 5, 8, 8, 8, 8, 8, 8]
        for wait in poll_intervals:
            time.sleep(wait)
            try:
                d = gm("order", "get", "--chain", CHAIN, "--order-id", order_id, timeout=15)  # 30→15
                st = d.get("status")
                elapsed = time.time() - t0
                if st == "confirmed":
                    print(f"  [Sniper] confirmed in {elapsed:.1f}s order={order_id}")
                    return True, d.get("report") or {}, order_id
                if st in ("failed", "expired"):
                    print(f"  [Sniper] {st} in {elapsed:.1f}s order={order_id}")
                    return False, d, order_id
            except Exception as e:
                print(f"  [Sniper] poll err: {e}")
        print(f"  [Sniper] TIMEOUT {time.time()-t0:.1f}s order={order_id}")
        return False, {"timeout": True, "order_id": order_id}, order_id


# ================= AGENT 5: JUDGE =================
class Judge:
    """Exit logic — pre_check for cooldown/duplicate, judge_exit for positions."""
    
    @staticmethod
    def pre_check(token, s):
        addr = token.get("address", "")
        sym = (token.get("symbol") or "").lower()
        # Rejected within 48h
        if s["seen"].get(addr):
            return 0, "seen recently"
        # Lost on this token before
        for c in s.get("closed", []):
            if c.get("address") == addr and (c.get("pnl_usd") or 0) < 0:
                return 0, f"lost on this before ({c.get('symbol')})"
        # Same-name symbol lost
        losses_same_sym = sum(1 for c in s.get("closed", [])
                              if (c.get("symbol") or "").lower() == sym and (c.get("pnl_usd") or 0) < 0)
        if losses_same_sym >= 2:
            return 0, f"symbol {sym} lost {losses_same_sym}x"
        return 3, "ok"
    
    @staticmethod
    def judge_exit(p, info, addr):
        chg, peak = kline_chg(p, addr)
        if not chg:
            return False, "", p.get("peak_chg", 0), p.get("last_chg", 0)
        if info:
            pr = info.get("price") or {}
            b1 = pr.get("buys_1m") or 0; s1 = pr.get("sells_1m") or 0
            b5 = pr.get("buys_5m") or 0; s5 = pr.get("sells_5m") or 0
        else:
            b1 = s1 = b5 = s5 = 0
        held_min = (time.time() - p["opened_ts"]) / 60
        # fast dump（2026-09-03 修：peak≥30% 且當下未破保底時豁免——先讓 giveback 鎖利）
        # 22 筆 fast dump 平均 peak +73.5%，舊版直接砍在最低點，giveback 鎖利沒機會跑。
        # 逐 K 重測：豁免後 7 筆真救回（STRATTON -17.7%→+80% 等），9 筆同根K穿線救不了。
        ks_x = klines_res(addr, "1m")
        if len(ks_x) >= 4:
            cl_x = [float(b["close"]) for b in ks_x[-4:]]
            if cl_x[-1] < cl_x[0] * 0.93 and peak >= 0.10:
                floor_pct = peak * (0.7 if peak > 3.0 else (0.6 if peak > 1.0 else 0.5)) * 100
                now_pct = (cl_x[-1] / p["entry_price"] - 1) * 100 if p.get("entry_price") else -999
                if peak >= 0.30 and now_pct > floor_pct:
                    pass  # 在保底之上：不出，交給下方 giveback 鎖利
                else:
                    return True, f"fast dump {((cl_x[-1]/cl_x[0])-1)*100:+.1f}% (peak +{peak*100:.0f}%)", peak, chg
        # flow collapse
        if info:
            if (b1 + s1 >= 8 and s1 > b1 * 2) or (b5 + s5 >= 10 and s5 > b5 * 1.8):
                return True, f"flow collapse s1={s1}/b1={b1} s5={s5}/b5={b5} {chg*100:+.0f}%", peak, chg
        # trend dead
        if (chg < -0.05 and held_min > 30) or (chg < -0.08 and held_min > 15):
            return True, f"downtrend {chg*100:+.0f}% {held_min:.0f}min", peak, chg
        # giveback
        if peak >= 0.15:
            ratio = 0.7 if peak > 3.0 else (0.6 if peak > 1.0 else 0.5)
            if chg < peak * ratio:
                return True, f"giveback (peak +{peak*100:.0f}%, now {chg*100:+.0f}%)", peak, chg
        # stale / no momentum
        if held_min > 720 and abs(chg) < 0.03:
            return True, f"stale 12h {chg*100:+.0f}%", peak, chg
        if held_min > 45 and chg < 0.02 and peak < 0.15:
            return True, f"no momentum 45min ({chg*100:+.0f}%)", peak, chg
        # disaster
        if chg <= -0.45:
            return True, f"disaster {chg*100:+.0f}%", peak, chg
        return False, "", peak, chg


# ================= SETTLE (shared) =================
def settle(s, addr, p, sell_act, why, method, native_eth_out=None, fill_ratio=1.0):
    tx = (sell_act.get("tx_hash") or "")[:64]
    if tx and tx in s["settled_txs"]:
        return True
    entry_usd = p.get("alloc_usd") or 0
    if native_eth_out:
        # (#safety1) 用成交匯率: exit_usd = entry_alloc × (收到ETH/付出ETH)，只在有 entry_eth 時
        entry_eth = p.get("entry_eth") or 0
        if entry_eth > 0 and native_eth_out > 0:
            exit_usd = entry_usd * (native_eth_out / entry_eth)
        else:
            exit_usd = native_eth_out * eth_price()  # fallback
    elif p.get("alloc_usd") and p.get("entry_quote_qty"):
        out_qty = float(sell_act.get("quote_amount") or 0)
        exit_usd = p["alloc_usd"] * out_qty / p["entry_quote_qty"] if p["entry_quote_qty"] else 0
    else:
        exit_usd = float(sell_act.get("buy_cost_usd") or sell_act.get("cost_usd") or 0)
    gas = float(sell_act.get("gas_usd") or 0) + (p.get("gas_usd") or 0)
    pnl_usd = exit_usd - entry_usd - gas
    pnl_pct = pnl_usd / entry_usd * 100 if entry_usd else 0
    s["equity_usd"] += exit_usd - float(sell_act.get("gas_usd") or 0)
    s["closed"].append({
        "time": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "symbol": p["symbol"], "address": addr,
        "entry_eth": p.get("entry_eth", 0),
        "exit_eth": round(native_eth_out, 6) if native_eth_out else None,
        "pnl_pct": round(pnl_pct, 1), "reason": why,
        "pnl_usd": round(pnl_usd, 2), "exit_usd": round(exit_usd, 2),
        "alloc_usd": round(entry_usd, 2), "entry_usd": round(entry_usd, 2),
        "gas_usd": round(gas, 2), "method": method,
        "fill_ratio": round(fill_ratio, 2),
        "tx_in": p.get("tx_in", ""), "tx_out": tx[:26],
        "_buy_ts": p.get("opened_ts"),
        "score": p.get("score"), "snap": p.get("snap"),
        "peak_chg": p.get("peak_chg"),
        "held_min": round((time.time()-p.get("opened_ts",0))/60, 0) if p.get("opened_ts") else None,
        "meeting": p.get("meeting", []),  # carry 5-agent 進場會議紀錄到 closed
    })
    if tx:
        s["settled_txs"].append(tx)
    # [snapshot] 決策快照結算回寫（只記錄，不影響 settle 計算）
    if _snap_settle and p.get("snap_id"):
        try:
            _snap_settle(p["snap_id"], {
                "pnl_usd": round(pnl_usd, 2), "pnl_pct": round(pnl_pct, 1),
                "exit_usd": round(exit_usd, 2), "gas_usd": round(gas, 2),
                "peak_chg": p.get("peak_chg"),
                "held_min": round((time.time()-p.get("opened_ts",0))/60, 0) if p.get("opened_ts") else None,
                "exit_reason": why, "method": method, "fill_ratio": round(fill_ratio, 2),
                "tx_out": tx[:26],
            })
        except Exception as _e:
            print(f"[snapshot] settle writeback fail: {_e}")
    return True

# ================= CLOSE POSITION =================
def close_position(addr, strat_open_ids):
    bal = token_balance_raw(addr)
    if bal and bal > 0:
        args = ["swap", "--chain", CHAIN, "--from", WALLET,
                "--input-token", addr, "--output-token", NATIVE,
                "--percent", "100", "--slippage", "12", "--yes"]  # 路4: auto gas；2026-09-03: 25→12 出場滑點收緊
        t0 = time.time()
        r = subprocess.run(["gmgn-cli", *args, "--raw"],
                           capture_output=True, text=True, timeout=60)  # 180→60
        out = (r.stdout or "").strip()
        try:
            res = json.loads(out)
        except Exception:
            return False, "swap parse fail", None
        if res.get("status") != "submitted" or not res.get("order_id"):
            return False, "swap fail", None
        order_id = res["order_id"]
        poll_intervals = [2, 3, 5, 8, 8, 8, 8, 8, 8]  # 同 Sniper
        for wait in poll_intervals:
            time.sleep(wait)
            try:
                d = gm("order", "get", "--chain", CHAIN, "--order-id", order_id, timeout=15)
                if d.get("status") == "confirmed":
                    print(f"  [close] confirmed in {time.time()-t0:.1f}s")
                    return True, "swap", d.get("report") or {}
                if d.get("status") in ("failed", "expired"):
                    return False, f"swap {d['status']}", d
            except: pass
        return False, "swap timeout", {"timeout": True, "order_id": order_id}
    if addr in strat_open_ids:
        sid = strat_open_ids[addr]
        r = subprocess.run(["gmgn-cli", "order", "strategy", "cancel", "--chain", CHAIN,
            "--from", WALLET, "--order-id", sid, "--order-type", "smart_trade", "--raw"],
            capture_output=True, text=True, timeout=60)  # 120→60
        # cancel 後階梯等餘額歸還（原 10×8=80s，改 5×5=25s）
        for wait_c in [5, 5, 5, 5, 5]:
            time.sleep(wait_c)
            bal = token_balance_raw(addr)
            if bal and bal > 0:
                return close_position(addr, strat_open_ids)
        return False, "frozen", None  # 上層會設 custody=frozen
    return False, "unknown", None


# ================= SNAPSHOT =================
def snapshot(s):
    ep = eth_price()
    try:
        eth = gas_eth()
    except Exception:
        eth = 0.0
    total = eth * ep
    lines = [f"ETH {eth:.5f} = ${eth*ep:.2f}"]
    for addr, p in s["positions"].items():
        chg, _ = kline_chg(p, addr)
        val = (p.get("alloc_usd") or 0) * (1 + chg)
        total += val
        lines.append(f"  {p['symbol']}: {chg*100:+.1f}% = ${val:.2f}")
    s["_last_snapshot"] = {"ts": time.time(), "total_usd": round(total, 2), "eth": eth}
    return total, lines

# ================= TICK (main loop) =================
def tick(dry_run=False, scan_only=False):
    with BotLock():
        s = load()
        prune_seen(s)
        th = s.get("thresholds", THRESHOLDS)
        ep = eth_price()
        
        # === exits (skip in scan_only) ===
        if not scan_only:
            acts_map = fetch_activities_map(fetch_activity())
            strat_ids = strategy_open_ids_all()
            for addr in list(s["positions"]):
                p = s["positions"][addr]
                # (#safety4) frozen 倉直接跳過
                if p.get("custody") == "frozen":
                    continue
                sells = [a for a in acts_map.get(addr, {}).get("sells", [])
                         if a.get("timestamp", 0) > p["opened_ts"]]
                bal = token_balance_raw(addr)
                if sells and not bal:
                    a = sells[-1]
                    # (#safety5) settle 前驗 95% 成交，不到就保持 pending 不刪倉
                    sold_qty = float(a.get("token_amount") or 0) * (10 ** int(p.get("token_decimals", 18) or 18))
                    held_qty = float(p.get("token_amount") or 0)
                    if held_qty and sold_qty < held_qty * 0.95:
                        print(f"  {p['symbol']} partial fill ({sold_qty:.0f}/{held_qty:.0f}), skip settle")
                        continue
                    if settle(s, addr, p, a, "condition order filled", "cond"):
                        del s["positions"][addr]
                    continue
                if sells and bal:
                    continue  # partial fill, handled by monitor
                do, why, peak, last = Judge.judge_exit(p, token_info_cached(addr), addr)
                p["peak_chg"] = peak; p["last_chg"] = last
                if do:
                    print(f"SELL {p['symbol']}: {why}")
                    if dry_run: continue
                    closed, method, srep = close_position(addr, strat_ids)
                    if closed:
                        time.sleep(1)  # confirmed 後短等 activity（原6s）
                        my_sell = latest_sell(addr, p["opened_ts"])
                        got_eth = float((srep or {}).get("output_amount", "0") or 0) / ETH_DECIMALS if method == "swap" else 0
                        if got_eth and my_sell:
                            settle(s, addr, p, my_sell, why, method, native_eth_out=got_eth)
                            del s["positions"][addr]
                        elif my_sell and settle(s, addr, p, my_sell, why, method):
                            del s["positions"][addr]
                    elif method == "frozen":
                        p["custody"] = "frozen"
                        print(f"  {p['symbol']} FROZEN — need manual check")
                    else:
                        print("  SELL FAILED - retry next tick")
        # === SL 補掛（路1: 進場時不帶 conditions，進場後補掛 SL） ===
        for addr, p in s["positions"].items():
            if not p.get("sl_pending") or p.get("custody") == "frozen":
                continue
            token_amount = p.get("token_amount", 0)
            decimals = int(p.get("token_decimals", 18) or 18)
            if not token_amount or token_amount <= 0:
                continue
            # SL: 跌 40% 時以市價賣出 100%
            entry_px = p.get("entry_kline_px") or 0
            sl_trigger = entry_px * 0.6 if entry_px > 0 else 0  # entry * 0.6 = -40%
            sell_conditions = [
                {"order_type": "stop_loss", "side": "sell",
                 "trigger_price": str(sl_trigger), "trigger_price_type": "market",
                 "sell_ratio": "100", "close_sell_model": "market"}
            ]
            sell_param = {"ratio": "100", "order_type": "market", "slippage": "12"}
            try:
                args = ["order", "strategy", "create", "--chain", CHAIN, "--from", WALLET,
                        "--base-token", addr, "--side", "sell",
                        "--order-type", "smart_trade", "--sub-order-type", "stop_loss",
                        "--group-tag", "SLfix",
                        "--amount-in-percent", "100",
                        "--condition-orders", json.dumps(sell_conditions),
                        "--sell-param", json.dumps(sell_param),
                        "--yes", "--raw"]
                r = subprocess.run(["gmgn-cli", *args, "--raw"],
                                   capture_output=True, text=True, timeout=30)
                out = (r.stdout or "").strip()
                res = json.loads(out) if out else {}
                if res.get("order_id"):
                    p["sl_pending"] = False
                    p["sl_order_id"] = res["order_id"]
                    print(f"  [SL] {p['symbol']} SL order created ({res['order_id'][:16]}...)")
                else:
                    # fail → 放棄 SL，下次 tick judge_exit 直接出
                    p["sl_pending"] = False
                    print(f"  [SL] {p['symbol']} SL create fail: {out[:100]}")
            except Exception as e:
                p["sl_pending"] = False
                print(f"  [SL] {p['symbol']} SL err: {e}")

        # === entries via 5-agent pipeline ===
        risk_pass, risk_why = Risk.check(s, th)
        if not risk_pass:
            print(f"RISK VETO: {risk_why}")
            if not scan_only:
                total, lines = snapshot(s)
                s["equity_onchain"] = round(total, 2)
                save(s)
            return
        
        candidates = Scanner.scan(s["seen"], th)
        print(f"Scanner: {len([c for c in candidates if c['score'] > 0])} candidates (from {len(candidates)})")
        
        # (#safety2) pending_entry: 上次超時的單先 poll 再決定，防雙重買入
        for pe in list(s.get("pending_entry", [])):
            oid = pe.get("order_id")
            if not oid:
                s["pending_entry"].remove(pe); continue
            try:
                d = gm("order", "get", "--chain", CHAIN, "--order-id", oid, timeout=30)
                st = d.get("status")
            except Exception:
                continue
            if st == "confirmed":
                rep = d.get("report") or {}
                addr = pe["address"]; sym = pe["symbol"]
                time.sleep(1)  # confirmed 後短等 activity（原6s）
                my_buy = latest_buy(addr)
                spent_eth = int(rep.get("input_amount", "0")) / ETH_DECIMALS
                buy_cost_usd = spent_eth * ep
                s["positions"][addr] = {
                    "symbol": sym, "entry_eth": spent_eth,
                    "alloc_usd": buy_cost_usd, "entry_usd": buy_cost_usd,
                    "entry_ep": ep,
                    "gas_usd": float((my_buy or {}).get("gas_usd") or 0),
                    "token_amount": int(rep.get("output_amount", "0")),
                    "token_decimals": int(rep.get("output_token_decimals", "18") or 18),
                    "opened_ts": pe.get("since", time.time()),
                    "score": pe.get("score", 0), "snap": pe.get("snap"),
                    "tx_in": oid, "entry_quote_qty": float((my_buy or {}).get("quote_amount") or 0),
 "custody": "escrow", "peak_chg": 0, "last_chg": 0,
 "meeting": pe.get("meeting", [])}
                s["equity_usd"] -= buy_cost_usd + float((my_buy or {}).get("gas_usd") or 0)
                # [snapshot] pending_entry 確認後補存決策快照
                if _snap_save:
                    try:
                        _sid2 = _snap_save("live", addr, sym, "entry_meeting", {
                            "score": pe.get("score", 0), "snap": pe.get("snap"),
                            "alloc_usd": buy_cost_usd, "entry_eth": spent_eth,
                            "meeting": pe.get("meeting", []),
                        })
                        if _sid2:
                            s["positions"][addr]["snap_id"] = _sid2
                    except Exception as _e:
                        print(f"[snapshot] pending_entry save fail: {_e}")
                s["pending_entry"].remove(pe)
                print(f"  [pending_entry] {sym} confirmed, position recorded")
            elif st in ("failed", "expired"):
                s["pending_entry"].remove(pe)
                print(f"  [pending_entry] {pe['symbol']} {st}, released")
            # 還在 pending 就等下個 tick
        
        executed = False
        meeting = []  # 5-agent 進場討論紀錄（veto 也記）
        for c in candidates:
            if executed: break  # one position per tick
            t = c["token"]
            addr = t.get("address", "")
            sym = t.get("symbol", "?")

            # agent 1: scanner
            sc_verdict = "approve" if c["score"] >= th["min_scanner"] else "veto"
            sc_reason = rich_scanner_reason(c, th)
            meeting.append({"agent":"scanner","score":c["score"],"verdict":sc_verdict,"reason":sc_reason})
            if c["score"] < th["min_scanner"]:
                s["seen"][addr] = time.time()
                if _snap_save:
                    try:
                        _snap_save("live", addr, sym, "entry_meeting", {
                            "verdict": "veto", "veto_agent": "scanner",
                            "score": c["score"], "snap": c.get("snap"),
                            "meeting": list(meeting),
                        })
                    except Exception as _e:
                        print(f"[snapshot] veto save fail: {_e}")
                continue

            # agent 2: narrative
            narr_score, narr_reason_orig = Narrative.score(t)
            narr_reason = rich_narrative_reason(t, narr_score, narr_reason_orig)
            narr_verdict = "approve" if narr_score >= th["min_narrative"] else "veto"
            meeting.append({"agent":"narrative","score":narr_score,"verdict":narr_verdict,"reason":narr_reason})
            if narr_score < th["min_narrative"]:
                s["seen"][addr] = time.time()
                print(f"  {sym}: Narrative veto ({narr_reason})")
                if _snap_save:
                    try:
                        _snap_save("live", addr, sym, "entry_meeting", {
                            "verdict": "veto", "veto_agent": "narrative",
                            "score": narr_score, "snap": c.get("snap"),
                            "meeting": list(meeting),
                        })
                    except Exception as _e:
                        print(f"[snapshot] veto save fail: {_e}")
                continue

            # agent 3: sniper (kline check)
            sniper_score, sniper_reason_orig = Sniper.pre_check(t)
            snip_verdict = "approve" if sniper_score >= th["min_sniper"] else "veto"
            sniper_reason = f"{sniper_reason_orig}"
            meeting.append({"agent":"sniper","score":sniper_score,"verdict":snip_verdict,"reason":sniper_reason})
            if sniper_score < th["min_sniper"]:
                s["seen"][addr] = time.time()
                print(f"  {sym}: Sniper veto ({sniper_reason})")
                if _snap_save:
                    try:
                        _snap_save("live", addr, sym, "entry_meeting", {
                            "verdict": "veto", "veto_agent": "sniper",
                            "score": sniper_score, "snap": c.get("snap"),
                            "meeting": list(meeting),
                        })
                    except Exception as _e:
                        print(f"[snapshot] veto save fail: {_e}")
                continue

            # agent 4: judge (history)
            judge_score, judge_reason_orig = Judge.pre_check(t, s)
            judge_reason = rich_judge_reason(t, s, judge_score, judge_reason_orig)
            judge_verdict = "approve" if judge_score >= th["min_judge"] else "veto"
            meeting.append({"agent":"judge","score":judge_score,"verdict":judge_verdict,"reason":judge_reason})
            if judge_score < th["min_judge"]:
                s["seen"][addr] = time.time()
                print(f"  {sym}: Judge veto ({judge_reason})")
                if _snap_save:
                    try:
                        _snap_save("live", addr, sym, "entry_meeting", {
                            "verdict": "veto", "veto_agent": "judge",
                            "score": judge_score, "snap": c.get("snap"),
                            "meeting": list(meeting),
                        })
                    except Exception as _e:
                        print(f"[snapshot] veto save fail: {_e}")
                continue

            total_score = c["score"] + narr_score + sniper_score + judge_score
            print(f"  {sym}: scanner={c['score']} narrative={narr_score} sniper={sniper_score} judge={judge_score} total={total_score}")

            if total_score < th["min_total_score"]:
                s["seen"][addr] = time.time()
                print(f"  {sym}: total {total_score} < {th['min_total_score']}")
                if _snap_save:
                    try:
                        _snap_save("live", addr, sym, "entry_meeting", {
                            "verdict": "veto", "veto_agent": "total_score",
                            "score": total_score, "snap": c.get("snap"),
                            "meeting": list(meeting),
                        })
                    except Exception as _e:
                        print(f"[snapshot] veto save fail: {_e}")
                continue

            # agent 5: risk (pre-computed above, gate already passed)
            alloc_est = min(PER_TRADE, s["equity_usd"] * 0.5,
                          (gas_eth() - MIN_GAS_ETH) * ep * 0.9)
            risk_reason = rich_risk_reason(s, alloc_est)
            meeting.append({"agent":"risk","score":0,"verdict":"approve","reason":risk_reason})

            alloc_usd = alloc_est
            if alloc_usd < 2.5: break

            entry_summary = " | ".join([f"{m['agent']}:{m['score']}" for m in meeting])
            print(f"BUY {sym} ${alloc_usd:.2f} (total={total_score}) | meeting: {entry_summary}")
            if dry_run:
                print("  [dry-run] would execute")
                executed = True
                break

            ok, rep, oid = Sniper.execute(t, alloc_usd, ep)
            if not ok:
                if rep and rep.get("timeout") and oid:
                    # (#safety2) 超時: 存 pending_entry，下個 tick 先 poll，防雙重買入
                    s.setdefault("pending_entry", []).append({
                        "address": addr, "symbol": sym, "order_id": oid,
                        "since": time.time(), "score": total_score, "snap": c["snap"],
                        "meeting": meeting})
                    print(f"  [pending_entry] {sym} timeout order={oid}, will poll next tick")
                else:
                    key = addr + ":fail"
                    s["seen"][key] = s["seen"].get(key, 0) + 1
                    if s["seen"][key] >= 3: s["seen"][addr] = time.time()
                continue
            time.sleep(2)  # 確認後短等 activity 入庫（原6s，鏈上已confirmed不用久等）
            my_buy = latest_buy(addr)  # 查一次就好，查不到照 report 記
            spent_eth = int(rep.get("input_amount", "0")) / ETH_DECIMALS
            buy_cost_usd = spent_eth * ep
            quote_qty = float((my_buy or {}).get("quote_amount") or 0)
            s["seen"][addr] = time.time()
            s["positions"][addr] = {
                "symbol": sym,
                "entry_eth": spent_eth,
                "alloc_usd": buy_cost_usd,
                "entry_usd": buy_cost_usd,
                "entry_ep": ep,
                "gas_usd": float((my_buy or {}).get("gas_usd") or 0),
                "token_amount": int(rep.get("output_amount", "0")),
                "token_decimals": int(rep.get("output_token_decimals", "18") or 18),
                "opened_ts": time.time(),
                "score": total_score, "snap": c["snap"],
                "tx_in": oid,
                "entry_quote_qty": quote_qty,
                "custody": "wallet",  # 路1: 裸 swap → 幣在錢包，非 escrow
                "sl_pending": True,   # SL 待補掛
                "peak_chg": 0, "last_chg": 0,
                "meeting": meeting,   # 5-agent 進場討論紀錄
            }
            s["equity_usd"] -= buy_cost_usd + float((my_buy or {}).get("gas_usd") or 0)
            # [snapshot] 開倉決策存檔（只記錄，不影響開倉邏輯）
            if _snap_save:
                try:
                    _sid = _snap_save("live", addr, sym, "entry_meeting", {
                        "score": total_score, "snap": c.get("snap"),
                        "alloc_usd": buy_cost_usd, "entry_eth": spent_eth,
                        "meeting": meeting,
                    })
                    if _sid:
                        s["positions"][addr]["snap_id"] = _sid
                except Exception as _e:
                    print(f"[snapshot] entry save fail: {_e}")
            executed = True
            print(f"  entered {sym}")
            break
        
        if not scan_only:
            total, lines = snapshot(s)
            book = s["equity_usd"] + sum((p.get("alloc_usd") or 0) for p in s["positions"].values())
            if abs(total - book) > 2.0:
                print(f"  [WARN] book ${book:.2f} vs onchain ${total:.2f}")
            s["equity_onchain"] = round(total, 2)
            save(s)
            print(f"{datetime.now():%m-%d %H:%M} grok onchain=${total:.2f} book=${s['equity_usd']:.2f} open={len(s['positions'])} closed={len(s['closed'])}")
            for l in lines[1:]: print(l)


# ================= MONITOR (exit-only) =================
def monitor_tick():
    s = load()
    if not s["positions"]:
        return
    acts_map = fetch_activities_map(fetch_activity())
    strat_ids = strategy_open_ids_all()
    for addr in list(s["positions"]):
        p = s["positions"][addr]
        # (#safety4) frozen 直接跳
        if p.get("custody") == "frozen":
            continue
        sells = [a for a in acts_map.get(addr, {}).get("sells", [])
                 if a.get("timestamp", 0) > p["opened_ts"]]
        bal = token_balance_raw(addr)
        if sells and not bal:
            a = sells[-1]
            tx = (a.get("tx_hash") or "")[:64]
            if tx in s["settled_txs"]:
                continue
            # (#safety5) 驗 95% 成交
            sold_qty = float(a.get("token_amount") or 0) * (10 ** int(p.get("token_decimals", 18) or 18))
            held_qty = float(p.get("token_amount") or 0)
            if held_qty and sold_qty < held_qty * 0.95:
                print(f"  {p['symbol']} partial fill ({sold_qty:.0f}/{held_qty:.0f}), skip settle")
                continue
            if settle(s, addr, p, a, "condition order filled", "cond"):
                del s["positions"][addr]
            continue
        if sells and bal:
            continue
        do, why, peak, last = Judge.judge_exit(p, token_info_cached(addr), addr)
        p["peak_chg"] = peak; p["last_chg"] = last
        if do:
            print(f"SELL {p['symbol']}: {why}")
            closed, method, srep = close_position(addr, strat_ids)
            if closed:
                time.sleep(1)  # confirmed 後短等 activity（原6s）
                my_sell = latest_sell(addr, p["opened_ts"])
                got_eth = float((srep or {}).get("output_amount", "0") or 0) / ETH_DECIMALS if method == "swap" else 0
                if got_eth and my_sell:
                    settle(s, addr, p, my_sell, why, method, native_eth_out=got_eth)
                    del s["positions"][addr]
                elif my_sell and settle(s, addr, p, my_sell, why, method):
                    del s["positions"][addr]
                else:
                    s.setdefault("pending_close", []).append({
                        "address": addr, "symbol": p["symbol"],
                        "method": method, "since": time.time(),
                        "entry_usd": p.get("alloc_usd"),
                        "entry_quote_qty": p.get("entry_quote_qty"),
                        "gas_usd": p.get("gas_usd"),
                        "meeting": p.get("meeting", []),
                        "order_id": None})  # pending_close 保留 order_id 欄位
                    del s["positions"][addr]
            elif method == "frozen":
                p["custody"] = "frozen"
                print(f"  {p['symbol']} FROZEN")
            else:
                print("  SELL FAILED - retry next")
    # orphan scan
    try:
        d = gm("portfolio", "token-balance", "--chain", CHAIN, "--wallet", WALLET)
        for b in (d.get("balances") or []):
            taddr = (b.get("token_address") or "").lower()
            if not taddr or taddr == NATIVE: continue
            if float(b.get("balance") or 0) > 0 and taddr not in s["positions"]:
                print(f"  [ORPHAN] {taddr[:12]}... — needs manual check")
    except: pass
    # pending reconcile
    for pc in list(s.get("pending_close", [])):
        a = latest_sell(pc["address"], pc["since"] - 600)
        if a:
            p_ref = {"symbol": pc.get("symbol", "?"),
                     "alloc_usd": pc.get("entry_usd") or float(a.get("buy_cost_usd") or 0),
                     "gas_usd": pc.get("gas_usd") or 0,
                     "entry_quote_qty": pc.get("entry_quote_qty"),
                     "meeting": pc.get("meeting", [])}
            if settle(s, pc["address"], p_ref, a, "late reconcile", pc["method"]):
                s["pending_close"].remove(pc)
                print(f"  [RECONCILE] {pc['symbol']}")
    total, lines = snapshot(s)
    s["equity_onchain"] = round(total, 2)
    save(s)
    for addr, p in s["positions"].items():
        print(f"  {p['symbol']}: {p.get('last_chg', 0)*100:+.1f}% (peak {p.get('peak_chg', 0)*100:+.0f}%)")


# ================= ADAPTIVE REVIEW =================
def review():
    """Read closed trades, compute per-agent hit rate, adjust thresholds."""
    s = load()
    closed = s.get("closed", [])
    if len(closed) < 30:
        print(f"Review: only {len(closed)} closed trades, need >=30 (anti-overfit). Skip.")
        return
    wins = [c for c in closed if (c.get("pnl_usd") or 0) > 0]
    losses = [c for c in closed if (c.get("pnl_usd") or 0) <= 0]
    wr = len(wins) / len(closed) * 100
    avg_win = sum(float(c.get("pnl_usd") or 0) for c in wins) / len(wins) if wins else 0
    avg_loss = sum(float(c.get("pnl_usd") or 0) for c in losses) / len(losses) if losses else 0
    print(f"Review: {len(closed)} trades | win rate {wr:.0f}% | avg win +${avg_win:.2f} | avg loss ${avg_loss:.2f}")
    
    # exit reason analysis
    reasons = {}
    for c in closed:
        for key in ["flow collapse", "giveback", "downtrend", "disaster", "fast dump", "condition order"]:
            if key in (c.get("reason") or "").lower():
                reasons.setdefault(key, {"n": 0, "pnl": 0})
                reasons[key]["n"] += 1
                reasons[key]["pnl"] += float(c.get("pnl_usd") or 0)
                break
    for k, v in sorted(reasons.items(), key=lambda x: x[1]["pnl"]):
        print(f"  {k}: n={v['n']} pnl=${v['pnl']:.2f}")
    
    th = s.get("thresholds", dict(THRESHOLDS))
    recent = closed[-10:]
    recent_losses = sum(1 for c in recent if (c.get("pnl_usd") or 0) <= 0)
    changed = []
    if recent_losses >= 8:
        th["min_total_score"] = min(th["min_total_score"] + 2, 20)
        changed.append(f"min_total_score -> {th['min_total_score']} (recent {recent_losses}/10 losses)")
    elif recent_losses <= 3:
        th["min_total_score"] = max(th["min_total_score"] - 1, 10)
        changed.append(f"min_total_score -> {th['min_total_score']} (loosening)")
    # gas-heavy losses -> slow down
    gas_total = sum(float(c.get("gas_usd") or 0) for c in closed)
    pnl_total = sum(float(c.get("pnl_usd") or 0) for c in closed)
    if gas_total > abs(pnl_total) * 0.5 and pnl_total < 0:
        global HOUR_BETWEEN_BUYS
        HOUR_BETWEEN_BUYS = 2
        changed.append("HOUR_BETWEEN_BUYS -> 2 (gas friction dominant)")
    
    if changed:
        s["thresholds"] = th
        save(s)
        for c in changed: print(f"  ADJUSTED: {c}")
    else:
        print("  no threshold changes")

# ================= SNAPSHOT STORE (lazy) =================
try:
    import sys as _sys_snap
    _sys_snap.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "paper_trade"))
    from snapshot_store import save_decision as _snap_save, settle_decision as _snap_settle
except ImportError:
    _snap_save = None
    _snap_settle = None

# ================= MAIN =================
if __name__ == "__main__":
    if "--set" in sys.argv:
        payload = json.loads(sys.argv[sys.argv.index("--set") + 1])
        with BotLock():
            s = load()
            s.update(payload)
            save(s)
            print("state updated:", list(payload.keys()))
    elif "--review" in sys.argv:
        with BotLock():
            review()
    elif "--monitor" in sys.argv:
        with BotLock():
            monitor_tick()
    elif "--scan-only" in sys.argv:
        tick(scan_only=True)
    elif "--dry-run" in sys.argv:
        tick(dry_run=True)
    else:
        tick()
