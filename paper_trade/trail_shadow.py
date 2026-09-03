#!/usr/bin/env python3
"""trail_shadow.py — 移動停利影子模擬器（2026-09-03）

目的：不移動 paper_bot 的實際出場邏輯，另闢影子帳本，對每筆已開倉的 paper 倉位
同步模擬「如果當時有移動停利（+30% 啟動 / 回撤 65% 保底鎖利）」的出場結果。
每 5 分鐘由 cron 跑一次，輸出 /root/rh_live/paper_trade/trail_shadow.json + jsonl 逐筆紀錄。

規則（與 dashboard 回測線一致）：
  - peak_pct >= 30 啟動追蹤
  - 觸發線 = peak*0.65（回撤跌破保底即出場，理想成交=觸發價）
  - 另記錄 slip-adjusted 版本（1m spike 實證折價 -15pp，取保守值）

誠實聲明：shadow 模擬基於 1m K 線 high/low，粒度粗於實際挂單；結果僅供對照，
不是可執行績效。累積 >=30 筆對照樣本前不做任何參數結論。
"""
import sys, os, time, json
sys.path.insert(0, "/root/rh_live")
sys.path.insert(0, "/root/rh_live/paper_trade")

from paper_sim import load_paper
from grok_bot import klines_res

STATE_FILE = "/root/rh_live/paper_trade/trail_shadow.json"
LOG_FILE = "/root/rh_live/paper_trade/trail_shadow_log.jsonl"
TRAIL_ON = 30.0    # peak>=30% 啟動
LOCK_RATIO = 0.65  # 回撤至 peak*65% 鎖利
SLIP_DISCOUNT_PP = 15  # spike 滑價折減（百分點，保守值）

def load_shadow():
    try:
        return json.load(open(STATE_FILE))
    except Exception:
        return {"tracked": {}, "closed": []}

def save_shadow(sh):
    tmp = STATE_FILE + ".tmp"
    json.dump(sh, open(tmp, "w"))
    os.replace(tmp, STATE_FILE)

def shadow_tick():
    s = load_paper()
    sh = load_shadow()
    positions = s.get("positions", {})
    now = time.time()

    # 1. 同步新倉位進 shadow 追蹤
    for addr, p in positions.items():
        if addr not in sh["tracked"]:
            sh["tracked"][addr] = {
                "symbol": p["symbol"], "entry_price": p["entry_price"],
                "alloc_usd": p.get("alloc_usd"), "opened_ts": p.get("opened_ts"),
                "trail_armed": False, "peak_run": 0.0, "shadow_exit": None,
            }

    # 2. 逐倉評估 shadow 移動停利（用 1m K 線逐根回放自上次檢查點以來的走勢）
    for addr in list(sh["tracked"].keys()):
        t = sh["tracked"][addr]
        if t.get("shadow_exit"):
            continue
        ep = t["entry_price"]
        if not ep:
            continue
        try:
            ks = klines_res(addr, "1m")
        except Exception:
            continue
        if not ks:
            continue
        last_check = t.get("last_kline_ts") or (t.get("opened_ts") or now) - 60
        after = [b for b in ks if b["time"] > last_check]
        if not after:
            continue
        for b in after:
            hi_pct = (float(b["high"]) / ep - 1) * 100
            lo = float(b["low"])
            t["peak_run"] = max(t["peak_run"], hi_pct)
            t["last_kline_ts"] = b["time"]
            if not t["trail_armed"] and t["peak_run"] >= TRAIL_ON:
                t["trail_armed"] = True
            if t["trail_armed"]:
                lock_pct = t["peak_run"] * LOCK_RATIO
                lock_price = ep * (lock_pct / 100 + 1)
                if lo <= lock_price:
                    t["shadow_exit"] = {
                        "time": b["time"], "lock_pct": round(lock_pct, 1),
                        "peak_pct": round(t["peak_run"], 1),
                        "slip_adj_pct": round(lock_pct - SLIP_DISCOUNT_PP, 1),
                        "armed_min": round((b["time"] - t["opened_ts"]) / 60, 1),
                    }
                    break

    # 3. 實盤(paper)已平倉的，把對照結果歸檔到 closed log
    closed_syms = {c.get("address"): c for c in s.get("closed", [])}
    for addr, t in list(sh["tracked"].items()):
        real = closed_syms.get(addr)
        if not real:
            continue
        se = t.get("shadow_exit")
        rec = {
            "ts": now, "symbol": t["symbol"], "alloc_usd": t["alloc_usd"],
            "real_pnl_pct": real.get("pnl_pct"), "real_exit": real.get("exit_reason"),
            "real_peak": real.get("peak"),
            "shadow_exit_pct": (se or {}).get("lock_pct"),
            "shadow_slip_adj_pct": (se or {}).get("slip_adj_pct"),
            "shadow_armed": t.get("trail_armed", False),
        }
        # 模擬 PnL 差額（shadow 觸發才計算）
        if se and t.get("alloc_usd"):
            rec["shadow_pnl_usd"] = round(se["lock_pct"] / 100 * t["alloc_usd"], 2)
            rec["shadow_slip_adj_usd"] = round(se["slip_adj_pct"] / 100 * t["alloc_usd"], 2)
            rec["real_pnl_usd"] = real.get("pnl_usd")
        sh["closed"].append(rec)
        with open(LOG_FILE, "a") as f:
            f.write(json.dumps(rec) + "\n")
        del sh["tracked"][addr]

    save_shadow(sh)
    n_track = len(sh["tracked"])
    n_closed = len(sh["closed"])
    trig = [c for c in sh["closed"] if c.get("shadow_exit_pct") is not None]
    print(f"[trail_shadow] tracked={n_track} closed_pairs={n_closed} "
          f"shadow_triggered={len(trig)}/{n_closed}")

if __name__ == "__main__":
    shadow_tick()