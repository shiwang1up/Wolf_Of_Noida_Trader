/**
 * fetch-binance.js — Binance Historical Klines Fetcher
 *
 * Fetches OHLCV data from Binance REST API and stores it into the
 * BinanceCandle table. Paginates automatically to get more than 1000 bars.
 *
 * CLI Usage:
 *   node scripts/fetch-binance.js BTCUSDT 1d 2020-01-01 2024-01-01
 *   node scripts/fetch-binance.js BTCUSDT 12h 2021-01-01           (no end = now)
 *
 * Exported:
 *   fetchAndStore(symbol, interval, startMs, endMs, onProgress) → Promise<number>
 */

'use strict';

require('dotenv').config({ path: '../.env' });
require('dotenv').config({ path: '.env', override: true });

const https = require('https');
const { prisma } = require('../utils/db');

// ─── Binance kline intervals ──────────────────────────────────────────────────
const VALID_INTERVALS = new Set([
    '1m','3m','5m','15m','30m',
    '1h','2h','4h','6h','8h','12h',
    '1d','3d','1w','1M'
]);

const BINANCE_BASE = 'https://api.binance.com';
const KLINES_LIMIT = 1000; // max per request

// ─── HTTP helper ──────────────────────────────────────────────────────────────
function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let raw = '';
            res.on('data', d => raw += d);
            res.on('end', () => {
                try { resolve(JSON.parse(raw)); }
                catch(e) { reject(new Error(`Failed to parse response: ${raw.slice(0,200)}`)); }
            });
        }).on('error', reject);
    });
}

// ─── Core fetch + store ───────────────────────────────────────────────────────
/**
 * @param {string}   symbol      e.g. 'BTCUSDT'
 * @param {string}   interval    e.g. '1d'
 * @param {number}   startMs     epoch ms
 * @param {number}   [endMs]     epoch ms (default: now)
 * @param {Function} [onProgress] called with (stored, total) per batch
 * @returns {Promise<number>} total candles stored
 */
async function fetchAndStore(symbol, interval, startMs, endMs, onProgress) {
    if (!VALID_INTERVALS.has(interval)) {
        throw new Error(`Invalid interval '${interval}'. Valid: ${[...VALID_INTERVALS].join(', ')}`);
    }

    endMs = endMs || Date.now();
    let cursor = startMs;
    let totalStored = 0;
    let batchNum = 0;

    console.log(`\n🔄  Fetching ${symbol} ${interval} candles from ${new Date(startMs).toISOString()} to ${new Date(endMs).toISOString()}`);

    while (cursor < endMs) {
        const url = `${BINANCE_BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${cursor}&endTime=${endMs}&limit=${KLINES_LIMIT}`;
        
        let klines;
        try {
            klines = await fetchJson(url);
        } catch(err) {
            console.error(`❌ API error: ${err.message}. Retrying in 3s…`);
            await new Promise(r => setTimeout(r, 3000));
            continue;
        }

        if (!Array.isArray(klines) || klines.length === 0) break;

        // Insert batch into BinanceCandle
        const records = klines.map(k => ({
            symbol,
            timeframe: interval,
            timestamp:   new Date(k[0]),
            open:        parseFloat(k[1]),
            high:        parseFloat(k[2]),
            low:         parseFloat(k[3]),
            close:       parseFloat(k[4]),
            volume:      parseFloat(k[5]),
            closeTime:   new Date(k[6]),
            quoteVolume: parseFloat(k[7]),
            trades:      parseInt(k[8]),
        }));

        // Upsert in smaller chunks of 200 to avoid PG parameter limits
        const CHUNK = 200;
        for (let i = 0; i < records.length; i += CHUNK) {
            const chunk = records.slice(i, i + CHUNK);
            await prisma.$transaction(
                chunk.map(r =>
                    prisma.binanceCandle.upsert({
                        where: { symbol_timeframe_timestamp: { symbol: r.symbol, timeframe: r.timeframe, timestamp: r.timestamp } },
                        update: {
                            open: r.open, high: r.high, low: r.low, close: r.close,
                            volume: r.volume, quoteVolume: r.quoteVolume, trades: r.trades,
                            closeTime: r.closeTime,
                        },
                        create: r,
                    })
                )
            );
            totalStored += chunk.length;
        }

        batchNum++;
        const lastClose = klines[klines.length - 1][6]; // closeTime of last candle
        cursor = lastClose + 1;

        const pct = Math.min(100, ((cursor - startMs) / (endMs - startMs) * 100)).toFixed(1);
        const msg = `  Batch ${batchNum}: stored ${records.length} candles | total ${totalStored} | ${pct}% done`;
        console.log(msg);
        if (onProgress) onProgress(totalStored, pct, msg);

        // Respect Binance rate limit (1200 req/min)
        await new Promise(r => setTimeout(r, 150));

        if (klines.length < KLINES_LIMIT) break; // reached end of data
    }

    console.log(`\n✅  Done! Stored ${totalStored} candles for ${symbol} ${interval}.`);
    return totalStored;
}

