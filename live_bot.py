#!/usr/bin/env python3
"""Robinhood Chain LIVE bot v3 — 架構重寫版.

v3 核心變更（架構審查 10 項）:
  1. settle(): 記帳唯一路徑（tick/monitor/reconcile 全走這）
  2. custody 狀態機: wallet/escrow/unknown；位置不明 → 凍結賣出只告警
  3. kline 同源計價: 漲跌 = kline現價/kline進場價，單位自動消掉，廢 price_calib
  4. snapshot(): 鏈上盤點 equity 為唯一真相，推算值僅交叉核對
  5. tx_hash 去重: settled_txs 集合，同 tx 不重複記帳
  6. TP1 半倉成交偵測: sell 但餘額>0 → 按比例縮 alloc/token_amount
  8. eth_price 快取: CoinGecko 掛了用上次價
  9. seen 帶時間戳 48h 過期
  10. activity 一輪抓一次傳遞
出場: SL -40% 全出（條件單保命）+ TP +60% 賣 50%（鎖利防賣飛）+ AI judge_exit 處理剩餘
"""
import json, csv, os, time, subprocess, sys, fcntl
from datetime import datetime, timezone

STATE = "/root/rh_live/state.json"
LOG   = "/root/rh_live/trades.csv"
LOCK  = "/root/rh_live/bot.lock"
CHAIN = "robinhood"
WALLET = "0xYOUR_WALLET_ADDRESS"
NATIVE = "0x0000000000000000000000000000000000000000"
START_EQUITY = 110.0
PER_TRADE = 10.0
MAX_OPEN = 3
MIN_GAS_ETH = 0.001
GAS_PRICE = "0.3"
TP_PCT = 60    # TP 條件單: +60% 賣 50%
SL_PCT = 40    # SL 條件單: -40% 全出
SEEN_TTL = 48 * 3600
ETH_DECIMALS = 10**18

# ================= 基礎 =================
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

def gm(*args, timeout=90):
    r = subprocess.run(["gmgn-cli", *args, "--raw"], capture_output=True, text=True, timeout=timeout)
    out = (r.stdout or "").strip()
    if "[gmgn-cli] error" in out or r.returncode != 0:
        raise RuntimeError(f"gmgn {args[0]}: {out[:200]}")
    return json.loads(out)

def eth_price():
    """(#8) 快取: 失敗用上次價格"""
    global _EP_CACHE
    try:
        import urllib.request
        r = urllib.request.Request("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
                                   headers={"User-Agent": "Mozilla/5.0"})
        _EP_CACHE = json.load(urllib.request.urlopen(r, timeout=10))["ethereum"]["usd"]
        return _EP_CACHE
    except Exception:
        return _EP_CACHE or 2400.0
_EP_CACHE = None
_EP_CACHE = eth_price() or 2400.0

def token_info(addr):
    try: return gm("token", "info", "--chain", CHAIN, "--address", addr)
    except Exception: return None

def token_balance_raw(addr):
    try:
        d = gm("portfolio", "token-balance", "--chain", CHAIN, "--wallet", WALLET, "--token", addr)
        return int(float(d["balances"][0]["balance"]))
    except Exception:
        return None

def fetch_activity():
    """(#10) 一輪只抓一次"""
    try:
        d = gm("portfolio", "activity", "--chain", CHAIN, "--wallet", WALLET)
        return d.get("activities") or []
    except Exception:
        return []

def fetch_activities_map(acts):
    """{addr: {buy: act, sells: [act...]}}"""
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

# ================= 行情: kline 同源計價 (#3) =================
def kline_chg(p, addr):
    """漲跌 = kline 現價 / 進場時刻 kline 價 — 同源同單位，單位自動消掉"""
    entry_ts = int(p["opened_ts"])
    held = time.time() - entry_ts
    res = "1m" if held < 7200 else ("15m" if held < 86400 else "1h")
    ks = klines_res(addr, res)
    if not ks: return 0.0, 0.0
    # 基準價: 進場後第一次查詢時固化, 之後永遠用同一個數（解析度切換不跳變）
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


# ================= 狀態 =================
def load():
    if os.path.exists(STATE):
        s = json.load(open(STATE))
        s.setdefault("settled_txs", [])   # 舊 state 遷移
        s.setdefault("pending_close", [])
        return s
    return {"equity_usd": START_EQUITY, "positions": {}, "closed": [], "seen": {},
            "settled_txs": [], "pending_close": [], "live": True}

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
                w.writerow([c["time"], c["symbol"], c["address"], c.get("tx_in","")[:20],
                            c.get("tx_out","")[:26], f"{c.get('entry_eth') or 0:.4g}",
                            f"{c.get('pnl_pct',0):.1f}%", f"{c.get('pnl_usd','')}",
                            c.get("method",""), c["reason"]])
                c["logged"] = True

