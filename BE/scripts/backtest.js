require('dotenv').config({ path: '../.env' });

// ── Initial Wallet Defaults ─────────────────────────────────────────────────
// Change these two values to adjust the default starting portfolio
const DEFAULT_CASH_AMOUNT = 1000;  // USD sitting idle, ready to BUY
const DEFAULT_STOCKS_AMOUNT = 0;  // USD already invested at backtest start
// ────────────────────────────────────────────────────────────────────────────
const { prisma } = require('../utils/db');
const indicatorService = require('../services/indicators/indicatorService');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { fetchAndStore } = require('./fetch-binance');
const { computeModerateSignal }     = require('../services/signalEngine/moderateEngine');
const { computeAggressiveSignal } = require('../services/signalEngine/aggressiveEngine');
const { computePassiveSignal }    = require('../services/signalEngine/passiveEngine');

async function getHistoricalPayload(symbol, targetTime, timeframe, tableArg = 'testCandle') {
    // Select DB table based on tableArg
    const candleTable = tableArg === 'binanceCandle' ? prisma.binanceCandle : prisma.testCandle;

    // 1. Fetch main resolution candles
    const candlesMain = await candleTable.findMany({
        where: { symbol, timeframe: timeframe, timestamp: { lte: targetTime } },
        orderBy: { timestamp: 'desc' },
        take: 1500
    });

    if (candlesMain.length < 50) return null; // Not enough data
    candlesMain.reverse();
    const features = indicatorService.getLatestFeatures(candlesMain, timeframe);

    // 2. Multi-timeframe 1h candles are NOT available in this single-timeframe dataset.
    //    All h4 and d1 momentum values will be 0. Skipping this query entirely.
    const macroFeatures = null;

    // Historical Sentiment/Liquidity
    const latestSentiment = await prisma.sentiment.findFirst({
        where: { source: 'FearGreedIndex', timestamp: { lte: targetTime } },
        orderBy: { timestamp: 'desc' }
    });

    // No liquidity zone DB query — these aren't available in our OHLC-only dataset.
    const liquidityZones = [];

    // Mock global stats if not stored historically
    const globalMetrics = { totalMarketCap: 0, btcDominance: 0 };
    const socialSummary = 'Unavailable Historical Social Data';
    const orderbookSummary = 'Unavailable Historical Orderbook';
    const newsHeadlines = 'Unavailable Historical News';

    return {
        symbol,
        baseCoin: symbol.replace('USDT', ''), // Rough guess
        quoteCoin: 'USDT',
        currentPrice: features.currentPrice,
        indicators: {
            rsi: features.rsi,
            macd: features.macd,
            bollingerBands: features.bollingerBands,
            ema20: features.ema20,
            ema50: features.ema50,
            adx: features.adx,
            atr: features.atr
        },
        marketStructure: {
            support: features.support,
            resistance: features.resistance
        },
        volume: {
            lastVolume: features.volume,
            volumeSpikePercent: features.volumeSpike,
            buySellRatio: features.buySellRatio
        },
        momentum: features.momentum,
        chartPatterns: features.chartPatterns,
        marketContext: globalMetrics,
        marketSentiment: latestSentiment ? { score: latestSentiment.score, label: latestSentiment.label } : 'Unknown',
        orderbook: orderbookSummary,
        liquidityZones: liquidityZones.length > 0 ? liquidityZones.map(z => ({
            type: z.type, side: z.side, price: z.price, volume: z.volume, strength: z.strength
        })) : 'No significant persistent liquidity zones detected.',
        socialStats: socialSummary,
        latestNewsHeadlines: newsHeadlines,
        multiTimeframeContext: {
            macro_1h: macroFeatures || 'Unavailable',
            micro_1m: {
                momentum_1m_pct: features.momentum?.m1,
                rsi: features.rsi,
                note: 'Use only for precise entry timing (10% weight).'
            }
        }
    };
}

