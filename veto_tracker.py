#!/usr/bin/env python3
import argparse, json, os, sqlite3, sys, time

ROOT = os.path.dirname(os.path.abspath(__file__))
PAPER = os.path.join(ROOT, 'paper_trade')
DB_PATH = os.path.join(PAPER, 'decisions.db')

def _get_grok_bot_functions():
    sys.path.insert(0, ROOT)
    from grok_bot import klines_res, CHAIN, gm
    return klines_res, gm, CHAIN

def _connect():
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def _get_veto_rows(conn):
    return conn.execute(
        "SELECT id, ts, token_address, symbol, features, outcome FROM decisions "
        "WHERE phase='entry_meeting' AND outcome IS NULL"
    ).fetchall()

def _parse_features(features):
    try:
        if isinstance(features, str): return json.loads(features)
        if isinstance(features, (dict, list)): return features
    except Exception: pass
    return {}

def _get_veto_price(features):
    p = _parse_features(features)
    if 'price' in p: return float(p['price'])
    # Try kline snapshot
    snap = p.get('kline_snap')
    if snap and isinstance(snap, list) and len(snap) > 0:
        try: return float(snap[0].get('close', 0))
        except Exception: pass
    return None

def _get_current_price(klines_res, addr, veto_ts):
    ks = klines_res(addr, "1h")
    if not ks: return None
    after = [k for k in ks if k.get('time', 0)//1000 >= veto_ts - 60]
    if not after: return None
    try: return float(after[-1].get('close', 0))
    except Exception: return None

def _get_fail_count(outcome_json):
    if not outcome_json: return 0
    try: return json.loads(outcome_json).get('price_fail_count', 0)
    except: return 0

def run_tracker():
    print(f"--- VETO TRACKER RUN {time.strftime('%Y-%m-%d %H:%M:%S')} ---")
    klines_res, _, _ = _get_grok_bot_functions()
    conn = _connect()
    rows = _get_veto_rows(conn)
    
    stats = {'tracking': 0, 'finalized': 0, 'pnls': []}
    
    for row in rows:
        id, ts, addr, sym, features, outcome = row
        now = time.time()
        
        # Check if 24h passed
        if now - ts >= 86400:
            # Check if already has outcome
            if outcome:
                try: stats['finalized'] += 1
                except: pass
                continue
        
        # Calculate
        veto_px = _get_veto_price(features)
        now_px = _get_current_price(klines_res, addr, ts)
        
        if veto_px is None or now_px is None or veto_px == 0:
            # Price fail
            fail_count = _get_fail_count(outcome) + 1
            new_outcome = {'virtual': True, 'price_fail': True, 'price_fail_count': fail_count}
            if fail_count >= 3:
                new_outcome['finalized'] = True
            conn.execute("UPDATE decisions SET outcome=? WHERE id=?", (json.dumps(new_outcome), id))
            stats['tracking'] += 1
            continue
            
        pnl = (now_px - veto_px) / veto_px * 100
        new_outcome = {
            'virtual': True,
            'virtual_pnl_pct': round(pnl, 2),
            'checked_ts': int(now)
        }
        
        if now - ts >= 86400:
            new_outcome['finalized'] = True
            stats['finalized'] += 1
        else:
            stats['tracking'] += 1
            
        stats['pnls'].append(pnl)
        conn.execute("UPDATE decisions SET outcome=? WHERE id=?", (json.dumps(new_outcome), id))
        
    conn.commit()
    conn.close()
    
    avg_pnl = round(sum(stats['pnls'])/len(stats['pnls']), 2) if stats['pnls'] else 0
    print(f"STATS: tracking={stats['tracking']}, finalized={stats['finalized']}, avg_pnl={avg_pnl}%")

if __name__ == "__main__":
    run_tracker()
