# rh_live 狀態 — v2 已上線（2026-09-01 15:38）

審核 5 項全部修復並實測：
1. swap_and_confirm 輪詢 confirmed 才記帳 ✓（首筆 HOUND 已驗證 entry_eth 與鏈上扣款一致）
2. 條件單 schema 修正：price_scale = 跌幅%/增益%（SL "35"、TP "80"）
3. 賣出用 report 實際 ETH 記帳
4. fcntl 程序鎖 + seen 只在 confirmed 後寫 + state 原子寫入
5. 出場 = paper bot2.py judge_exit 完整搬移（AI 判斷），條件單降級為硬保險
6. gas 摩擦：roundtrip ~$0.60 → TP 80%/peak 50%/stale 12h，減少小賺出場

cron: 9c10bfb07de6 (rh-live-monitor, every 5m)
參數：8u/倉、3 倉、gas 保留 0.002 ETH、--gas-price 0.5（EVM swap 必帶）
停損鏈條：條件單 -35% 硬保險 → judge_exit 災難 -50% → flow collapse 即時砍