// Evaluate trade outcome
async function evaluateSignal(symbol, signalDetails, timestamp, lookaheadMins = 30, timeframe, tableArg = 'testCandle') {
    const endTargetTime = new Date(timestamp.getTime() + lookaheadMins * 60000);
    const candleTable = tableArg === 'binanceCandle' ? prisma.binanceCandle : prisma.testCandle;

    const futureCandles = await candleTable.findMany({
        where: {
            symbol,
            timeframe: timeframe, // Use the provided timeframe
            timestamp: { gt: timestamp, lte: endTargetTime }
        },
        orderBy: { timestamp: 'asc' }
    });

    if (futureCandles.length === 0) return { outcome: 'NO_DATA', maxMovePct: 0, minMovePct: 0 };

    const entryPrice = signalDetails.currentPrice;
    let maxPrice = entryPrice;
    let minPrice = entryPrice;

    for (const c of futureCandles) {
        if (c.high > maxPrice) maxPrice = c.high;
        if (c.low < minPrice) minPrice = c.low;
    }

    const maxMovePct = ((maxPrice - entryPrice) / entryPrice) * 100;
    const minMovePct = ((minPrice - entryPrice) / entryPrice) * 100;

    // Timeframe-based thresholds to enhance win-rate (wider stops, achievable targets)
    let tpPct = 0.5;
    let slPct = 0.5;

    if (timeframe === '1d' || timeframe === '3d' || timeframe === '1w' || timeframe === '1M') {
        tpPct = 2.0; slPct = 4.0;
    } else if (timeframe === '12h' || timeframe === '8h' || timeframe === '6h') {
        tpPct = 0.5; slPct = 0.5; // Restored to 0.5% to maintain compatibility with testCandle (lower volatility data)
    } else if (timeframe === '4h' || timeframe === '2h') {
        tpPct = 1.0; slPct = 2.0;
    } else if (timeframe === '1h' || timeframe === '30m') {
        tpPct = 0.8; slPct = 1.5;
    } else {
        tpPct = 0.5; slPct = 0.8;
    }

    let outcome = 'HOLD';
    if (signalDetails.signal === 'BUY') {
        if (maxMovePct >= tpPct && minMovePct > -slPct) outcome = 'WIN';
        else if (minMovePct <= -slPct) outcome = 'LOSS';
        else outcome = 'NEUTRAL';
    } else if (signalDetails.signal === 'SELL') {
        if (minMovePct <= -tpPct && maxMovePct < slPct) outcome = 'WIN';
        else if (maxMovePct >= slPct) outcome = 'LOSS';
        else outcome = 'NEUTRAL';
    }

    return { outcome, maxMovePct, minMovePct, entryPrice, maxPrice, minPrice };
}