def prune_seen(s):
    """(#9) seen 48h 過期"""
    now = time.time()
    s["seen"] = {k: v for k, v in s["seen"].items()
                 if v == 1 or (isinstance(v, (int, float)) and now - v < SEEN_TTL)}

# ================= 帳務: 唯一路徑 settle (#1) =================
def settle(s, addr, p, sell_act, why, method, native_eth_out=None):
    """平倉記帳唯一入口。回傳 True=已入帳。
    出場 USD 三級（單位安全降序）:
      1. native_eth_out: AI 主動賣走 NATIVE → 鏈上實收 ETH × ep（零單位風險）
      2. 比例法: alloc × (收到quote ÷ 付出quote) — 同源同單位相除
      3. activity buy_cost_usd — 最後保底（虛高 ~8.6%, 只在無資料時用）
    gas: 買入 p.gas_usd + 賣出 sell_act.gas_usd"""
    tx = (sell_act.get("tx_hash") or "")[:64]
    if tx and tx in s["settled_txs"]:
        return True  # (#5) 同 tx 不重複記
    entry_usd = p.get("alloc_usd") or 0
    if native_eth_out:
        exit_usd = native_eth_out * eth_price()
    elif p.get("alloc_usd") and p.get("entry_quote_qty"):
        # 比例法: 收到 quote / 付出 quote，兩者同為 GMGN 扣費後近似值，同源相除單位消掉
        out_qty = float(sell_act.get("quote_amount") or 0)
        exit_usd = p["alloc_usd"] * out_qty / p["entry_quote_qty"] if p["entry_quote_qty"] else 0
    else:
        exit_usd = float(sell_act.get("buy_cost_usd") or sell_act.get("cost_usd") or 0)
    gas = float(sell_act.get("gas_usd") or 0) + (p.get("gas_usd") or 0)
    # 單價（USD/幣）: 金額 ÷ 幣數量；買入量 p.token_amount 為 raw（含 decimals）
    dec = 10 ** int(p.get("token_decimals", 18) or 18)
    bought_h = float(p.get("token_amount") or 0) / dec if p.get("token_amount") else 0
    sold_h = float(sell_act.get("token_amount") or 0)  # activity 為人類可讀
    entry_price = entry_usd / bought_h if bought_h else None
    exit_price = exit_usd / sold_h if sold_h else None
    pnl_usd = exit_usd - entry_usd - gas
    pnl_pct = pnl_usd / entry_usd * 100 if entry_usd else 0
    s["equity_usd"] += exit_usd - float(sell_act.get("gas_usd") or 0)  # gas 是現金流, equity 要扣
    s["closed"].append({"time": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "symbol": p["symbol"], "address": addr, "entry_eth": p.get("entry_eth", 0),
        "exit_eth": round(native_eth_out, 6) if native_eth_out else None,
        "pnl_pct": round(pnl_pct, 1), "reason": why,
        "pnl_usd": round(pnl_usd, 2), "exit_usd": round(exit_usd, 2), "gas_usd": round(gas, 2),
        "alloc_usd": round(entry_usd, 2), "entry_usd": round(entry_usd, 2),
        "entry_price": round(entry_price, 12) if entry_price else None, "exit_price": round(exit_price, 12) if exit_price else None,
        "method": method, "tx_in": p.get("tx_in", ""), "tx_out": tx[:26],
        "_buy_ts": p.get("opened_ts"),
        "score": p.get("score"), "snap": p.get("snap"),
        "peak_chg": p.get("peak_chg"), "held_min": round((time.time()-p.get("opened_ts",0))/60,0) if p.get("opened_ts") else None})
    if tx:
        s["settled_txs"].append(tx)
    return True

# ================= 位置狀態機 (#2) =================
def check_custody(s, addr, p, strat_open_ids, sells_after_entry=None):
    """確認幣位置: wallet/escrow/sold/unknown。位置不明 → 上層凍結。"""
    bal = token_balance_raw(addr)
    if bal and bal > 0:
        return "wallet"
    if addr in strat_open_ids:
        return "escrow"
    if sells_after_entry:
        return "sold"
    return "unknown"

# ================= 進場閘門與評分（不變） =================
def launchpad_heat(toks, lp): 
    peers = [t for t in toks if (t.get("launchpad") or "") == lp]
    if len(peers) <= 1: return 0
    now = time.time()
    for p in peers:
        created = p.get("creation_timestamp") or 0
        chg = p.get("price_change_percent") or 0
        if created and now - created < 3600*6 and chg > 5000:
            return 2
    return 0

_SMART_BUY_CACHE = {"ts": 0, "addrs": {}}
def smart_buy_addrs(window=1800):
    """近 window 秒(預設30分) smart money 買過的幣 → {addr: buy_count}"""
    if time.time() - _SMART_BUY_CACHE["ts"] > 120:
        try:
            d = gm("track", "smartmoney", "--chain", CHAIN, "--limit", "100", "--side", "buy")
            m = {}
            now = time.time()
            for x in (d.get("list") or []):
                if now - (x.get("timestamp") or 0) > window:
                    continue
                a = (x.get("base_address") or "").lower()
                if a:
                    m[a] = m.get(a, 0) + 1
            _SMART_BUY_CACHE.update(ts=time.time(), addrs=m)
        except Exception:
            pass
    return _SMART_BUY_CACHE["addrs"]

