#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""決策快照 SQLite 存儲 — 只記錄，不碰交易邏輯。
任何 DB 錯誤 print 後吞掉返回 None/[]，絕不讓存檔失敗炸掉 bot tick。
連線每次開關，不長連。
"""
import json
import os
import sqlite3
import time

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "decisions.db")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    bot TEXT NOT NULL,
    token_address TEXT NOT NULL,
    symbol TEXT NOT NULL,
    phase TEXT NOT NULL,
    features TEXT,
    outcome TEXT
);
CREATE INDEX IF NOT EXISTS idx_decisions_bot_ts ON decisions(bot, ts);
CREATE INDEX IF NOT EXISTS idx_decisions_addr ON decisions(token_address);
"""


def _connect():
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _ensure(conn):
    conn.executescript(_SCHEMA)


def _dbg(tag, exc):
    print(f"[snapshot_store] {tag} failed: {exc}")


def save_decision(bot, token_address, symbol, phase, features):
    """寫入一筆決策快照，回傳新 id（失敗回 None）。features 可為 dict 或 JSON 字串。"""
    conn = None
    try:
        if isinstance(features, (dict, list)):
            features = json.dumps(features, ensure_ascii=False)
        ts = int(time.time())
        conn = _connect()
        _ensure(conn)
        cur = conn.execute(
            "INSERT INTO decisions (ts, bot, token_address, symbol, phase, features, outcome)"
            " VALUES (?, ?, ?, ?, ?, ?, NULL)",
            (ts, bot, token_address, symbol, phase, features),
        )
        conn.commit()
        return cur.lastrowid
    except Exception as exc:
        _dbg("save_decision", exc)
        return None
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


def settle_decision(id, outcome):
    """結算：把 outcome（dict 或 JSON 字串）寫進指定列。成功 True，失敗 None/False。"""
    conn = None
    try:
        if isinstance(outcome, (dict, list)):
            outcome = json.dumps(outcome, ensure_ascii=False)
        conn = _connect()
        _ensure(conn)
        cur = conn.execute(
            "UPDATE decisions SET outcome = ? WHERE id = ?", (outcome, id)
        )
        conn.commit()
        return cur.rowcount > 0
    except Exception as exc:
        _dbg("settle_decision", exc)
        return None
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


def _row_to_dict(row):
    d = {
        "id": row[0], "ts": row[1], "bot": row[2],
        "token_address": row[3], "symbol": row[4], "phase": row[5],
    }
    for key, col in (("features", 6), ("outcome", 7)):
        try:
            d[key] = json.loads(row[col]) if row[col] else None
        except Exception:
            d[key] = row[col]
    return d


def load_pending(bot):
    """載入該 bot 所有未結算（outcome IS NULL）的決策。失敗回 []。"""
    conn = None
    try:
        conn = _connect()
        _ensure(conn)
        rows = conn.execute(
            "SELECT id, ts, bot, token_address, symbol, phase, features, outcome"
            " FROM decisions WHERE bot = ? AND outcome IS NULL ORDER BY ts",
            (bot,),
        ).fetchall()
        return [_row_to_dict(r) for r in rows]
    except Exception as exc:
        _dbg("load_pending", exc)
        return []
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


def stats(days=1):
    """近 N 天統計：各 bot 的總筆數/已結算/未結算/勝率/平均 pnl_pct。失敗回 {}。"""
    conn = None
    try:
        since = int(time.time()) - int(days) * 86400
        conn = _connect()
        _ensure(conn)
        rows = conn.execute(
            "SELECT bot, outcome FROM decisions WHERE ts >= ?", (since,)
        ).fetchall()
        result = {}
        for bot, outcome in rows:
            s = result.setdefault(bot, {"total": 0, "settled": 0, "pending": 0,
                                        "wins": 0, "avg_pnl_pct": None})
            s["total"] += 1
            if outcome:
                s["settled"] += 1
                try:
                    oc = json.loads(outcome)
                    pnl = oc.get("pnl_pct")
                    if pnl is not None:
                        s.setdefault("_pnls", []).append(float(pnl))
                        if float(pnl) > 0:
                            s["wins"] += 1
                except Exception:
                    pass
            else:
                s["pending"] += 1
        for s in result.values():
            pnls = s.pop("_pnls", [])
            settled = s["settled"]
            if settled:
                s["win_rate"] = round(s["wins"] / settled, 4)
                s["avg_pnl_pct"] = round(sum(pnls) / len(pnls), 4) if pnls else None
            else:
                s["win_rate"] = None
        return result
    except Exception as exc:
        _dbg("stats", exc)
        return {}
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


if __name__ == "__main__":
    # round-trip 自驗：save → settle → stats
    did = save_decision("paper", "0xTestAddr123", "TEST", "entry_meeting",
                        {"mc": 100000, "liq": 50000, "holders": 120,
                         "top10": 22.5, "smart": 2, "smb": 1,
                         "drop5": -3.1, "red": 0, "verdict": "BUY", "total_score": 7.5,
                         "meeting": [{"agent": "liquidity", "verdict": "YES",
                                      "score": 8, "reason": "liq ok"}]})
    print("save_decision id:", did)
    print("settle:", settle_decision(did, {"pnl_usd": 12.3, "pnl_pct": 4.56,
                                           "peak": 9.9, "held_min": 34,
                                           "exit_reason": "tp"}))
    print("pending:", load_pending("paper"))
    print("stats:", stats(days=1))