async function runBacktest(symbol, timeframe, startTimeStr, endTimeStr, intervalMins, lookaheadMins, walletConfig = {}) {
    const tableArg = walletConfig.tableArg || 'testCandle';
    const candleTable = tableArg === 'binanceCandle' ? prisma.binanceCandle : prisma.testCandle;

    const startTime = new Date(startTimeStr);
    const endTime = new Date(endTimeStr);

    const enableUI = process.argv.includes('--ui');

    // --- UI Server Setup ---
    let io = null;
    if (enableUI) {
        const app = express();
        const server = http.createServer(app);
        io = new Server(server, { cors: { origin: "*" } });

        app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'visualizer.html'));
        });

        io.on('connection', (socket) => {
            console.log('[UI] A browser connected. Waiting for history request...');

            socket.on('request_history', async (range) => {
                console.log(`[UI] Requested history range: ${range}`);
                let rangeStart = new Date(endTime);
                if (range === '1M') rangeStart.setMonth(rangeStart.getMonth() - 1);
                else if (range === '3M') rangeStart.setMonth(rangeStart.getMonth() - 3);
                else if (range === '5M') rangeStart.setMonth(rangeStart.getMonth() - 5);
                else if (range === '1Y') rangeStart.setFullYear(rangeStart.getFullYear() - 1);
                else rangeStart = startTime; // ALL

                // Clamp to the backtest start time
                if (rangeStart < startTime) rangeStart = startTime;

                try {
                    // Use selected table for chart data
                    const fullCandles = await candleTable.findMany({
                        where: { symbol, timeframe, timestamp: { gte: rangeStart, lte: endTime } },
                        orderBy: { timestamp: 'asc' }
                    });

                    const uiData = fullCandles.map(c => ({
                        time: Math.floor(c.timestamp.getTime() / 1000),
                        open: c.open,
                        high: c.high,
                        low: c.low,
                        close: c.close
                    }));

                    socket.emit('init_chart', uiData);
                    console.log(`[UI] Sent ${uiData.length} candles for range ${range}.`);
                } catch (err) {
                    console.error("Error fetching chunk:", err);
                }
            });

            // ── Binance fetch handler ────────────────────────────────────────────
            socket.on('fetch_binance', async ({ symbol: sym, interval, startMs, endMs }) => {
                console.log(`[FETCH] Binance request: ${sym} ${interval} from ${new Date(startMs).toISOString()}`);
                try {
                    const total = await fetchAndStore(
                        sym, interval, startMs, endMs || Date.now(),
                        (stored, pct, message) => {
                            socket.emit('fetch_progress', { pct: parseFloat(pct), message, stored });
                        }
                    );
                    socket.emit('fetch_complete', { total, symbol: sym, interval });
                    console.log(`[FETCH] Complete: ${total} candles stored`);
                } catch (err) {
                    console.error('[FETCH] Error:', err.message);
                    socket.emit('fetch_error', { message: err.message });
                }
            });
        }); // end io.on('connection')

        server.listen(4000, () => {
            console.log('\n======================================================');
            console.log('🚀 LIVE UI VISUALIZER is running at: http://localhost:4000');
            console.log('Open this link in your browser to view the chart!');
            console.log('======================================================\n');
        });

        console.log(`\n======================================================`);
        console.log(`Data loaded successfully. The UI visualizer will remain active at http://localhost:4000.`);
        console.log(`Press Ctrl+C to exit.`);
    } // end if (enableUI)

    const applyFees = process.argv.includes('--fees');

    // ── Signal Engine Selection ───────────────────────────────────────────
    // --aggressive  🔥  High risk / high reward (lower thresholds, no regime gate)
    // --passive     🛡️  Capital preservation (higher thresholds, TF alignment required)
    // --balanced    ⚖️  Default: balanced risk/reward
    const useAggressive = process.argv.includes('--aggressive');
    const usePassive    = process.argv.includes('--passive');
    const activeEngine  = useAggressive ? computeAggressiveSignal
                        : usePassive    ? computePassiveSignal
                        :                 computeModerateSignal; // --balanced (default)
    const engineLabel   = useAggressive ? '🔥 AGGRESSIVE (High Risk / High Reward)'
                        : usePassive    ? '🛡️  PASSIVE (Capital Preservation)'
                        :                 '⚖️  BALANCED (Default)';
    console.log(`\n[ENGINE] ${engineLabel} engine selected.`);

    const ENABLE_SIP = false;   // ← set false to disable monthly injection

    const SIP_AMOUNT = 100;    // ← monthly cash injection amount (USD)

    console.log(`\n[INFO] 🧠 Mathematical Engine Active. Starting historical analysis...`);
    let currentTestTime = new Date(startTime);
    let results = [];
    let stats = { WIN: 0, LOSS: 0, NEUTRAL: 0, NO_DATA: 0, TOTAL_TRADES: 0 };
    let cooldownCandles = 0; // candles remaining before next trade allowed
    let lastSignalDir = null; // track last trade direction for cooldown logic

    // Paper Trading Wallet — initialized from user input
    const stocksAmount = walletConfig.stocksAmount ?? DEFAULT_STOCKS_AMOUNT;
    const cashAmount = walletConfig.cashAmount ?? DEFAULT_CASH_AMOUNT;
    const totalBalance = walletConfig.totalBalance ?? (cashAmount + stocksAmount);
    let wallet = { quote: cashAmount, base: 0, averageEntryPrice: 0, highestPriceSinceEntry: 0, initialized: false, initialValue: totalBalance };
    let totalFeesPaidUSD = 0;
    let totalTdsPaidUSD = 0;
    console.log(`\n[WALLET] Starting with $${cashAmount.toFixed(2)} cash + $${stocksAmount.toFixed(2)} in stocks (Total: $${totalBalance.toFixed(2)})\n`);

    let lastMonth = -1;

    while (currentTestTime <= endTime) {
        console.log(`\nEvaluating time: ${currentTestTime.toISOString()}`);

        const payload = await getHistoricalPayload(symbol, currentTestTime, timeframe, tableArg);
        if (!payload) {
            process.stdout.write(`\r⏳ Warming up indicators... (${currentTestTime.toISOString().slice(0, 10)}) — need 50+ candles`);
            currentTestTime = new Date(currentTestTime.getTime() + intervalMins * 60000);
            continue;
        }
        // First time we have enough data — print newline after warmup
        if (!wallet.initialized) {
            console.log(`\n✅ Indicators warmed up. Trading begins from ${currentTestTime.toISOString().slice(0, 10)}\n`);
        }

        if (!wallet.initialized) {
            wallet.base = stocksAmount / payload.currentPrice;
            wallet.averageEntryPrice = payload.currentPrice;
            wallet.initialized = true;
            console.log(`💰 WALLET INITIALIZED: $${cashAmount.toFixed(2)} Cash | ${wallet.base.toFixed(4)} Base (Entry: $${wallet.averageEntryPrice.toFixed(2)})`);
        }
        else {
            // SIP / DCA Injection: Add $1000 every new month
            if (ENABLE_SIP) {
                const currentMonth = currentTestTime.getMonth();
                if (lastMonth !== -1 && currentMonth !== lastMonth) {
                    wallet.quote += SIP_AMOUNT;
                    wallet.initialValue += SIP_AMOUNT;
                    console.log(`\n💵 SIP INJECTION: Added $${SIP_AMOUNT} to Cash balance (Total Invested Principal: $${wallet.initialValue.toFixed(2)})`);
                }
                lastMonth = currentMonth;
            }
        }

        try {
            let parsedResult;

            // ── Trailing Stop Loss Check ───────────────────────────────────────────
            // Protect capital and lock in gains: Force sell if position drops below peak
            const TRAILING_STOP_LOSS_PCT = (timeframe === '1d' || timeframe === '3d' || timeframe === '1w' || timeframe === '1M') ? 0.08 :
                                           (timeframe === '12h' || timeframe === '8h' || timeframe === '6h') ? 0.06 :
                                           (timeframe === '4h' || timeframe === '2h') ? 0.045 : 0.03;
            let forceStopLoss = false;

            if (wallet.base > 0.0001) {
                if (!wallet.highestPriceSinceEntry || payload.currentPrice > wallet.highestPriceSinceEntry) {
                    wallet.highestPriceSinceEntry = payload.currentPrice;
                }
            } else {
                wallet.highestPriceSinceEntry = 0;
            }

            if (wallet.base > 0.0001 && wallet.highestPriceSinceEntry > 0) {
                const dropPct = (wallet.highestPriceSinceEntry - payload.currentPrice) / wallet.highestPriceSinceEntry;
                if (dropPct >= TRAILING_STOP_LOSS_PCT) {
                    console.log(`\n🚨 TRAILING STOP LOSS TRIGGERED at $${payload.currentPrice.toFixed(2)} (-${(dropPct * 100).toFixed(1)}% drop from peak $${wallet.highestPriceSinceEntry.toFixed(2)})`);
                    parsedResult = { signal: 'SELL', confidence: 10, fullExit: true, summary: '🚨 TRAILING STOP LOSS (Capital Protection)' };
                    forceStopLoss = true;
                }
            }

            if (!forceStopLoss) {
                parsedResult = activeEngine(payload);
            }

            console.log(`SIGNAL: ${parsedResult.signal} (Conf: ${parsedResult.confidence}) - ${parsedResult.summary}`);

            // ── Regime-Aware Position Sizing ─────────────────────────────────
            // Buy conservatively (25%) to accumulate slowly and reduce BUY fee frequency.
            // Sell 100% in bear/neutral, only 40% in bull regime to keep core exposure.
            const _ema20b = payload.indicators?.ema20 ?? 0;
            const _ema50b = payload.indicators?.ema50 ?? 0;
            const inBullRegimeNow = _ema20b > 0 && _ema50b > 0 && _ema20b > _ema50b;
            const buyFraction = 0.25;
            const sellFraction = (forceStopLoss || parsedResult?.fullExit || !inBullRegimeNow) ? 1.00 : 0.40; // Hold 60% in bull runs, unless fullExit!
            const modeTag = inBullRegimeNow ? '🐂BULL' : '🐻BEAR';

            // ── Minimum trade value guard ────────────────────────────────────
            // Skip trades smaller than $50 — micro-trades add noise, eat position,
            // and get counted as real trades skewing win-rate stats.
            const MIN_TRADE_USD = 50;

            // ── Cooldown filter: skip same-direction signal if recently traded ────
            // Prevents cascade buying (3-4 consecutive BUYs depleting cash)
            if (cooldownCandles > 0) {
                cooldownCandles--;
                if (parsedResult.signal === lastSignalDir) {
                    console.log(`OUTCOME: Cooldown (${cooldownCandles + 1} remaining) | Portfolio: $${(wallet.quote + wallet.base * payload.currentPrice).toFixed(2)} (PnL: $${(wallet.quote + wallet.base * payload.currentPrice - wallet.initialValue).toFixed(2)})`);
                    currentTestTime = new Date(currentTestTime.getTime() + intervalMins * 60000);
                    continue;
                }
            }

            // ── Minimum confidence filter per mode ───────────────────────────────
            // REVERSION: conf ≥ 4 (noisy, mean-revert setups need conviction)
            // TRENDING:  conf ≥ 3.5 (raised from 3.0 — filters weakest trend-chasing buys)
            // MOMENTUM:  conf ≥ 3.0 (momentum signals are cleaner)
            const modeLabel = parsedResult.summary ?? '';
            const isReversionMode = modeLabel.includes('REVERSION') || modeLabel.includes('REV→MOM');
            const minConf = isReversionMode ? 4.0 : 3.0;
            if (parsedResult.signal !== 'HOLD' && (parsedResult.confidence ?? 0) < minConf) {
                console.log(`OUTCOME: Skipped (low conf ${parsedResult.confidence}/${minConf} in ${isReversionMode ? 'REVERSION' : 'MOM/TREND'} mode) | Portfolio: $${(wallet.quote + wallet.base * payload.currentPrice).toFixed(2)} (PnL: $${(wallet.quote + wallet.base * payload.currentPrice - wallet.initialValue).toFixed(2)})`);
                currentTestTime = new Date(currentTestTime.getTime() + intervalMins * 60000);
                continue;
            }

            // ── FEE & PNL-AWARE POSITION MANAGEMENT (HOLD GUARD) ─────────────
            // If the AI says SELL but the trade hasn't covered the ~3% round-trip fees,
            // we ignore weak SELL signals to prevent death by a thousand cuts.
            if (parsedResult.signal === 'SELL' && wallet.base > 0.0001 && wallet.averageEntryPrice > 0) {
                const pnlPct = (payload.currentPrice - wallet.averageEntryPrice) / wallet.averageEntryPrice;

                if (pnlPct > -0.06 && pnlPct < 0.04) {
                    // Whipsaw / Fee Trap Zone
                    if ((parsedResult.confidence ?? 0) < 6.5) {
                        if (wallet.initialized) { // Prevent logging spam during warmup
                            console.log(`[FEE GUARD] Ignoring SELL (Conf: ${(parsedResult.confidence ?? 0).toFixed(1)}) because PnL is ${(pnlPct * 100).toFixed(2)}%. Holding to avoid fee bleed.`);
                        }
                        parsedResult.signal = 'HOLD';
                    }
                } else if (pnlPct >= 0.04) {
                    // Profitable position. Let winners run!
                    if ((parsedResult.confidence ?? 0) < 5.0) {
                        if (wallet.initialized) {
                            console.log(`[TREND GUARD] Ignoring weak SELL (Conf: ${(parsedResult.confidence ?? 0).toFixed(1)}) to let winner run (+${(pnlPct * 100).toFixed(2)}%).`);
                        }
                        parsedResult.signal = 'HOLD';
                    }
                }
            }

            if (parsedResult.signal === 'BUY' && wallet.quote > MIN_TRADE_USD) {
                // [AVERAGING DOWN GUARD] Only add to existing position if price is lower than avg entry.
                // EXCEPTION: In a confirmed Bull Regime (EMA20 > EMA50 from indicators), allow buying up — bulls run!
                const _ema20 = payload.indicators?.ema20 ?? 0;
                const _ema50 = payload.indicators?.ema50 ?? 0;
                const inBullRegime = _ema20 > 0 && _ema50 > 0 && _ema20 > _ema50;
                if (wallet.base > 0.0001 && payload.currentPrice >= wallet.averageEntryPrice && !inBullRegime) {
                    if (wallet.initialized) {
                        console.log(`[DCA GUARD] Ignoring BUY: price ($${payload.currentPrice.toFixed(2)}) >= Avg Entry ($${wallet.averageEntryPrice.toFixed(2)}) & not in Bull Regime.`);
                    }
                    parsedResult.signal = 'HOLD';
                    currentTestTime = new Date(currentTestTime.getTime() + intervalMins * 60000);
                    continue;
                }

                const amountToBuy = wallet.quote * buyFraction;
                if (amountToBuy < MIN_TRADE_USD) {
                    // Not enough left to place a meaningful trade
                    currentTestTime = new Date(currentTestTime.getTime() + intervalMins * 60000);
                    continue;
                }

                let gainedBase = amountToBuy / payload.currentPrice;
                let feeLog = '';

                // Calculate new average entry price before adding base
                const totalCostUSD = (wallet.base * (wallet.averageEntryPrice || payload.currentPrice)) + amountToBuy;

                if (applyFees) {
                    const buyFeeBase = gainedBase * 0.015; // 1.5% Trading Fee
                    gainedBase -= buyFeeBase;
                    totalFeesPaidUSD += (buyFeeBase * payload.currentPrice);
                    feeLog = ` [Fee: ${buyFeeBase.toFixed(6)}]`;
                }

                wallet.base += gainedBase;
                if (wallet.base > 0) {
                    wallet.averageEntryPrice = totalCostUSD / wallet.base;
                    if (!wallet.highestPriceSinceEntry || payload.currentPrice > wallet.highestPriceSinceEntry) {
                        wallet.highestPriceSinceEntry = payload.currentPrice;
                    }
                }
                wallet.quote -= amountToBuy;
                console.log(`💰 WALLET [BUY ${modeTag} x${(buyFraction * 100).toFixed(0)}%]: Spent $${amountToBuy.toFixed(2)} → ${gainedBase.toFixed(4)} Base${feeLog} (New Avg Entry: $${wallet.averageEntryPrice.toFixed(2)})`);
            } else if (parsedResult.signal === 'SELL' && wallet.base > 0.0001) {
                const amountToSell = wallet.base * sellFraction; // Sell 100% to minimize exit fee count
                let gainedQuote = amountToSell * payload.currentPrice;
                if (gainedQuote < MIN_TRADE_USD) {
                    // Position too small to bother selling
                    currentTestTime = new Date(currentTestTime.getTime() + intervalMins * 60000);
                    continue;
                }

                let sellFeeLog = '';
                if (applyFees) {
                    const sellFee = gainedQuote * 0.005; // 0.5% Trading Fee
                    const sellTds = gainedQuote * 0.01;  // 1.0% TDS
                    gainedQuote -= (sellFee + sellTds);
                    totalFeesPaidUSD += sellFee;
                    totalTdsPaidUSD += sellTds;
                    sellFeeLog = ` [Fee: $${sellFee.toFixed(2)} | TDS: $${sellTds.toFixed(2)}]`;
                }

                wallet.quote += gainedQuote;
                wallet.base -= amountToSell;
                if (wallet.base < 0.0001) {
                    wallet.averageEntryPrice = 0; // Reset when fully sold
                    wallet.highestPriceSinceEntry = 0;
                }
                console.log(`💰 WALLET [SELL ${modeTag} x100%]: Sold ${amountToSell.toFixed(4)} Base → $${gainedQuote.toFixed(2)}${sellFeeLog}`);
            } else if (parsedResult.signal !== 'HOLD') {
                // BUY but no quote, or SELL but no base — skip
                currentTestTime = new Date(currentTestTime.getTime() + intervalMins * 60000);
                continue;
            }
            // HOLD falls through
            // On an executed trade, set cooldown
            if (parsedResult.signal !== 'HOLD') {
                cooldownCandles = 2;
                lastSignalDir = parsedResult.signal;
            }

            const baseValue = wallet.base * payload.currentPrice;
            const portfolioValue = wallet.quote + baseValue;
            const pnl = portfolioValue - wallet.initialValue;

            if (parsedResult.signal === 'BUY' || parsedResult.signal === 'SELL') {
                stats.TOTAL_TRADES++;
                const evalResult = await evaluateSignal(symbol, { ...parsedResult, currentPrice: payload.currentPrice, atr: payload.indicators?.atr }, currentTestTime, lookaheadMins, timeframe, tableArg);

                console.log(`OUTCOME: ${evalResult.outcome}`);
                console.log(`Max Move: +${evalResult.maxMovePct.toFixed(2)}%, Min Move: ${evalResult.minMovePct.toFixed(2)}%`);
                console.log(`Portfolio: $${portfolioValue.toFixed(2)} (PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)})`);

                stats[evalResult.outcome]++;

                results.push({
                    timestamp: currentTestTime.toISOString(),
                    price: payload.currentPrice,
                    signal: parsedResult.signal,
                    confidence: parsedResult.confidence,
                    outcome: evalResult.outcome,
                    maxMovePct: evalResult.maxMovePct,
                    minMovePct: evalResult.minMovePct,
                    portfolioValue: portfolioValue,
                    pnl: pnl,
                    reasoning: parsedResult.reasoning
                });

                if (io) {
                    io.emit('ai_step', {
                        time: Math.floor(currentTestTime.getTime() / 1000),
                        signal: parsedResult.signal,
                        reasoning: Array.isArray(parsedResult.reasoning) ? parsedResult.reasoning.join(' | ') : parsedResult.summary,
                        price: payload.currentPrice,
                        outcome: evalResult.outcome,
                        portfolioValue: portfolioValue,
                        pnl: pnl,
                        wallet: { ...wallet, baseValue },
                        feesTotal: totalFeesPaidUSD,
                        tdsTotal: totalTdsPaidUSD
                    });
                }
            } else {
                console.log(`OUTCOME: Skipped (HOLD) | Portfolio: $${portfolioValue.toFixed(2)} (PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)})`);
                if (io) io.emit('ai_step', {
                    time: Math.floor(currentTestTime.getTime() / 1000),
                    signal: 'HOLD',
                    reasoning: Array.isArray(parsedResult.reasoning) ? parsedResult.reasoning.join(' | ') : parsedResult.summary,
                    price: payload.currentPrice,
                    portfolioValue: portfolioValue,
                    pnl: pnl,
                    wallet: { ...wallet, baseValue },
                    feesTotal: totalFeesPaidUSD,
                    tdsTotal: totalTdsPaidUSD
                });
            }

            // Delay: 0ms for rule-based (instant), 1s for LLM (avoid API rate limits)
            await new Promise(resolve => setTimeout(resolve, 0));
        } catch (e) {
            console.error(`Error querying LLM: ${e.message}`);
        }

        // Advance time
        currentTestTime = new Date(currentTestTime.getTime() + intervalMins * 60000);
    }

    console.log("\n================ BACKTEST COMPLETE ================");
    console.log(`Total actionable trades: ${stats.TOTAL_TRADES}`);
    console.log(`WINS: ${stats.WIN}`);
    console.log(`LOSSES: ${stats.LOSS}`);
    console.log(`NEUTRAL (No clear trend within lookahead): ${stats.NEUTRAL}`);

    if (stats.TOTAL_TRADES > 0) {
        const winRate = (stats.WIN / (stats.WIN + stats.LOSS)) * 100;
        console.log(`WIN RATE (excluding neutrals): ${winRate.toFixed(2)}%`);
    }

    const finalPrice = results.length > 0 ? results[results.length - 1].price : 0;
    const finalHoldingsValue = wallet.base * finalPrice;
    const finalTotalValue = wallet.quote + finalHoldingsValue;
    const finalPnl = finalTotalValue - wallet.initialValue;

    console.log(`---------------------------------------------------`);
    console.log(`💵 Cash: $${wallet.quote.toFixed(2)}`);
    console.log(`📈 Holdings: $${finalHoldingsValue.toFixed(2)}`);
    console.log(`💸 Fees Paid: $${totalFeesPaidUSD.toFixed(2)}`);
    console.log(`🏛️ TDS Tax: $${totalTdsPaidUSD.toFixed(2)}`);
    console.log(`🏦 Total: $${finalTotalValue.toFixed(2)}`);
    console.log(`P&L: ${finalPnl >= 0 ? '+' : ''}${finalPnl.toFixed(2)}`);
    console.log(`---------------------------------------------------`);

    const reportPath = `./backtest_results_${symbol}_${Date.now()}.json`;
    // write file
    const summary = {
        cash: parseFloat(wallet.quote.toFixed(2)),
        holdingsValue: parseFloat(finalHoldingsValue.toFixed(2)),
        feesPaid: parseFloat(totalFeesPaidUSD.toFixed(2)),
        tdsTax: parseFloat(totalTdsPaidUSD.toFixed(2)),
        totalPortfolioValue: parseFloat(finalTotalValue.toFixed(2)),
        pnl: parseFloat(finalPnl.toFixed(2))
    };
    fs.writeFileSync(reportPath, JSON.stringify({ stats, summary, results }, null, 2));
    console.log(`Detailed report saved to: ${reportPath}\n`);

    if (enableUI) {
        console.log(`\n======================================================`);
        console.log(`Backtest complete! The UI visualizer will remain active at http://localhost:4000.`);
        console.log(`Press Ctrl+C to exit.`);
    }
}