def entry_score(t, info, toks):
    if not info: return 0, "no info", {}
    liq = t.get("liquidity") or 0
    mc  = t.get("market_cap") or 0
    holders = t.get("holder_count") or 0
    top10 = t.get("top_10_holder_rate")
    lp = t.get("launchpad") or "?"
    if liq < 15000: return 0, "liq<15k", {}
    if mc < 30000 or mc > 3_000_000: return 0, "mc band", {}
    if holders < 100: return 0, "holders<100", {}
    if top10 is not None and top10 > 0.35: return 0, "top10 concentrated", {}
    if t.get("is_honeypot"): return 0, "honeypot", {}
    if t.get("creator_close"): return 0, "dev sold", {}
    if (t.get("bundler_rate") or 0) > 0.3: return 0, "bundled launch", {}
    if info.get("locked_ratio") == 0 and mc > 500_000: return 0, "big+unlocked", {}
    if launchpad_heat(toks, lp) >= 2: return 0, f"capital drain on {lp}", {}
    score = 0
    tags = (info.get("wallet_tags_stat") or {})
    smart = tags.get("smart_wallets") or t.get("smart_degen_count") or 0
    if smart >= 50: score += 3
    elif smart >= 25: score += 2
    elif smart >= 10: score += 1
    smb = smart_buy_addrs().get((t.get("address") or "").lower(), 0)
    if smb >= 2: score += 3  # 最強預測力: 近30分≥2不同smart wallet買入(回測3筆: UGH勝, GRIND/QCAT無smb)
    elif smb == 1: score += 1
    if (t.get("rug_ratio") or 0) < 0.1: score += 1
    if (t.get("bot_degen_rate") or 0) < 0.4: score += 1
    pr = info.get("price") or {}
    buys = pr.get("buys_1h") or 0; sells = pr.get("sells_1h") or 0
    if buys + sells > 0 and buys / (buys + sells) > 0.55: score += 2
    elif buys + sells > 0 and buys / (buys + sells) > 0.5: score += 1
    vol1h = float(pr.get("volume_1h") or 0)
    if mc > 0 and vol1h / mc > 0.5: score += 1
    snap = {"holders": holders, "lp": lp, "mc": mc, "liq": liq,
            "buys1h": buys, "sells1h": sells, "smart": smart}
    return score, None, snap