// ─── Clear helpers ────────────────────────────────────────────────────────────
async function clearData(symbol, interval) {
    const deleted = await prisma.binanceCandle.deleteMany({ where: { symbol, timeframe: interval } });
    console.log(`🗑️  Cleared ${deleted.count} candles for ${symbol} ${interval}`);
}

async function clearAll() {
    const deleted = await prisma.binanceCandle.deleteMany({});
    console.log(`🗑️  Cleared ALL ${deleted.count} BinanceCandle rows`);
}

// ─── CLI entry point ──────────────────────────────────────────────────────────
if (require.main === module) {
    const rawArgs = process.argv.slice(2);
    const flags   = rawArgs.filter(a => a.startsWith('--'));
    const posArgs = rawArgs.filter(a => !a.startsWith('--'));
    const [symbol, interval, startArg, endArg] = posArgs;

    const doClear    = flags.includes('--clear');     // clear symbol+interval before fetch
    const doClearAll = flags.includes('--clear-all'); // wipe entire BinanceCandle table
    const clearOnly  = flags.includes('--clear-only');// clear and exit (no fetch)

    if (!symbol || !interval) {
        console.log('Usage: node scripts/fetch-binance.js <symbol> <interval> [startDate] [endDate] [flags]');
        console.log('Flags:');
        console.log('  --clear        Clear existing rows for this symbol+interval before fetching');
        console.log('  --clear-all    Wipe the entire BinanceCandle table before fetching');
        console.log('  --clear-only   Only clear (no fetch); combine with --clear or --clear-all');
        console.log('Examples:');
        console.log('  node scripts/fetch-binance.js BTCUSDT 1d 2020-01-01 2021-01-01');
        console.log('  node scripts/fetch-binance.js BTCUSDT 1d 2021-01-01 2022-01-01 --clear');
        console.log('  node scripts/fetch-binance.js BTCUSDT 1d --clear-all --clear-only');
        console.log(`Valid intervals: ${[...VALID_INTERVALS].join(', ')}`);
        process.exit(1);
    }

    const sym = symbol.toUpperCase();

    (async () => {
        try {
            if (doClearAll) {
                await clearAll();
            } else if (doClear) {
                await clearData(sym, interval);
            }

            if (clearOnly) {
                console.log('✅ Clear complete. Exiting (--clear-only).');
                await prisma.$disconnect();
                process.exit(0);
            }

            if (!startArg) { console.error('Start date required for fetch'); process.exit(1); }
            const startMs = new Date(startArg).getTime();
            const endMs   = endArg ? new Date(endArg).getTime() : Date.now();
            if (isNaN(startMs)) { console.error('Invalid start date'); process.exit(1); }

            const n = await fetchAndStore(sym, interval, startMs, endMs);
            console.log(`Total: ${n} candles`);
            await prisma.$disconnect();
            process.exit(0);
        } catch (e) {
            console.error(e);
            await prisma.$disconnect();
            process.exit(1);
        }
    })();
}

module.exports = { fetchAndStore, VALID_INTERVALS };