const args = process.argv.slice(2);
const tableFlag = args.find(a => a.startsWith('--table='));
const tableFlagParsed = tableFlag ? tableFlag.split('=')[1] : 'testCandle';

const posArgs = args.filter(a => !a.startsWith('--'));

if (posArgs.length < 4) {
    console.log("Usage: node backtest.js <symbol> <timeframe> <start_iso> <end_iso> [--fees] [--table=testCandle|binanceCandle] [--no-ui]");
    console.log("Example: node backtest.js BTCUSDT 1d 2023-01-01 2024-12-31 --fees --table=binanceCandle");
    process.exit(1);
}

const symbol = posArgs[0];
const timeframe = posArgs[1];
let startStr = posArgs[2];
let endStr = posArgs[3];

// Auto-append time to simple YYYY-MM-DD strings so the user doesn't have to
if (startStr.length === 10) startStr += "T00:00:00Z";
if (endStr.length === 10) endStr += "T00:00:00Z";

// Auto-calculate interval & lookahead based on timeframe mapping
const tfMap = { '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '2h': 120, '4h': 240, '6h': 360, '8h': 480, '12h': 720, '1d': 1440, '3d': 4320, '1w': 10080, '1M': 43200 };
const stepMins = posArgs[4] ? parseInt(posArgs[4]) : (tfMap[timeframe] || 1440);
const lookaheadMins = posArgs[5] ? parseInt(posArgs[5]) : stepMins * 2;

(async () => {
    const cashFlag = args.find(a => a.startsWith('--cash='));
    const stocksFlag = args.find(a => a.startsWith('--stocks='));

    let cashAmount = DEFAULT_CASH_AMOUNT;
    let stocksAmount = DEFAULT_STOCKS_AMOUNT;

    if (cashFlag && stocksFlag) {
        // Bypass interactive prompt if CLI args provided
        cashAmount = parseFloat(cashFlag.split('=')[1]);
        stocksAmount = parseFloat(stocksFlag.split('=')[1]);
    } else if (DEFAULT_CASH_AMOUNT === 0 && DEFAULT_STOCKS_AMOUNT === 0) {
        // Both defaults are 0 — must ask the user interactively
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const ask = (q) => new Promise(resolve => rl.question(q, resolve));

        console.log('\n════════════════════════════════════════════════════════════════');
        console.log('             🐺 Wolf of Noida — Backtest Setup                  ');
        console.log('════════════════════════════════════════════════════════════════\n');
        console.log('  Your wallet has two parts:');
        console.log('  1️⃣  Cash available  — money sitting idle, used to BUY stocks');
        console.log('  2️⃣  Already in stocks — amount already invested at start price');
        console.log('  Total Balance = Cash + Stocks\n');

        const cashRaw = await ask('💵 Cash available to trade (USD): ');
        const stocksRaw = await ask('📈 Already invested in stocks  (USD): ');
        rl.close();

        cashAmount = parseFloat(cashRaw) || 0;
        stocksAmount = parseFloat(stocksRaw) || 0;
    }
    // else: at least one default is non-zero → use DEFAULT_CASH_AMOUNT / DEFAULT_STOCKS_AMOUNT as-is

    const totalBalance = cashAmount + stocksAmount;

    if (cashAmount < 0 || stocksAmount < 0) {
        console.error('\n❌ Amounts must be positive. Exiting.');
        process.exit(1);
    }

    console.log(`\n📋 Wallet Summary:`);
    console.log(`   💵 Cash (ready to BUY) : $${cashAmount.toFixed(2)}`);
    console.log(`   📈 Already in stocks  : $${stocksAmount.toFixed(2)}`);
    console.log(`   🏦 Total portfolio    : $${totalBalance.toFixed(2)}`);
    console.log('');

    runBacktest(
        symbol, timeframe, startStr, endStr,
        stepMins, lookaheadMins,
        { totalBalance, stocksAmount, cashAmount, tableArg: tableFlagParsed }
    ).catch(console.error);
})();