# ================= 出場判斷（純函式化，單位 = kline 同源 #3/#7） =================
def judge_exit(p, info, addr):
    """回傳 (do_exit, reason, new_peak, new_last) — 不改 state"""
    chg, peak = kline_chg(p, addr)
    if not chg:
        return False, "", p.get("peak_chg", 0), p.get("last_chg", 0)
    # kline 單位內一致 → chg 可直接比
    if info:
        pr = info.get("price") or {}
        b1 = pr.get("buys_1m") or 0; s1 = pr.get("sells_1m") or 0
        b5 = pr.get("buys_5m") or 0; s5 = pr.get("sells_5m") or 0
    else:
        b1 = s1 = b5 = s5 = 0
    held_min = (time.time() - p["opened_ts"]) / 60
    # 0) 快崩（2026-09-03 修：peak≥30% 且當下未破保底時豁免——先讓 giveback 鎖利，與 grok_bot 同步）
    ks_x = klines_res(addr, "1m")
    if len(ks_x) >= 4:
        cl_x = [float(b["close"]) for b in ks_x[-4:]]
        if cl_x[-1] < cl_x[0] * 0.93 and peak >= 0.10:
            if peak >= 0.30:
                floor_pct = peak * (0.7 if peak > 3.0 else (0.6 if peak > 1.0 else 0.5)) * 100
                now_pct = (cl_x[-1] / p["entry_price"] - 1) * 100 if p.get("entry_price") else -999
                if now_pct > floor_pct:
                    pass  # 在保底之上：不出，交給 giveback
                else:
                    return True, f"fast dump 5m {((cl_x[-1]/cl_x[0])-1)*100:+.1f}% (peak +{peak*100:.0f}%)", peak, chg
            else:
                return True, f"fast dump 5m {((cl_x[-1]/cl_x[0])-1)*100:+.1f}% (peak +{peak*100:.0f}%)", peak, chg
    # 1.5) trail lock（2026-09-03 新增，實盤移動出場）: peak≥30% 啟動追蹤，
    #      回撤跌破 peak×0.65 即出場。跟 giveback 差別：trail 的保底更高（0.65 固定 vs 0.5~0.7 分段），
    #      且 1 分鐘 tick 即時檢查（配合 fast dump 豁免，形成「啟動後只看回撤」的移動停利）。
    #      依據：48 筆逐 K 重測 7 筆真救回（STRATTON -17.7%→+80% 等），滑價折減後仍為正。
    if peak >= 0.30 and peak < 3.0 and chg < peak * 0.65:
        return True, f"trail lock (peak +{peak*100:.0f}%, now {chg*100:+.0f}%, floor +{peak*0.65*100:.0f}%)", peak, chg
    # 1) flow collapse（量價訊號不涉及計價單位，直接用 token_info 計數）
    if info:
        if (b1 + s1 >= 8 and s1 > b1 * 2) or (b5 + s5 >= 10 and s5 > b5 * 1.8):
            return True, f"flow collapse s1={s1}/b1={b1} s5={s5}/b5={b5} {chg*100:+.0f}%", peak, chg
    # 2) trend dead: -5% 持倉 30 分 / -8% 持倉 15 分就出（快速下跌不用等 30 分）
    if (chg < -0.05 and held_min > 30) or (chg < -0.08 and held_min > 15):
        return True, f"downtrend {chg*100:+.0f}% {held_min:.0f}min", peak, chg
    # 3) giveback: peak≥15% 回吐出場。高 peak 用更緊的比例（FGL 教訓: 583% 腰斬線=291% 太鬆, 吐一半才觸發）
    if peak >= 0.15:
        ratio = 0.7 if peak > 3.0 else (0.6 if peak > 1.0 else 0.5)  # peak>300% 守七成, >100% 守六成
        if chg < peak * ratio:
            if chg < 0:
                # 漲過又跌破進場價 → 真實死因是反轉虧損, 不是獲利回吐
                return True, f"reversal loss (peak +{peak*100:.0f}% 未鎖利, now {chg*100:+.0f}%, 反轉跌破進場價)", peak, chg
            return True, f"giveback (peak +{peak*100:.0f}%, now {chg*100:+.0f}%, line +{peak*ratio*100:.0f}%)", peak, chg
    # 4) stale: 12h 無波動 → 縮短到 4h; 另加 45 分內無表現直接換標的
    if held_min > 720 and abs(chg) < 0.03:
        return True, f"stale 12h {chg*100:+.0f}%", peak, chg
    if held_min > 30 and chg < 0.02 and peak < 0.10:
        return True, f"no momentum 30min ({chg*100:+.0f}%, peak +{peak*100:.0f}%)", peak, chg
    if held_min > 45 and chg < 0.02 and peak < 0.15:
        return True, f"no momentum 45min ({chg*100:+.0f}%, peak +{peak*100:.0f}%)", peak, chg
    # 5) disaster
    if chg <= -0.45:
        return True, f"disaster {chg*100:+.0f}%", peak, chg
    return False, "", peak, chg

# ================= swap 執行 =================
def swap_and_confirm(input_token, output_token, amount_eth=None, percent=None,
                     condition_orders=None, slippage=8, max_wait=90):
    args = ["swap", "--chain", CHAIN, "--from", WALLET,
            "--input-token", input_token, "--output-token", output_token,
            "--slippage", str(slippage), "--gas-price", GAS_PRICE, "--yes"]
    if amount_eth is not None:
        args += ["--amount", str(int(amount_eth * ETH_DECIMALS))]
    elif percent is not None:
        args += ["--percent", str(percent)]
    else:
        raise ValueError("need amount or percent")
    if condition_orders:
        args += ["--condition-orders", json.dumps(condition_orders)]
    r = subprocess.run(["gmgn-cli", *args, "--raw"], capture_output=True, text=True, timeout=180)
    out = (r.stdout or "").strip()
    try:
        res = json.loads(out)
    except Exception:
        print(f"  [swap FAIL parse] {out[:200]}")
        return False, None, None
    if res.get("status") != "submitted" or not res.get("order_id"):
        print(f"  [swap FAIL] {out[:200]}")
        return False, None, None
    order_id = res["order_id"]
    deadline = time.time() + max_wait
    while time.time() < deadline:
        time.sleep(8)
        try:
            d = gm("order", "get", "--chain", CHAIN, "--order-id", order_id, timeout=30)
            st = d.get("status")
            if st == "confirmed":
                return True, d.get("report") or {}, order_id
            if st in ("failed", "expired"):
                print(f"  [swap {st}] order={order_id}")
                return False, d, order_id
        except Exception as e:
            print(f"  [poll err] {e}")
    print(f"  [swap TIMEOUT] order={order_id}")
    return False, {"timeout": True, "order_id": order_id}, order_id

