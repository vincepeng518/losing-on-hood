#!/usr/bin/env python3
"""paper_bot.py — Paper trading bot. Routes all decisions through 5-agent pipeline,
uses paper_sim for execution. Outputs JSON events for dashboard consumption."""
import sys, os, time, json, math, random, fcntl
sys.path.insert(0, "/root/rh_live")
sys.path.insert(0, "/root/rh_live/paper_trade")

from paper_sim import (load_paper, save_paper, add_event, add_agent_log,
                        paper_swap, calc_slippage, GAS_SL_ORDER,
                        CHAIN_GMGN_FEE, MAX_POS)
import grok_bot
from grok_bot import (gm, Narrative, Risk, Judge, Sniper,
                       fetch_trending, token_info_cached, klines_res,
                       kline_chg, eth_price, NATIVE, ETH_DECIMALS,
                       THRESHOLDS, PER_TRADE)
from grok_bot import Scanner as _LiveScanner

# ================= BOT LOCK =================
PAPER_LOCK = "/tmp/paper_bot.lock"
class PaperLock:
    def __enter__(self):
        self.f = open(PAPER_LOCK, "w")
        try:
            fcntl.flock(self.f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("another tick running, skip"); sys.exit(0)
        return self
    def __exit__(self, *a):
        fcntl.flock(self.f, fcntl.LOCK_UN); self.f.close()


# ---- decision snapshot hooks (log-only; lazy import, never raises) ----
def _save_snap(addr, sym, meeting, s):
    try:
        from snapshot_store import save_decision
        features = {"meeting": meeting, "cash_usd": s.get("cash_usd"),
                    "n_positions": len(s.get("positions", {}))}
        return save_decision('paper', addr, sym, 'entry_meeting', features)
    except Exception as _e:
        print(f"[paper_bot] snapshot save fail: {_e}")
        return None

def _settle_snap(sid, pnl, pnl_pct, peak, held_min, exit_reason):
    try:
        from snapshot_store import settle_decision
        return settle_decision(sid, {"pnl_usd": round(pnl, 2), "pnl_pct": round(pnl_pct, 1),
                                     "peak": round(peak * 100, 1), "held_min": round(held_min, 1),
                                     "exit_reason": exit_reason})
    except Exception as _e:
        print(f"[paper_bot] snapshot settle fail: {_e}")
        return None

# paper Scanner: override _score to not reject creator_close (RH chain dev always sell early)
class Scanner:
    fetch_smb_map = staticmethod(_LiveScanner.fetch_smb_map)
    @staticmethod
    def scan(seen, th=None):
        th = th or THRESHOLDS
        try:
            toks = fetch_trending()[:30]
        except Exception as e:
            print(f"  [Scanner] trending fail: {e}")
            return []
        smb_map = Scanner.fetch_smb_map()
        results = []
        for t in toks:
            addr = (t.get("address") or "")
            if not addr or addr.lower() in seen:
                continue
            score, reason, snap = _LiveScanner._score(t, toks, th, smb_map)
            # paper override: creator_close 不是硬否決
            if score == 0 and reason == "dev sold":
                score = 1  # 給 1 分，讓 narrative/sniper 有機會 override
                reason = "dev sold (paper override)"
            if score > 0:
                results.append({"token": t, "score": score, "snap": snap, "rej": None})
            else:
                results.append({"token": t, "score": 0, "snap": snap, "rej": reason})
        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:10]

# ================= TOKEN INFO (use real data) =================
def get_token_info(addr):
    try:
        return gm("token", "info", "--chain", "robinhood", "--address", addr, timeout=15)
    except:
        return None

# ================= REASON ENRICHERS (paper-side, 不動 grok_bot) =================
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
    last_ts = max(open_ts) if open_ts else (s["closed"][-1]["time"] if s["closed"] else 0)
    since_min = (time.time() - last_ts) / 60 if last_ts else -1
    return (f"risk gate passed: cash=${s['cash_usd']:.2f}, open={open_n}/{MAX_POS}, "
            f"距上次交易 {since_min:.0f} 分鐘 (需>10), 下筆預估 alloc≈${alloc_hint:.2f}")

