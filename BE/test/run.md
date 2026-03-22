What's new
1. BinanceCandle table (new)
Added to schema.prisma + pushed to DB. Same as TestCandle but with quoteVolume, trades, and closeTime fields from Binance klines.

2. scripts/fetch-binance.js (new)
Auto-paginates Binance API (max 1000/request) until all data is fetched:

bash
# Fetch 1 year of BTC daily candles
node scripts/fetch-binance.js BTCUSDT 1d 2020-01-01 2021-01-01
# Fetch 6 months of 4h candles
node scripts/fetch-binance.js BTCUSDT 4h 2021-07-01 2022-01-01
Supports all intervals: 1m 3m 5m 15m 30m 1h 2h 4h 6h 8h 12h 1d 3d 1w 1M

3. backtest.js — --table= flag
bash
# Use Binance data (after fetching)
node scripts/backtest.js BTCUSDT 1d 2020-01-01T00:00:00Z 2021-01-01T00:00:00Z 1440 2880 --ai --table=binanceCandle
# Default (existing CSV data)
node scripts/backtest.js BTCUSDT 12h 2020-01-01T00:00:00Z 2021-02-03T00:00:00Z 720 1440 --ai
4. visualizer.html — ⚙️ Data Manager panel
Click the "⚙️ Data Manager" button in the header to:

Select table: TestCandle or BinanceCandle (badge updates in header)
Fetch from Binance: pick symbol + interval + date range → shows progress bar live
Backtest config: set all params + auto-generates the node scripts/backtest.js ... command with "📋 Copy CLI Command"
Recommended first run — fetch 1 year of real Binance BTC data:

bash
node scripts/fetch-binance.js BTCUSDT 1d 2020-01-01 2021-02-01
Then backtest it:

bash
node scripts/backtest.js BTCUSDT 1d 2020-01-01T00:00:00Z 2021-02-01T00:00:00Z 1440 2880 --ai --table=binanceCandle






bash
# ── Clean start for a new test ──────────────────────────────────────────────
# 1. Wipe ALL BinanceCandle data (total reset)
node scripts/fetch-binance.js BTCUSDT 1d --clear-all --clear-only
# 2. Wipe just one symbol+interval (e.g. switch BTC 1d to a different year)
node scripts/fetch-binance.js BTCUSDT 1d --clear --clear-only
# 3. Clear and immediately fetch fresh data in one command
node scripts/fetch-binance.js BTCUSDT 1d 2021-01-01 2022-01-01 --clear
# 4. Test ETH data (no clearing needed — different symbol)
node scripts/fetch-binance.js ETHUSDT 1d 2020-01-01 2022-01-01
Flags summary:

Flag	What it does
--clear	Delete rows for that exact symbol+interval before fetching
--clear-all	Wipe the entire BinanceCandle table
--clear-only	Only clear, don't fetch (combine with --clear or --clear-all)
All three can be combined — e.g. --clear-all --clear-only nukes everything cleanly, then you fetch fresh when ready.

















node -e "
require('dotenv').config({ path: '.env' });
const { prisma } = require('./utils/db');
(async () => {
  const groups = await prisma.binanceCandle.groupBy({
    by: ['symbol', 'timeframe'],
    _min: { timestamp: true },
    _max: { timestamp: true },
    _count: { id: true },
    orderBy: { _min: { timestamp: 'asc' } }
  });
  console.table(groups.map(g => ({
    symbol: g.symbol,
    interval: g.timeframe,
    count: g._count.id,
    first: g._min.timestamp.toISOString().slice(0,10),
    last:  g._max.timestamp.toISOString().slice(0,10),
  })));
  await prisma.\$disconnect();
})();
"






┌─────────┬───────────┬──────────┬───────┬──────────────┬──────────────┐
│ (index) │ symbol    │ interval │ count │ first        │ last         │
├─────────┼───────────┼──────────┼───────┼──────────────┼──────────────┤
│ 0       │ 'BTCUSDT' │ '1d'     │ 732   │ '2023-01-01' │ '2025-01-01' │
└─────────┴───────────┴──────────┴───────┴──────────────┴──────────────┘











# Already have 2023 and 2024. Now run:

node scripts/backtest.js BTCUSDT 1d 2023-01-01T00:00:00Z 2024-12-31T00:00:00Z 1440 2880 --ai --table=binanceCandle