def close_position(addr, strat_open_ids):
    """(#2) 出場路徑由 custody 決定:
    wallet → swap；escrow → 先 cancel 取回幣再 swap；unknown → 拒絕動作"""
    bal = token_balance_raw(addr)
    if bal and bal > 0:
        ok, rep, oid = swap_and_confirm(addr, NATIVE, percent=100, slippage=12)
        return ok, "swap", rep
    if addr in strat_open_ids:
        sid = strat_open_ids[addr]
        print("  escrow: cancel 取回幣（不帶 close-sell-model）")
        r = subprocess.run(["gmgn-cli", "order", "strategy", "cancel", "--chain", CHAIN,
            "--from", WALLET, "--order-id", sid, "--order-type", "smart_trade",
            "--raw"], capture_output=True, text=True, timeout=120)
        print(f"  [cancel] {(r.stdout or '')[:150]}")
        for _ in range(10):  # 實測 GMGN 歸還幣可達 ~1 分鐘（RIM 案例 30s 不夠）
            time.sleep(8)
            bal = token_balance_raw(addr)
            if bal and bal > 0:
                ok, rep, oid = swap_and_confirm(addr, NATIVE, percent=100, slippage=12)
                return ok, "cancel+swap", rep
        print("  cancel 後幣未回錢包 — 凍結此倉，需人工查")
        return False, "frozen", None
    return False, "unknown", None

# ================= 鏈上盤點 (#4) =================
QUOTE_CACHE = {}  # addr → unit_usd
def snapshot(s, acts_map, strat_open_ids):
    """鏈上實況盤點。回傳 equity_onchain 與明細"""
    ep = eth_price()
    eth = 0.0
    try:
        d = gm("portfolio", "token-balance", "--chain", CHAIN, "--wallet", WALLET, "--token", NATIVE)
        eth = float(d["balances"][0]["balance"])
    except Exception:
        pass
    total = eth * ep
    lines = [f"ETH {eth:.5f} = ${eth*ep:.2f}"]
    # 未實現持倉
    for addr, p in s["positions"].items():
        chg, _ = kline_chg(p, addr)
        val = (p.get("alloc_usd") or 0) * (1 + chg)
        total += val
        lines.append(f"  {p['symbol']}: {chg*100:+.1f}% ≈ ${val:.2f}")
    # quote 幣殘餘（TP1/條件單賣出收款未換回）
    s["_last_snapshot"] = {"ts": time.time(), "total_usd": round(total, 2), "eth": eth}
    return total, lines

