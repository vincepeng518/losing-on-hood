#!/usr/bin/env python3
"""paper_sim.py — Robinhood Chain meme coin swap simulator.

Simulates real-world friction that live trading hits:
  1. Slippage: proportional to trade size vs liquidity (AMM constant-product model)
  2. Trading fee: GMGN takes 1% swap fee (robinhood chain)
  3. Gas: buy ~$0.30, sell ~$0.40 (incl. SL order creation if attached)
  4. Execution delay: 3-15s random latency between decision and fill
  5. Fill failure: 8% chance of swap fail (like real GMGN API), retried next tick
  6. Price impact: uses real kline prices, large orders move price

State: paper_state.json (independent from live state.json)
"""
import json, os, time, random, math

PAPER_STATE = "/root/rh_live/paper_trade/paper_state.json"
CHAIN_GMGN_FEE = 0.01       # 1% GMGN swap fee
SLIPPAGE_BASE = 0.005       # 0.5% base slippage on small trades
SLIPPAGE_LIQ_FACTOR = 0.35  # slippage scaling vs liquidity
GAS_BUY = 0.30
GAS_SELL = 0.40
GAS_SL_ORDER = 0.15         # extra for SL order creation
FAIL_RATE = 0.08            # 8% swap fail chance
LATENCY_RANGE = (3, 15)     # seconds between decision and fill
MAX_POS = 4

# ================= AMM slippage model =================
def calc_slippage(trade_usd, liquidity_usd):
    """Constant-product AMM slippage approximation.
    For a pool with liquidity L (both sides ~L/2 each), buying with amount X:
      price impact ≈ X / (L/2 + X) ... simplified
    Real meme coin slippage on $5-8 orders in $30k+ pools ≈ 0.3-2%.
    """
    if liquidity_usd <= 0:
        return 0.99  # no liquidity, effectively cannot fill
    # effective pool half-side
    half = liquidity_usd / 2
    impact = trade_usd / (half + trade_usd)
    # scale: real-world $6 order in $30k liq gives ~0.4% -> factor tuning
    slip = impact * SLIPPAGE_LIQ_FACTOR * 100
    return min(slip + SLIPPAGE_BASE * 100, 15.0)  # cap 15%

# ================= fill price =================
def fill_price(mid_price, trade_usd, liquidity_usd, side="buy"):
    """Return (exec_price, slippage_pct). Buy = worse (higher), sell = worse (lower)."""
    slip_pct = calc_slippage(trade_usd, liquidity_usd)
    if side == "buy":
        exec_px = mid_price * (1 + slip_pct / 100)
    else:
        exec_px = mid_price * (1 - slip_pct / 100)
    return exec_px, slip_pct

# ================= swap execution (paper) =================
def paper_swap(side, token_addr, symbol, mid_price, liquidity_usd, amount_usd,
               token_amount_held=0, token_decimals=18):
    """Simulate a swap. Returns dict:
       ok / exec_price / slip_pct / fee_usd / gas_usd / token_amount / eth_out / fail_reason
    """
    # random fail
    if random.random() < FAIL_RATE:
        return {"ok": False, "fail_reason": random.choice([
            "HTTP 400 GEvmInvalidArgument",
            "swap timeout (order stuck)",
            "slippage exceeded (price moved)",
            "insufficient liquidity",
        ])}
    # latency
    latency = random.uniform(*LATENCY_RANGE)
    time.sleep(min(latency, 2))  # real sleep capped at 2s for demo; full latency logged
    # price may have moved during latency (random walk ~ ±1.5%)
    drift = random.gauss(0, 0.015)
    mid_after = mid_price * (1 + drift)
    exec_px, slip_pct = fill_price(mid_after, amount_usd, liquidity_usd, side)
    fee_usd = amount_usd * CHAIN_GMGN_FEE
    gas_usd = GAS_BUY if side == "buy" else GAS_SELL
    if side == "buy":
        net_usd = amount_usd - fee_usd
        tokens = net_usd / exec_px
        return {"ok": True, "exec_price": exec_px, "mid_price": mid_after,
                "slip_pct": round(slip_pct, 3), "fee_usd": round(fee_usd, 4),
                "gas_usd": gas_usd, "tokens": tokens, "latency_s": round(latency, 1),
                "drift_pct": round(drift * 100, 2)}
    else:
        gross_usd = token_amount_held * exec_px
        net_usd = gross_usd - fee_usd
        return {"ok": True, "exec_price": exec_px, "mid_price": mid_after,
                "slip_pct": round(slip_pct, 3), "fee_usd": round(fee_usd, 4),
                "gas_usd": gas_usd, "usd_out": net_usd,
                "gross_usd": gross_usd, "latency_s": round(latency, 1),
                "drift_pct": round(drift * 100, 2)}

# ================= paper state =================
def load_paper():
    if os.path.exists(PAPER_STATE):
        return json.load(open(PAPER_STATE))
    return {
        "start_equity": 100.0,
        "cash_usd": 100.0,
        "positions": {},
        "closed": [],
        "agent_log": [],       # 5-agent discussion trail
        "events": [],          # real-time event feed for dashboard
        "created": time.time(),
    }

def save_paper(s):
    os.makedirs(os.path.dirname(PAPER_STATE), exist_ok=True)
    with open(PAPER_STATE + ".tmp", "w") as f:
        json.dump(s, f, indent=1)
        f.flush(); os.fsync(f.fileno())
    os.replace(PAPER_STATE + ".tmp", PAPER_STATE)

def add_event(s, kind, msg, data=None):
    """Dashboard event feed. kind: agent/buy/sell/veto/error/info"""
    s["events"].append({
        "ts": time.time(),
        "kind": kind,
        "msg": msg,
        "data": data or {},
    })
    # cap 500 events
    if len(s["events"]) > 500:
        s["events"] = s["events"][-500:]

def add_agent_log(s, agent, token, verdict, score, reason):
    """5-agent discussion trail. agent: scanner/narrative/risk/sniper/judge"""
    s["agent_log"].append({
        "ts": time.time(),
        "agent": agent,
        "token": token,
        "verdict": verdict,   # approve/veto/neutral
        "score": score,
        "reason": reason,
    })
    if len(s["agent_log"]) > 1000:
        s["agent_log"] = s["agent_log"][-1000:]
