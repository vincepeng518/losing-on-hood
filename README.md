# Losing on Hood — Robinhood Chain Meme 交易機器人

5-agent 決策流水線（scanner → narrative → sniper → judge → risk）的自動交易系統，實盤 + paper 模擬雙軌。

## 架構

```
rh_live/
├── grok_bot.py        # 實盤 bot：5-agent 會議、Referee 票決、swap 下單
├── live_bot.py        # 實盤舊版（v1）
├── veto_tracker.py    # 被 veto 幣的 24h 虛擬 PnL 追蹤（策略優化原料）
├── PREREQUISITES.md   # 部署前置條件
└── paper_trade/
    ├── paper_bot.py       # 模擬 tick（5 分鐘一輪，真實數據模擬成交）
    ├── paper_sim.py       # AMM 滑點 / fee / gas / 8% 失敗率模擬器
    ├── dashboard.html     # 儀表板前端（單檔、繁中、Linear 終端風）
    ├── dashboard_server.py# 儀表板 server（SSR + /api/state + /api/live）
    └── snapshot_store.py  # 決策快照 SQLite（策略學習原料）
```

## 5-Agent 會議

每個候選幣依序過五關，任一 veto 短路：

| Agent | 職責 | 輸出 |
|---|---|---|
| scanner | 蜜罐/流動性/持有者/捆綁買入門檻 | score + rich reason |
| narrative | symbol/name 主題關鍵字比對（L1-L3） | score + 命中關鍵字 |
| sniper | 1m K 線動能（5 根 close 計算） | score + 漲跌幅 |
| judge | 歷史紀錄（同地址/同名虧損次數） | score + 歷史統計 |
| risk | 現金/持倉數/冷卻時間 gate | pass/veto |

全部 approve 且總分 ≥ 門檻才開倉。會議全文（含 veto）存進交易紀錄與決策快照。

## 策略學習閉環（進行中）

1. **決策快照**：每次會議的完整特徵 + meeting 存 SQLite（`snapshot_store.py`）
2. **事後歸因**：被 veto 的幣追蹤 24h 虛擬 PnL（`veto_tracker.py`），累積「如果放行會怎樣」資料
3. **參數優化**：累積樣本後離線回測門檻，walk-forward 驗證才上線

## 儀表板

`dashboard.html` 是自包含單檔前端（無 build、無依賴），`dashboard_server.py` 提供 SSR + 5 秒 poll。特色：

- 模擬倉/實盤雙 tab，960px Grid 雙欄
- 5-agent 決策快照矩陣（每幣會議全文）
- PEAK 高亮、呼吸連線點、防閃爍主題初始化
- 英文 reason → 繁中顯示層翻譯（36 條規則，不動 state 原文）

## 部署

見 `PREREQUISITES.md`。需要 gm CLI（Robinhood chain 介接）。

## License

MIT