# ================= 主流程 =================
def tick():
    s = load()
    prune_seen(s)
    ep = eth_price()
    acts_map = fetch_activities_map(fetch_activity())
    strat_open_ids = strategy_open_ids_all()

    # ---- exits ----
    for addr in list(s["positions"]):
        p = s["positions"][addr]
        sells = [a for a in acts_map.get(addr, {}).get("sells", []) if a.get("timestamp",0) > p["opened_ts"]]
        custody = check_custody(s, addr, p, strat_open_ids, sells)
        p["custody"] = custody
        if custody == "unknown":
            print(f"  {p['symbol']} custody=unknown — 凍結，需人工查")
            continue
        # 條件單成交偵測（sell act + 餘額 0）
        bal = token_balance_raw(addr)
        if sells and not bal:
            a = sells[-1]
            if settle(s, addr, p, a, "condition order filled", "cond"):
                del s["positions"][addr]
            continue
        if sells and bal:
            # TP1 半倉 (#6)
            reduce_position(s, addr, p, sells)
            continue
        if custody == "unknown":
            continue
        do, why, peak, last = judge_exit(p, token_info(addr), addr)
        p["peak_chg"] = peak; p["last_chg"] = last
        if do:
            print(f"SELL {p['symbol']}: {why}")
            closed, method, srep = close_position(addr, strat_open_ids)
            if closed:
                time.sleep(6)
                my_sell = latest_sell(addr, p["opened_ts"])
                # AI 賣走 NATIVE: report 的 output_amount(ETH) 是鏈上實收 → 最可信記帳
                got_eth = float((srep or {}).get("output_amount","0") or 0)/ETH_DECIMALS if method == "swap" else 0
                if got_eth and my_sell:
                    # 鏈上 ETH 實收 × ep = 純 USD，零單位風險
                    settle(s, addr, p, my_sell, why, method, native_eth_out=got_eth)
                    del s["positions"][addr]
                    print(f"  closed via {method}")
                elif my_sell and settle(s, addr, p, my_sell, why, method):
                    del s["positions"][addr]
                    print(f"  closed via {method}")
                else:
                    s.setdefault("pending_close", []).append(
                        {"address": addr, "symbol": p["symbol"], "method": method, "since": time.time(),
                         "entry_usd": p.get("entry_usd") or p.get("alloc_usd"),
                         "entry_quote_qty": p.get("entry_quote_qty"),
                         "gas_usd": p.get("gas_usd")})
                    del s["positions"][addr]
            else:
                print("  SELL FAILED — retry next tick")

    # ---- entries ----
    gas = gas_eth() or 0
    available = gas - MIN_GAS_ETH
    if available > 0 and len(s["positions"]) < MAX_OPEN:
        toks = fetch_trending()
        # gas 節流: 最近 1 小時有開過倉就不掃新倉 (19筆 gas 18.48u = 78% 虧損, 頻率就是成本)
        open_ts = [p.get("opened_ts") or 0 for p in s["positions"].values()]
        last_buy_ts = max(open_ts) if open_ts else (s["closed"][-1].get("_buy_ts", 0) if s["closed"] else 0)
        if last_buy_ts > time.time() - 3600:
            return
        for t in toks[:30]:
            if len(s["positions"]) >= MAX_OPEN: break
            addr = t["address"]
            if addr in s["positions"] or s["seen"].get(addr): continue
            score, rej, snap = entry_score(t, token_info(addr), toks)
            # agent_log: 每個掃過的幣都留一條評估紀錄（供審計頁顯示, schema 同 paper）
            sym0 = t.get("symbol", "?")
            s.setdefault("agent_log", []).append({
                "token": sym0, "ts": time.time(),
                "agent": "SCANNER",
                "verdict": "veto" if rej else ("approve" if score >= 5 else "hold"),
                "score": score,
                "reason": rej or f"score={score} liq={int((t.get('liquidity') or 0)/1000)}k mc={int((t.get('market_cap') or 0)/1000)}k holders={t.get('holder_count') or 0}"})
            if len(s["agent_log"]) > 400: s["agent_log"] = s["agent_log"][-400:]  # 防爆檔
            if rej or score < 5:  # gas 佔總虧損78%, 減頻率=直接止血 (19筆gas 18.48u)
                if rej: s["seen"][addr] = time.time()  # 被閘門擋的也記，48h 內不重查
                continue
            alloc_usd = min(PER_TRADE, s["equity_usd"] * 0.5, available * ep * 0.90)  # score 加碼移除: 未驗證, 50筆後再評
            if alloc_usd < 2.5: break
            alloc_eth = alloc_usd / ep
            # 條件單只掛 SL 保命（賣出所得經 GMGN 託管會卡 quote 幣, 實測 PARKER/QC）
            # TP 不掛 — 由 AI judge_exit 主動 swap --output-token NATIVE 保證 ETH 回錢包
            conditions = [
                {"order_type": "loss_stop", "side": "sell", "price_scale": "40", "sell_ratio": "100"},
            ]
            sym = t.get("symbol", "?")
            # 進場前最後確認: 1m kline 當下動能（復盤: 接刀組全爆, PARKER/HORSE/INCGPRO）
            ks_now = klines_res(t["address"], "1m")
            recent = ks_now[-5:] if ks_now else []
            if recent:
                closes = [float(b["close"]) for b in recent]
                drop5 = closes[-1]/closes[0] - 1
                red = sum(1 for i in range(1,len(closes)) if closes[i] < closes[i-1])
                if drop5 < -0.06 or (len(recent) >= 4 and red >= 4):
                    print(f"SKIP {sym}: 進場當下動能壞 (5m {drop5*100:+.1f}%, 紅K {red}/4)")
                    s["seen"][addr] = time.time()
                    continue
            print(f"BUY {sym} ${alloc_usd:.2f} score={score}")
            ok, rep, oid = swap_and_confirm(NATIVE, t["address"], amount_eth=alloc_eth,
                                            condition_orders=conditions)
            if not ok:
                s["seen"][addr+":fail"] = s["seen"].get(addr+":fail", 0) + 1
                if s["seen"][addr+":fail"] >= 3: s["seen"][addr] = time.time()
                continue
            time.sleep(6)
            my_buy = latest_buy(addr)
            for _retry in range(3):  # activity 入庫可能延遲，重試 3 次
                if my_buy: break
                time.sleep(5)
                my_buy = latest_buy(addr)
            # 記帳: 鏈上 tx value 是唯一真相（GMGN buy_cost_usd 實測虛高 ~8.6%）
            spent_eth = int(rep.get("input_amount","0"))/ETH_DECIMALS
            buy_cost_usd = spent_eth * ep
            quote_qty = float((my_buy or {}).get("quote_amount") or 0)
            s["seen"][addr] = time.time()
            s["positions"][addr] = {
                "symbol": sym, "entry_eth": int(rep.get("input_amount","0"))/ETH_DECIMALS,
                "alloc_usd": buy_cost_usd, "entry_usd": buy_cost_usd, "entry_ep": ep, "gas_usd": float((my_buy or {}).get("gas_usd") or 0),
                "token_amount": int(rep.get("output_amount","0")),
                "token_decimals": int(rep.get("output_token_decimals","18") or 18),
                "opened_ts": time.time(), "score": score, "snap": snap, "tx_in": oid,
                "entry_quote_qty": quote_qty,
                "custody": "escrow",  # 帶條件單開倉 = 幣在託管
                "conditions": conditions, "peak_chg": 0, "last_chg": 0}
            s["equity_usd"] -= buy_cost_usd + float((my_buy or {}).get("gas_usd") or 0)  # buy gas 也是現金流

    # ---- snapshot 盤點 ----
    total, lines = snapshot(s, acts_map, strat_open_ids)
    book_total = s["equity_usd"] + sum((p.get("alloc_usd") or 0) for p in s["positions"].values())
    if abs(total - book_total) > 2.0:  # 容忍 ETH 價波動造成的估值漂移
        print(f"  [WARN] 帳本總資產 ${book_total:.2f} vs 鏈上盤點 ${total:.2f} 差 ${total-book_total:+.2f}")
    s["equity_onchain"] = round(total, 2)
    save(s)
    print(f"{datetime.now():%m-%d %H:%M} LIVE onchain=${total:.2f} book=${s['equity_usd']:.2f} "
          f"gas={gas:.5f} open={len(s['positions'])} closed={len(s['closed'])}")
    for l in lines[1:]: print(l)