# ================= MAIN PAPER TICK =================
def paper_tick():
    s = load_paper()
    s.setdefault("seen", {})  # Judge.pre_check / Scanner.scan 需要 seen
    th = dict(THRESHOLDS)
    th["min_scanner"] = 1
    th["min_total_score"] = 7
    th["min_sniper"] = 1
    # paper 沒有 min_narrative 限制（RH chain 幣名多不規則）
    ep = eth_price()

    # ---- exits ----
    for addr in list(s["positions"]):
        p = s["positions"][addr]
        addr_lower = addr.lower()
        info = get_token_info(addr)
        chg, peak = kline_chg(p, addr)  # real kline
        p["peak_chg"] = peak
        p["last_chg"] = chg
        held_min = (time.time() - p["opened_ts"]) / 60
        mid_price = p.get("last_price", 0) or 0

        do_exit, exit_reason, peak, chg = Judge.judge_exit(p, info, addr)
        if do_exit:
            # paper sell
            liq = 30000 + random.randint(-5000, 10000)  # simulated liquidity
            fill = paper_swap("sell", addr, p["symbol"], mid_price, liq,
                              p.get("token_amount", 0) * mid_price,
                              token_amount_held=p.get("token_amount", 0))
            if fill["ok"]:
                pnl = fill["usd_out"] - p["alloc_usd"] - p["gas_usd"] - fill["gas_usd"]
                pnl_pct = pnl / p["alloc_usd"] * 100 if p["alloc_usd"] else 0
                s["cash_usd"] += fill["usd_out"]
                exit_detail = f"EXIT {p['symbol']} {chg*100:+.1f}% (peak +{peak*100:.0f}%) | reason: {exit_reason} | slip={fill['slip_pct']:.1f}% gas=${fill['gas_usd']:.3f} | PnL: {pnl:+.2f} USD ({pnl_pct:+.1f}%)"
                add_event(s, "sell", exit_detail, {
                    "symbol": p["symbol"], "address": addr,
                    "pnl_usd": round(pnl, 2), "pnl_pct": round(pnl_pct, 1),
                    "exit_reason": exit_reason, "peak": round(peak*100, 1),
                    "slip_pct": fill["slip_pct"], "gas_usd": fill["gas_usd"],
                })
                s["closed"].append({
                    "time": time.time(),
                    "symbol": p["symbol"], "address": addr,
                    "alloc_usd": p["alloc_usd"], "pnl_usd": round(pnl, 2),
                    "pnl_pct": round(pnl_pct, 1),
                    "exit_reason": exit_reason, "peak": round(peak*100, 1),
                    "entry_price": p["entry_price"], "exit_price": fill["exec_price"],
                    "slip_pct": fill["slip_pct"], "gas_usd": p["gas_usd"] + fill["gas_usd"],
                    "meeting": p.get("meeting", []),  # 從 position 帶走完整 5-agent 會議紀錄
                })
                del s["positions"][addr]
                _settle_snap(p.get("snap_id"), pnl, pnl_pct, peak, held_min, exit_reason)
            else:
                add_event(s, "error", f"SELL FAIL {p['symbol']}: {fill['fail_reason']}")

    # ---- risk check (paper: 用 paper cash，不用實盤錢包 gas) ----
    gas_ok = s["cash_usd"] > 3.0
    n_open_ok = len(s["positions"]) < MAX_POS
    open_ts = [p.get("opened_ts") or 0 for p in s["positions"].values()]
    last_ts = max(open_ts) if open_ts else (s["closed"][-1]["time"] if s["closed"] else 0)
    time_ok = last_ts < time.time() - 600  # paper 間隔 10 分鐘（加速模擬）
    risk_ok = gas_ok and n_open_ok and time_ok
    risk_why = "" if risk_ok else f"cash=${s['cash_usd']:.2f} open={len(s['positions'])} cooldown={not time_ok}"
    if not risk_ok:
        add_event(s, "veto", f"RISK: {risk_why}")
        save_paper(s)
        return

    # ---- scanner ----
    candidates = Scanner.scan(s.get("seen", {}), th)
    add_event(s, "info", f"Scanner: {len([c for c in candidates if c['score']>0])} candidates")

    # meeting 記錄器：每個 agent 評完就 append，veto 也記（會議可短路）
    executed = False
    for c in candidates:
        if executed: break
        meeting = []  # 每個候選幣的會議都要乾淨起算
        t = c["token"]
        addr = (t.get("address") or "").lower()
        sym = t.get("symbol", "?")
        seen = s.get("seen", {})

        # agent 1: scanner
        sc_verdict = "approve" if c["score"] >= th["min_scanner"] else "veto"
        sc_reason = rich_scanner_reason(c, th)
        add_agent_log(s, "scanner", sym, sc_verdict, c["score"], sc_reason)
        meeting.append({"agent":"scanner","score":c["score"],"verdict":sc_verdict,"reason":sc_reason})
        if c["score"] < th["min_scanner"]:
            seen[addr] = time.time(); continue

        # agent 2: narrative
        narr_score, narr_reason_orig = Narrative.score(t)
        narr_reason = rich_narrative_reason(t, narr_score, narr_reason_orig)
        narr_verdict = "approve" if narr_score >= th["min_narrative"] else "veto"
        add_agent_log(s, "narrative", sym, narr_verdict, narr_score, narr_reason)
        meeting.append({"agent":"narrative","score":narr_score,"verdict":narr_verdict,"reason":narr_reason})
        if narr_score < th["min_narrative"]:
            seen[addr] = time.time(); continue

        # agent 3: sniper (kline check)
        sniper_score, sniper_reason = Sniper.pre_check(t)
        snip_verdict = "approve" if sniper_score >= th["min_sniper"] else "veto"
        add_agent_log(s, "sniper", sym, snip_verdict, sniper_score, sniper_reason)
        meeting.append({"agent":"sniper","score":sniper_score,"verdict":snip_verdict,"reason":sniper_reason})
        if sniper_score < th["min_sniper"]:
            seen[addr] = time.time(); continue

        # agent 4: judge (history)
        judge_score, judge_reason_orig = Judge.pre_check(t, s)
        judge_reason = rich_judge_reason(t, s, judge_score, judge_reason_orig)
        judge_verdict = "approve" if judge_score >= th["min_judge"] else "veto"
        add_agent_log(s, "judge", sym, judge_verdict, judge_score, judge_reason)
        meeting.append({"agent":"judge","score":judge_score,"verdict":judge_verdict,"reason":judge_reason})
        if judge_score < th["min_judge"]:
            seen[addr] = time.time(); continue

        # agent 5: risk (pre-computed above, gate passed)
        alloc_est = min(PER_TRADE, s["cash_usd"] * 0.4, 5.0)
        risk_reason = rich_risk_reason(s, alloc_est)
        add_agent_log(s, "risk", sym, "approve", 0, risk_reason)
        meeting.append({"agent":"risk","score":0,"verdict":"approve","reason":risk_reason})

        total = c["score"] + narr_score + sniper_score + judge_score
        add_event(s, "agent", f"VOTE {sym}: scanner={c['score']} narrative={narr_score} sniper={sniper_score} judge={judge_score} TOTAL={total}")
        # decision snapshot: entry meeting (含 veto/未達標者)
        _snap_id = _save_snap(addr, sym, meeting, s)
        # meeting 已增量建好（含 veto 也有記錄），total 不足則不開倉
        if total < th["min_total_score"]:
            seen[addr] = time.time(); continue

        # paper buy
        alloc_usd = min(PER_TRADE, s["cash_usd"] * 0.4, 5.0)
        if alloc_usd < 2.5:
            break
        mid_price = t.get("price", 0)
        if not mid_price or mid_price <= 0:
            info = get_token_info(addr)
            mid_price = float((info or {}).get("price", {}).get("price", 0) or 0)
            if mid_price <= 0:
                continue
        liq = t.get("liquidity", 30000)
        fill = paper_swap("buy", addr, sym, mid_price, liq, alloc_usd)
        add_event(s, "agent", f"BUY DECISION: {sym} | alloc=${alloc_usd:.2f} | slip={fill.get('slip_pct',0):.2f}%")
        if not fill["ok"]:
            add_event(s, "error", f"BUY FAIL {sym}: {fill['fail_reason']}")
            seen[addr] = time.time()
            continue
        tokens_bought = fill["tokens"]
        total_gas = fill["gas_usd"]
        # SL order creation cost (paper)
        sl_gas = GAS_SL_ORDER
        total_gas += sl_gas
        s["cash_usd"] -= (alloc_usd + total_gas)
        ts_now = time.time()
        s["positions"][addr] = {
            "symbol": sym,
            "entry_price": fill["exec_price"],
            "meeting": meeting,  # 5-agent 進場討論紀錄
            "entry_kline_px": fill["exec_price"],
            "token_amount": tokens_bought,
            "token_decimals": 18,
            "alloc_usd": alloc_usd,
            "opened_ts": ts_now,
            "last_price": fill["exec_price"],
            "peak_chg": 0, "last_chg": 0,
            "entry_eth": 0, "gas_usd": total_gas,
            "snap": c.get("snap"),
            "snap_id": _snap_id,  # decision snapshot DB id for settle
        }
        entry_summary = " | ".join([f"{m['agent']}:{m['score']}" for m in meeting])
        add_event(s, "buy", f"BUY {sym} @ {fill['exec_price']:.8f} | ${alloc_usd:.2f} | slip={fill['slip_pct']:.2f}% gas=${total_gas:.3f} | 理由: {sniper_reason} + {narr_reason} (vote {entry_summary} total={total})", {
            "symbol": sym, "address": addr,
            "entry_price": fill["exec_price"],
            "alloc_usd": alloc_usd,
            "slip_pct": fill["slip_pct"],
            "gas_usd": total_gas,
            "latency": fill.get("latency_s", 0),
            "meeting": meeting,
        })
        s["seen"] = seen
        executed = True

    # update prices
    for addr, p in s["positions"].items():
        try:
            info = get_token_info(addr)
            p["last_price"] = float((info or {}).get("price",{}).get("price",0) or p.get("entry_price",0))
        except:
            pass

    save_paper(s)
    # summary
    n_open = len(s["positions"])
    n_closed = len(s["closed"])
    total_pnl = sum(c["pnl_usd"] for c in s["closed"])
    print(json.dumps({
        "cash": round(s["cash_usd"], 2),
        "open": n_open, "closed": n_closed,
        "total_pnl": round(total_pnl, 2),
        "positions": {a: {"sym": p["symbol"], "last": p.get("last_price",0), "entry": p["entry_price"]}
                     for a, p in s["positions"].items()},
    }))

if __name__ == "__main__":
    with PaperLock:
        paper_tick()