def strategy_open_ids_all():
    ids = {}
    try:
        d = gm("order", "strategy", "list", "--chain", CHAIN, "--group-tag", "STMix")
        for o in (d.get("list") or []):
            if o.get("status") == "open":
                ids[(o.get("base_token") or "")] = o.get("order_id")
    except Exception:
        pass
    return ids

def latest_buy(addr):
    try:
        act = gm("portfolio", "activity", "--chain", CHAIN, "--wallet", WALLET)
        for a in (act.get("activities") or []):
            if a.get("event_type") == "buy" and (a.get("token") or {}).get("address") == addr:
                return a
    except Exception:
        pass
    return None

def latest_sell(addr, since_ts):
    try:
        act = gm("portfolio", "activity", "--chain", CHAIN, "--wallet", WALLET)
        for a in (act.get("activities") or []):
            if a.get("event_type") == "sell" and (a.get("token") or {}).get("address") == addr \
               and a.get("timestamp", 0) >= since_ts:
                return a
    except Exception:
        pass
    return None

def reduce_position(s, addr, p, sells):
    """(#6) TP1 半倉: 有 sell 但餘額>0 → 已賣部分記帳 + 按比例縮剩餘倉"""
    a = sells[-1]
    tx = (a.get("tx_hash") or "")[:64]
    if tx and tx in s["settled_txs"]:
        return  # 這筆已記過
    # 已賣部分: 按賣出量對應的成本記帳
    orig = float(p.get("token_amount") or 0)
    sold_qty = float(a.get("token_amount") or 0) * (10 ** int(p.get("token_decimals", 18) or 18))  # activity 人類可讀 → raw
    if not sold_qty or not orig:
        return
    ratio = min(1.0, sold_qty / orig)
    # 先把已賣部分 settle（成本按比例）
    p_part = dict(p)
    p_part["alloc_usd"] = p["alloc_usd"] * ratio
    p_part["gas_usd"] = (p.get("gas_usd") or 0) * ratio
    p_part["entry_quote_qty"] = (p.get("entry_quote_qty") or 0) * ratio  # 半倉對應半份 quote
    p_part["token_amount"] = int(orig * ratio)  # 半倉對應半份幣量（settle 算單價用）
    settle(s, addr, p_part, a, "TP partial fill", "cond")
    # 縮剩餘倉
    p["alloc_usd"] = round(p["alloc_usd"] * (1 - ratio), 4)
    p["token_amount"] = int(orig - sold_qty)
    p["gas_usd"] = round((p.get("gas_usd") or 0) * (1 - ratio), 4)
    p["tp1_filled"] = True
    p["custody"] = "wallet" if (token_balance_raw(addr) or 0) > 0 else p.get("custody")
    print(f"  {p['symbol']} TP partial ({ratio*100:.0f}% sold), 剩餘倉位已縮減")

def monitor_tick():
    s = load()
    if not s["positions"] and not s.get("pending_close"):
        return
    acts_map = fetch_activities_map(fetch_activity())
    strat_open_ids = strategy_open_ids_all()
    # 條件單成交 + pending 補記（同 tick 邏輯，抽共用）
    for addr in list(s["positions"]):
        p = s["positions"][addr]
        sells = [a for a in acts_map.get(addr, {}).get("sells", []) if a.get("timestamp",0) > p["opened_ts"]]
        custody = check_custody(s, addr, p, strat_open_ids, sells)
        p["custody"] = custody
        bal = token_balance_raw(addr)
        if sells and not bal:
            a = sells[-1]
            tx = (a.get("tx_hash") or "")[:64]
            already = tx in s["settled_txs"]
            # 防誤刪: sell 量 < 倉位 90% = 部分賣出（cancel 後餘額暫時 0 的空窗也會走到這）
            sold_qty = float(a.get("token_amount") or 0) * (10 ** int(p.get("token_decimals", 18) or 18))
            held_qty = float(p.get("token_amount") or 0)
            if held_qty and sold_qty < held_qty * 0.9:
                print(f"  {p['symbol']} sell 是部分賣出 ({sold_qty:.0f}/{held_qty:.0f}) — 不刪倉, 等 cancel 完成")
                continue
            settle(s, addr, p, a, "condition order filled", "cond")
            if not already:  # 新入帳才刪倉; 已記過的 tx 代表倉已被處理過, 重新確認餘額
                del s["positions"][addr]
            continue
        if sells and bal:
            reduce_position(s, addr, p, sells)
            continue
        if custody == "unknown":
            continue
        do, why, peak, last = judge_exit(p, token_info(addr), addr)
        p["peak_chg"] = peak; p["last_chg"] = last
        if do:
            print(f"SELL {p['symbol']}: {why}")
            closed, method, srep = close_position(addr, strat_open_ids)
            if closed:
                time.sleep(6)
                my_sell = latest_sell(addr, p["opened_ts"])
                got_eth = float((srep or {}).get("output_amount","0") or 0)/ETH_DECIMALS if method == "swap" else 0
                if got_eth and my_sell:
                    settle(s, addr, p, my_sell, why, method, native_eth_out=got_eth)
                    del s["positions"][addr]
                    print(f"  closed via {method}")
                elif my_sell:
                    tx2 = (my_sell.get("tx_hash") or "")[:64]
                    already2 = tx2 in s["settled_txs"]
                    if settle(s, addr, p, my_sell, why, method) and not already2:
                        del s["positions"][addr]
                        print(f"  closed via {method}")
                else:
                    s.setdefault("pending_close", []).append(
                        {"address": addr, "symbol": p["symbol"], "method": method, "since": time.time(),
                         "entry_usd": p.get("entry_usd") or p.get("alloc_usd"),
                         "entry_quote_qty": p.get("entry_quote_qty"),
                         "gas_usd": p.get("gas_usd")})
                    del s["positions"][addr]
            else:
                print("  SELL FAILED — retry next minute")
    # 孤兒幣偵測: 錢包有 meme 幣餘額但 state 無倉 = 帳務斷裂, 告警
    try:
        d = gm("portfolio", "token-balance", "--chain", CHAIN, "--wallet", WALLET)
        for b in (d.get("balances") or []):
            taddr = (b.get("token_address") or "").lower()
            if not taddr or taddr == NATIVE: continue
            balv = float(b.get("balance") or 0)
            if balv > 0 and taddr not in s["positions"]:
                print(f"  [ORPHAN] 錢包有 {taddr[:12]}... {balv:.0f} 顆但 state 無倉 — 需人工查!")
    except Exception:
        pass
    # pending 補記
    for pc in list(s.get("pending_close", [])):
        age_h = (time.time() - pc.get("since", 0)) / 3600
        a = latest_sell(pc["address"], pc["since"] - 600)
        if not a and age_h > 2 and not any(c["symbol"] == pc["symbol"] and c["time"] > datetime.now(timezone.utc).isoformat(timespec="minutes")[:13] for c in s["closed"]):
            print(f"  [STALE-PENDING] {pc['symbol']} 掛 {age_h:.1f}h 無法補記(activity漏) — 手動確認")  # Oilinu 型漏帳告警
        if a:
            # 倉已刪，用 activity buy_cost 當成本
            p_ref = {"symbol": pc.get("symbol","?"), "alloc_usd": pc.get("entry_usd") or float(a.get("buy_cost_usd") or 0),
                     "gas_usd": pc.get("gas_usd") or 0,
                     "entry_quote_qty": pc.get("entry_quote_qty")}
            if settle(s, pc["address"], p_ref, a, "late reconcile", pc["method"]):
                s["pending_close"].remove(pc)
                pnl_pct = round((float(a.get("cost_usd") or 0) - p_ref["alloc_usd"]) / p_ref["alloc_usd"] * 100, 1) if p_ref["alloc_usd"] else 0
                print(f"  [RECONCILE] {pc['symbol']} ~{pnl_pct:+.1f}%")
    # 盤點
    total, lines = snapshot(s, acts_map, strat_open_ids)
    s["equity_onchain"] = round(total, 2)
    save(s)
    for addr, p in s["positions"].items():
        print(f"  {p['symbol']}: {p.get('last_chg',0)*100:+.1f}% (peak {p.get('peak_chg',0)*100:+.0f}%) custody={p.get('custody')}")

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

_KLINE_CACHE = {}
def klines_res(addr, resolution="1m"):
    key = (addr, resolution)
    hit = _KLINE_CACHE.get(key)
    if hit and time.time() - hit[0] < 25:
        return hit[1]
    try:
        d = gm("market", "kline", "--chain", CHAIN, "--address", addr, "--resolution", resolution)
        ks = d.get("list") or []
        _KLINE_CACHE[key] = (time.time(), ks)
        return ks
    except Exception:
        return (hit[1] if hit else [])

if __name__ == "__main__":
    with BotLock():
        if "--set" in sys.argv:
            # 手動修帳入口: 在 fcntl 鎖內改 state, 防止和 cron save 互相覆蓋
            payload = json.loads(sys.argv[sys.argv.index("--set")+1])
            s = load()
            s.update(payload)
            save(s)
            print("state updated:", list(payload.keys()))
        elif "--monitor" in sys.argv:
            monitor_tick()
        else:
            tick()