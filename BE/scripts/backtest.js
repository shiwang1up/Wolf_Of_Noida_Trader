require('dotenv').config({ path: '../.env' });
const { prisma } = require('../utils/db');
const indicatorService = require('../services/indicators/indicatorService');
const { OpenAI } = require('openai');
const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { fetchAndStore } = require('./fetch-binance');

// AI setup (copied from aiService)
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

async function queryLLM(systemPrompt, marketStatePayload) {
    if (groq) {
        console.log("Using Groq API for Market reasoning");
        const completion = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: JSON.stringify(marketStatePayload) }
            ],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" }
        });
        return completion.choices[0].message.content;
    }
    if (genAI) {
        console.log("Using Gemini API for Market reasoning");
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });
        const result = await model.generateContent({
            contents: [
                {
                    role: 'user',
                    parts: [{ text: `${systemPrompt}\n\nMarket State:\n${JSON.stringify(marketStatePayload)}` }]
                }
            ],
            generationConfig: { responseMimeType: "application/json" }
        });
        return result.response.text();
    }
    if (openai) {
        console.log("Using OpenAI API for Market reasoning");
        const completion = await openai.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: JSON.stringify(marketStatePayload) }
            ],
            model: 'gpt-4-turbo-preview',
            response_format: { type: "json_object" }
        });
        return completion.choices[0].message.content;
    }
    throw new Error('No LLM Provider API Keys found in .env');
}

const systemPrompt_weighted = `
# MISSION
You are a High-Frequency Crypto Trading Analyst (BTCINR). Your goal is to provide a BUY, HOLD, or SELL signal every 60 seconds by weighing conflicting data points across multiple timeframes.

# WEIGHTAGE ARCHITECTURE (CRITICAL)
1. LIQUIDITY & ORDERBOOK (35%): Focus on 'walls' and B/S Ratio. These are the primary leads for immediate price pressure.
2. ANCHOR MOMENTUM (25%): HIERARCHY: 1d > 4h > 1h > 5m > 1m. Higher timeframes (HTF) determine the 'Master Bias'. Never fight the 1d/4h trend without extreme volume.
3. VOLATILITY CONTEXT (15%): Use ATR, Bollinger %B, and ADX. ADX > 25 indicates a strong trend that HTF momentum will likely continue.
4. SENTIMENT DIVERGENCE (15%): Compare Fear/Greed vs. B/S Ratio. 
5. MICRO-TECHNICALS (10%): 1m RSI and price change. Use ONLY for precision entry timing once the HTF Bias is confirmed.

# DECISION LOGIC RULES (HTF CONFLUENCE)
- [HTF MASTER BIAS] If 1d, 4h, and 1h momentum are ALL negative (<-1%), you are STRICTLY FORBIDDEN from signaling BUY. Any 1m/5m green candles are "Dead Cat Bounces" or liquidity grabs. Signal SELL or HOLD.
- [CONFLUENCE BONUS] If 1m, 5m, 1h, and 4h momentum are all aligned (all positive or all negative), increase 'confidence' by 1.5. These are high-probability trend-following trades.
- [VOLUME VALIDATION] If Volume Spike < -80%, treat the HTF (1d/4h) trend as the absolute truth. Ignore LTF wiggles; they lack the conviction to flip the trend.
- [B/S RATIO TRAP] If B/S Ratio is high (>10) but 1h/4h momentum is negative, do NOT BUY. This indicates passive "limit-order" buying that is being run over by active market sellers.
- [SPOOF FILTER] IF B/S Ratio > 1000 AND Volume Spike < 10%: FLAG as "Potential Orderbook Spoofing." Lower confidence by 1.5.
- [VOLATILITY SQUEEZE] IF ATR is low AND price is pinched between EMA20 and Resistance (within 0.5%): Signal HOLD for "Volatility Squeeze Breakout."

# LIQUIDITY ZONE INTERPRETATION:
- "wall": Persistent liquidity. "strength": (1-10). Strength 10 walls are the only levels capable of reversing an HTF trend.

# OUTPUT FORMAT (Strict JSON)
{
  "signal": "BUY" | "SELL" | "HOLD",
  "confidence": 0-10,
  "primary_driver": "Identify the 35% or 25% weight factor that decided the move",
  "risk_warning": "Identify the conflicting data point (e.g., HTF Bearish Bias or Low Volume)",
  "trend": "bullish" | "bearish" | "ranging",
  "momentum": "strengthening" | "weakening" | "neutral",
  "sentiment": "extreme fear" | "fear" | "neutral" | "greed" | "extreme greed",
  "risk_level": "low" | "medium" | "high",
  "reasoning": [
    "Point 1: HTF Bias (1d/4h) analysis",
    "Point 2: Orderbook & Liquidity analysis",
    "Point 3: Technical/Volatility confluence"
  ],
  "summary": "1 sentence summarizing why the HTF bias and orderbook led to this decision."
}
`;

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

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║         3-MODE SIGNAL ENGINE  (ADX-Driven)                       ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║ MODE 1 — MEAN REVERSION  (ADX < 18)                              ║
 * ║   Sideways market. Buy oversold dips, sell overbought peaks.     ║
 * ║   Primary: Bollinger %B extremes, RSI, S/R proximity             ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║ MODE 2 — MOMENTUM         (ADX 18–28)                            ║
 * ║   Trend building. Buy accelerating strength, sell weakness.      ║
 * ║   Primary: EMA cross, MACD histogram expansion, RSI 50–68 zone  ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║ MODE 3 — TREND FOLLOWING  (ADX > 28)                             ║
 * ║   Strong trend. Trade WITH the EMA regime. Regime Gate active.   ║
 * ║   Primary: EMA alignment, ADX strength, h1 momentum             ║
 * ╚══════════════════════════════════════════════════════════════════╝
 * Smooth linear blending is applied at mode boundaries (18-22, 24-28)
 * so signals don't whipsaw when ADX is right on a threshold.
 */
function computeSignal(payload) {
    let bullScore = 0;
    const reasoning = [];

    const h1      = payload.momentum?.h1  ?? 0;
    const m5      = payload.momentum?.m5  ?? 0;
    const m1      = payload.momentum?.m1  ?? 0;
    const rsi     = payload.indicators?.rsi ?? 50;
    const macdHist= payload.indicators?.macd?.histogram ?? 0;
    const macdLine= payload.indicators?.macd?.MACD ?? 0;
    const macdSig = payload.indicators?.macd?.signal ?? 0;
    const pb      = payload.indicators?.bollingerBands?.pb ?? 0.5;
    const adx     = payload.indicators?.adx ?? 20;
    const ema20   = payload.indicators?.ema20 ?? 0;
    const ema50   = payload.indicators?.ema50 ?? 0;
    const price   = payload.currentPrice;
    const support    = payload.marketStructure?.support    ?? 0;
    const resistance = payload.marketStructure?.resistance ?? 0;
    const cp = payload.chartPatterns ?? {};
    const zones = Array.isArray(payload.liquidityZones) ? payload.liquidityZones : [];

    // ── MODE DETECTION ──────────────────────────────────────────────────────
    // ADX < 18  → pure REVERSION
    // ADX 18-22 → blend of REVERSION (fading) + MOMENTUM (rising)
    // ADX 22-28 → pure MOMENTUM
    // ADX 24-28 → blend of MOMENTUM (fading) + TRENDING (rising)
    // ADX > 28  → pure TRENDING
    const revWeight  = adx < 18 ? 1.0 : adx < 22 ? (22 - adx) / 4 : 0;
    const trendWeight= adx > 28 ? 1.0 : adx > 24 ? (adx - 24) / 4 : 0;
    const momWeight  = Math.max(0, 1.0 - revWeight - trendWeight);

    const modeLabel = adx < 18 ? '↔️ REVERSION'
                    : adx < 22 ? '〰️ REV→MOM'
                    : adx < 24 ? '⚡ MOMENTUM'
                    : adx < 28 ? '〰️ MOM→TREND'
                    :            '📈 TRENDING';

    reasoning.push(`[MODE] ${modeLabel} (ADX=${adx.toFixed(1)}) [rev=${revWeight.toFixed(2)} mom=${momWeight.toFixed(2)} trend=${trendWeight.toFixed(2)}]`);

    // ══════════════════════════════════════════════════════════════════════
    // ① MEAN REVERSION — buy oversold, sell overbought
    //    Best when market is chopping in a range (ADX < 18)
    // ══════════════════════════════════════════════════════════════════════
    if (revWeight > 0) {
        const w = revWeight;
        // Bollinger %B extremes
        if      (pb <= 0.00) { bullScore += 0.55 * w; reasoning.push(`[REV-BB] Below lower band (PB=${pb.toFixed(2)}) 🟢 BOUNCE`); }
        else if (pb < 0.08)  { bullScore += 0.40 * w; reasoning.push(`[REV-BB] Lower band extreme (PB=${pb.toFixed(2)}) → BUY`); }
        else if (pb < 0.18)  { bullScore += 0.22 * w; }
        else if (pb > 1.00)  { bullScore -= 0.55 * w; reasoning.push(`[REV-BB] Above upper band (PB=${pb.toFixed(2)}) 🔴 FADE`); }
        else if (pb > 0.92)  { bullScore -= 0.40 * w; reasoning.push(`[REV-BB] Upper band extreme (PB=${pb.toFixed(2)}) → SELL`); }
        else if (pb > 0.82)  { bullScore -= 0.22 * w; }
        // RSI extremes confirm reversion
        if      (rsi < 22) { bullScore += 0.30 * w; reasoning.push(`[REV-RSI] Extreme oversold (${rsi.toFixed(1)}) → bounce`); }
        else if (rsi < 32) { bullScore += 0.15 * w; reasoning.push(`[REV-RSI] Oversold (${rsi.toFixed(1)})`); }
        else if (rsi < 42) { bullScore += 0.07 * w; }
        else if (rsi > 78) { bullScore -= 0.30 * w; reasoning.push(`[REV-RSI] Extreme overbought (${rsi.toFixed(1)}) → reversal`); }
        else if (rsi > 68) { bullScore -= 0.15 * w; reasoning.push(`[REV-RSI] Overbought (${rsi.toFixed(1)})`); }
        else if (rsi > 58) { bullScore -= 0.07 * w; }
        // S/R proximity amplifies
        if (support    > 0 && (price - support)    / price < 0.008) { bullScore += 0.20 * w; reasoning.push(`[REV-SR] At support $${support.toFixed(0)}`); }
        if (resistance > 0 && (resistance - price) / price < 0.008) { bullScore -= 0.20 * w; reasoning.push(`[REV-SR] At resistance $${resistance.toFixed(0)}`); }
        // Confirm with short-term momentum (avoid catching falling knife)
        if (pb < 0.20 && h1 > 0) { bullScore += 0.10 * w; reasoning.push('[REV-CONF] Oversold + h1 positive → confirmed bounce'); }
        if (pb > 0.80 && h1 < 0) { bullScore -= 0.10 * w; reasoning.push('[REV-CONF] Overbought + h1 negative → confirmed rejection'); }
        // Reversal candlestick patterns
        if (cp.doubleBottom || cp.tripleBottom)  { bullScore += 0.18 * w; reasoning.push('[REV-PAT] Bullish reversal at lows'); }
        if (cp.doubleTop    || cp.tripleTop)     { bullScore -= 0.18 * w; reasoning.push('[REV-PAT] Bearish reversal at highs'); }
        if (cp.engulfing === 'bullish_engulfing') { bullScore += 0.10 * w; }
        if (cp.engulfing === 'bearish_engulfing') { bullScore -= 0.10 * w; }
    }

    // ══════════════════════════════════════════════════════════════════════
    // ② MOMENTUM TRADING — follow accelerating price movement
    //    Buy strength when a move is building, sell into weakness
    //    RSI zones: bull momentum = 50-68, bear momentum = 32-50
    //    Key: buy MACD expansion BEFORE it peaks, not after
    // ══════════════════════════════════════════════════════════════════════
    if (momWeight > 0) {
        const w = momWeight;
        // EMA alignment — core momentum confirmation
        if (ema20 > 0 && ema50 > 0) {
            if (price > ema20 && ema20 > ema50) {
                bullScore += 0.22 * w;
                reasoning.push(`[MOM-EMA] Bullish alignment — price > EMA20 > EMA50`);
            } else if (price < ema20 && ema20 < ema50) {
                bullScore -= 0.22 * w;
                reasoning.push(`[MOM-EMA] Bearish alignment — price < EMA20 < EMA50`);
            }
        }
        // RSI momentum zone (the "sweet spot" — not oversold, not overbought)
        // Bull momentum: RSI 50-68 = trend has room to run
        // Bear momentum: RSI 32-50 = selling pressure still active
        if      (rsi >= 58 && rsi <= 68) { bullScore += 0.20 * w; reasoning.push(`[MOM-RSI] Bull momentum zone (${rsi.toFixed(1)}) — trend has room`); }
        else if (rsi >= 50 && rsi <  58) { bullScore += 0.10 * w; }
        else if (rsi >= 32 && rsi <= 42) { bullScore -= 0.20 * w; reasoning.push(`[MOM-RSI] Bear momentum zone (${rsi.toFixed(1)}) — selling active`); }
        else if (rsi > 42  && rsi <  50) { bullScore -= 0.10 * w; }
        // Extreme RSI still signals reversal even in momentum mode
        else if (rsi < 25) { bullScore += 0.25 * w; reasoning.push(`[MOM-RSI] Oversold crash bottom (${rsi.toFixed(1)}) → snap back`); }
        else if (rsi > 80) { bullScore -= 0.25 * w; reasoning.push(`[MOM-RSI] Overbought blow-off (${rsi.toFixed(1)}) → fade`); }
        // MACD histogram direction + expansion (core momentum indicator)
        // Expanding histogram = momentum building, contracting = fading
        if (macdLine > macdSig && macdHist > 0) {
            bullScore += 0.18 * w;
            reasoning.push(`[MOM-MACD] Bullish histogram expanding (hist=${macdHist.toFixed(3)})`);
        } else if (macdLine > macdSig && macdHist <= 0) {
            bullScore += 0.05 * w; // Cross but hist still negative — early stage
        } else if (macdLine < macdSig && macdHist < 0) {
            bullScore -= 0.18 * w;
            reasoning.push(`[MOM-MACD] Bearish histogram expanding (hist=${macdHist.toFixed(3)})`);
        } else if (macdLine < macdSig && macdHist >= 0) {
            bullScore -= 0.05 * w;
        }
        // h1 momentum quality (is the momentum strong or weak?)
        if      (h1 > 5)  { bullScore += 0.15 * w; reasoning.push(`[MOM-H1] Strong upward momentum h1=${h1.toFixed(1)}%`); }
        else if (h1 > 2)  { bullScore += 0.08 * w; }
        else if (h1 < -5) { bullScore -= 0.15 * w; reasoning.push(`[MOM-H1] Strong downward momentum h1=${h1.toFixed(1)}%`); }
        else if (h1 < -2) { bullScore -= 0.08 * w; }
        // Momentum continuation patterns
        if (cp.flag === 'bull_flag')                               { bullScore += 0.12 * w; reasoning.push('[MOM-PAT] Bull flag — momentum continuation'); }
        if (cp.flag === 'bear_flag')                               { bullScore -= 0.12 * w; reasoning.push('[MOM-PAT] Bear flag — momentum continuation'); }
        if (cp.breakout === 'bullish' || cp.breakout === true)     { bullScore += 0.15 * w; reasoning.push('[MOM-PAT] Bullish momentum breakout'); }
        if (cp.breakout === 'bearish')                             { bullScore -= 0.15 * w; reasoning.push('[MOM-PAT] Bearish momentum breakdown'); }
    }

    // ══════════════════════════════════════════════════════════════════════
    // ③ TREND FOLLOWING — ride established directional moves
    //    Only fires in strong trends (ADX > 28). Regime gate prevents
    //    counter-trend trades unless there's an extreme reversal signal.
    // ══════════════════════════════════════════════════════════════════════
    if (trendWeight > 0) {
        const w = trendWeight;
        // EMA cross — the backbone of trend following
        if (ema20 > 0 && ema50 > 0) {
            if (price > ema20 && ema20 > ema50)      { bullScore += 0.20 * w; reasoning.push('[TRD-EMA] Bullish: price > EMA20 > EMA50'); }
            else if (price < ema20 && ema20 < ema50) { bullScore -= 0.20 * w; reasoning.push('[TRD-EMA] Bearish: price < EMA20 < EMA50'); }
        }
        // ADX-confirmed trend strength
        if (adx > 32 && h1 > 0) { bullScore += 0.18 * w; reasoning.push(`[TRD-ADX] Strong uptrend ADX=${adx.toFixed(1)}`); }
        if (adx > 32 && h1 < 0) { bullScore -= 0.18 * w; reasoning.push(`[TRD-ADX] Strong downtrend ADX=${adx.toFixed(1)}`); }
        // Momentum direction
        if      (h1 > 4)  { bullScore += 0.10 * w; reasoning.push(`[TRD-MOM] h1=${h1.toFixed(1)}% bullish`); }
        else if (h1 > 1)  { bullScore += 0.05 * w; }
        else if (h1 < -4) { bullScore -= 0.10 * w; reasoning.push(`[TRD-MOM] h1=${h1.toFixed(1)}% bearish`); }
        else if (h1 < -1) { bullScore -= 0.05 * w; }
        // RSI extremes can signal reversal even in a strong trend
        if      (rsi < 20) { bullScore += 0.28 * w; reasoning.push(`[TRD-RSI] Extreme crash bottom (${rsi.toFixed(1)}) → reversal`); }
        else if (rsi < 30) { bullScore += 0.15 * w; reasoning.push(`[TRD-RSI] Oversold in trend (${rsi.toFixed(1)}) → bounce`); }
        else if (rsi > 82) { bullScore -= 0.28 * w; reasoning.push(`[TRD-RSI] Extreme blow-off top (${rsi.toFixed(1)}) → reversal`); }
        else if (rsi > 70) { bullScore -= 0.15 * w; reasoning.push(`[TRD-RSI] Overbought in trend (${rsi.toFixed(1)})`); }
        // Trend continuation patterns
        if (cp.headAndShoulders) { bullScore -= 0.20 * w; reasoning.push('[TRD-PAT] H&S — trend reversal'); }
        if (cp.doubleTop)         { bullScore -= 0.15 * w; }
        if (cp.doubleBottom)      { bullScore += 0.15 * w; }
        // ── REGIME GATE (trend mode only) ────────────────────────────────
        // Never fight a strong trend unless there's an extreme signal
        const bullRegime = ema20 > 0 && ema50 > 0 && price > ema50 && ema20 > ema50;
        const bearRegime = ema20 > 0 && ema50 > 0 && price < ema50 && ema20 < ema50;
        if (bullRegime && bullScore < -0.15) {
            if (!(rsi > 78 || cp.headAndShoulders)) {
                bullScore = Math.max(bullScore, -0.20);
                reasoning.push('[REGIME] 🐂 Bull regime → SELL clamped (no extreme signal)');
            }
        } else if (bearRegime && bullScore > 0.15) {
            if (!(rsi < 30 || cp.doubleBottom || cp.tripleBottom)) {
                bullScore = Math.min(bullScore, 0.20);
                reasoning.push('[REGIME] 🐻 Bear regime → BUY clamped (no oversold signal)');
            } else {
                reasoning.push(`[REGIME] 🐻 Bear regime but RSI=${rsi.toFixed(1)} oversold — BUY allowed`);
            }
        }
    }

    // ── MULTI-TF ALL-ALIGNED CONFLUENCE ────────────────────────────────────
    // When all timeframes agree, boost the signal 1.35x
    const allBull = m1 > 0 && m5 > 0 && h1 > 0;
    const allBear = m1 < 0 && m5 < 0 && h1 < 0;
    if (allBull && bullScore > 0) { bullScore *= 1.35; reasoning.push('[CONF] m1+m5+h1 all bullish → 1.35x'); }
    if (allBear && bullScore < 0) { bullScore *= 1.35; reasoning.push('[CONF] m1+m5+h1 all bearish → 1.35x'); }

    // ── FINAL DECISION ──────────────────────────────────────────────────────
    const confidence = parseFloat(Math.min(10, Math.abs(bullScore) * 10).toFixed(1));
    let signal = 'HOLD';
    // Threshold varies by mode: lower in reversion (more signals), higher in trending
    const threshold = adx < 18 ? 0.28 : adx < 24 ? 0.32 : 0.35;
    if      (bullScore >  threshold) signal = 'BUY';
    else if (bullScore < -threshold) signal = 'SELL';

    reasoning.push(`[DECISION] ${signal} (score: ${bullScore.toFixed(3)}, conf: ${confidence}/10, mode: ${modeLabel})`);
    return { signal, confidence, summary: reasoning[reasoning.length - 1], reasoning, primary_driver: reasoning[1] ?? reasoning[0] };
}


async function runBacktest(symbol, timeframe, startTimeStr, endTimeStr, intervalMins, lookaheadMins, walletConfig = {}) {
    const tableArg = walletConfig.tableArg || 'testCandle';
    const candleTable = tableArg === 'binanceCandle' ? prisma.binanceCandle : prisma.testCandle;

    const startTime = new Date(startTimeStr);
    const endTime = new Date(endTimeStr);
    
    // --- UI Server Setup ---
    const app = express();
    const server = http.createServer(app);
    const io = new Server(server, { cors: { origin: "*" } });

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
    });

    server.listen(4000, () => {
        console.log('\n======================================================');
        console.log('🚀 LIVE UI VISUALIZER is running at: http://localhost:4000');
        console.log('Open this link in your browser to view the chart!');
        console.log('======================================================\n');
    });

    // -----------------------

    console.log(`\n======================================================`);
    console.log(`Data loaded successfully. The UI visualizer will remain active at http://localhost:4000.`);
    console.log(`Press Ctrl+C to exit.`);

    const runAI  = process.argv.includes('--ai');
    const useLLM = process.argv.includes('--llm');

    if (!runAI) {
        console.log(`\n[INFO] AI Evaluation is disabled. Use '--ai' (rule-based) or '--ai --llm' (Groq/Gemini) to enable.`);
        return;
    }

    const mode = useLLM ? 'LLM (Groq/Gemini)' : 'Rule-Based Engine';
    console.log(`\n[INFO] AI Evaluation ENABLED – using ${mode}. Starting historical analysis...`);
    let currentTestTime = new Date(startTime);
    let results = [];
    let stats = { WIN: 0, LOSS: 0, NEUTRAL: 0, NO_DATA: 0, TOTAL_TRADES: 0 };
    let cooldownCandles = 0; // candles remaining before next trade allowed
    let lastSignalDir   = null; // track last trade direction for cooldown logic
    
    // Paper Trading Wallet — initialized from user input
    const totalBalance  = walletConfig.totalBalance  ?? 100000;
    const stocksAmount  = walletConfig.stocksAmount   ?? 50000;
    const cashAmount    = totalBalance - stocksAmount;
    let wallet = { quote: cashAmount, base: 0, initialized: false, initialValue: totalBalance };
    console.log(`\n[WALLET] Starting with $${cashAmount.toFixed(2)} cash + $${stocksAmount.toFixed(2)} in stocks (Total: $${totalBalance.toFixed(2)})\n`);

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

            wallet.initialized = true;
            console.log(`💰 WALLET INITIALIZED: $${cashAmount.toFixed(2)} Cash | ${wallet.base.toFixed(4)} Base (≈$${stocksAmount.toFixed(2)})`);

        }

        try {
            let parsedResult;
            if (useLLM) {
                const resultStr = await queryLLM(systemPrompt_weighted, payload);
                parsedResult = JSON.parse(resultStr.replace(/```json/g, '').replace(/```/g, '').trim());
            } else {
                parsedResult = computeSignal(payload);
            }
            
            console.log(`SIGNAL: ${parsedResult.signal} (Conf: ${parsedResult.confidence}) - ${parsedResult.summary}`);
            
            // ── Dynamic Position Sizing: PnL-state × Confidence ─────────────
            const curBaseValue = wallet.base * payload.currentPrice;
            const curPortfolio = wallet.quote + curBaseValue;
            const curPnl       = curPortfolio - wallet.initialValue;
            const pnlPct       = curPnl / wallet.initialValue;

            const conf = parsedResult.confidence ?? 5;
            const confFraction = conf >= 7 ? 0.80 : conf >= 5 ? 0.50 : 0.30;

            // PnL multiplier — tightened thresholds so a tiny early loss
            // doesn't immediately trigger aggressive RECOVER mode
            let pnlMultiplier;
            if      (pnlPct < -0.15) { pnlMultiplier = 1.4; }  // Deep loss (>15%)
            else if (pnlPct < -0.05) { pnlMultiplier = 1.1; }  // Mild loss (5-15%)
            else if (pnlPct <  0.05) { pnlMultiplier = 1.0; }  // Near breakeven
            else if (pnlPct <  0.15) { pnlMultiplier = 0.7; }  // Mild profit (5-15%)
            else                     { pnlMultiplier = 0.5; }  // Good profit (>15%)

            const sizeFraction = Math.min(0.90, confFraction * pnlMultiplier);
            const modeTag = pnlPct < -0.15 ? '🔴RECOVER' : pnlPct < -0.05 ? '🟡LOSS' : pnlPct < 0.05 ? '⚪BREAK-EVEN' : pnlPct < 0.15 ? '🟢PROFIT' : '💎PROTECT';

            // ── Minimum trade value guard ────────────────────────────────────
            // Skip trades smaller than $50 — micro-trades add noise, eat position,
            // and get counted as real trades skewing win-rate stats.
            const MIN_TRADE_USD = 50;

            // ── Cooldown filter: skip same-direction signal if recently traded ────
            // Prevents cascade buying (3-4 consecutive BUYs depleting cash)
            if (cooldownCandles > 0) {
                cooldownCandles--;
                if (parsedResult.signal === lastSignalDir) {
                    console.log(`OUTCOME: Cooldown (${cooldownCandles+1} remaining) | Portfolio: $${(wallet.quote + wallet.base * payload.currentPrice).toFixed(2)} (PnL: $${(wallet.quote + wallet.base * payload.currentPrice - wallet.initialValue).toFixed(2)})`);
                    currentTestTime = new Date(currentTestTime.getTime() + intervalMins * 60000);
                    continue;
                }
            }

            // ── Minimum confidence filter per mode ───────────────────────────────
            // REVERSION mode has more noise — require conf ≥ 4 to trade
            // MOMENTUM / TRENDING — conf ≥ 3 is fine (clearer signals)
            const modeLabel = parsedResult.summary ?? '';
            const isReversionMode = modeLabel.includes('REVERSION') || modeLabel.includes('REV→MOM');
            const minConf = isReversionMode ? 4.0 : 3.0;
            if (parsedResult.signal !== 'HOLD' && (parsedResult.confidence ?? 0) < minConf) {
                console.log(`OUTCOME: Skipped (low conf ${parsedResult.confidence}/${minConf} in ${isReversionMode ? 'REVERSION' : 'MOM/TREND'} mode) | Portfolio: $${(wallet.quote + wallet.base * payload.currentPrice).toFixed(2)} (PnL: $${(wallet.quote + wallet.base * payload.currentPrice - wallet.initialValue).toFixed(2)})`);
                currentTestTime = new Date(currentTestTime.getTime() + intervalMins * 60000);
                continue;
            }

            if (parsedResult.signal === 'BUY' && wallet.quote > MIN_TRADE_USD) {
                const amountToBuy = wallet.quote * sizeFraction;
                if (amountToBuy < MIN_TRADE_USD) {
                    // Not enough left to place a meaningful trade
                    currentTestTime = new Date(currentTestTime.getTime() + intervalMins * 60000);
                    continue;
                }
                const gainedBase = amountToBuy / payload.currentPrice;
                wallet.base += gainedBase;
                wallet.quote -= amountToBuy;
                console.log(`💰 WALLET [BUY ${modeTag} x${(sizeFraction*100).toFixed(0)}%]: Spent $${amountToBuy.toFixed(2)} → ${gainedBase.toFixed(4)} Base`);
            } else if (parsedResult.signal === 'SELL' && wallet.base > 0.0001) {
                const amountToSell = wallet.base * sizeFraction;
                const gainedQuote  = amountToSell * payload.currentPrice;
                if (gainedQuote < MIN_TRADE_USD) {
                    // Position too small to bother selling
                    currentTestTime = new Date(currentTestTime.getTime() + intervalMins * 60000);
                    continue;
                }
                wallet.quote += gainedQuote;
                wallet.base  -= amountToSell;
                console.log(`💰 WALLET [SELL ${modeTag} x${(sizeFraction*100).toFixed(0)}%]: Sold ${amountToSell.toFixed(4)} Base → $${gainedQuote.toFixed(2)}`);
            } else if (parsedResult.signal !== 'HOLD') {
                // BUY but no quote, or SELL but no base — skip
                currentTestTime = new Date(currentTestTime.getTime() + intervalMins * 60000);
                continue;
            }
            // HOLD falls through
            // On an executed trade, set cooldown
            if (parsedResult.signal === 'BUY' || parsedResult.signal === 'SELL') {
                cooldownCandles = 2;
                lastSignalDir   = parsedResult.signal;
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

                io.emit('ai_step', {
                    time: Math.floor(currentTestTime.getTime() / 1000),
                    signal: parsedResult.signal,
                    reasoning: Array.isArray(parsedResult.reasoning) ? parsedResult.reasoning.join(' | ') : parsedResult.summary,
                    price: payload.currentPrice,
                    outcome: evalResult.outcome,
                    portfolioValue: portfolioValue,
                    pnl: pnl,
                    wallet: { ...wallet, baseValue }
                });
            } else {
                console.log(`OUTCOME: Skipped (HOLD) | Portfolio: $${portfolioValue.toFixed(2)} (PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)})`);
                io.emit('ai_step', {
                    time: Math.floor(currentTestTime.getTime() / 1000),
                    signal: 'HOLD',
                    reasoning: Array.isArray(parsedResult.reasoning) ? parsedResult.reasoning.join(' | ') : parsedResult.summary,
                    price: payload.currentPrice,
                    portfolioValue: portfolioValue,
                    pnl: pnl,
                    wallet: { ...wallet, baseValue }
                });
            }
            
            // Delay: 0ms for rule-based (instant), 1s for LLM (avoid API rate limits)
            await new Promise(resolve => setTimeout(resolve, useLLM ? 1000 : 0));
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

    console.log(`---------------------------------------------------`);
    console.log(`FINAL PORTFOLIO VALUE: $${(wallet.quote + (wallet.base * results[results.length-1]?.price || 0)).toFixed(2)}`);
    console.log(`---------------------------------------------------`);

    const reportPath = `./backtest_results_${symbol}_${Date.now()}.json`;
    fs.writeFileSync(reportPath, JSON.stringify({ stats, results }, null, 2));
    console.log(`Detailed report saved to: ${reportPath}`);
    console.log(`\n======================================================`);
    console.log(`Backtest complete! The UI visualizer will remain active at http://localhost:4000.`);
    console.log(`Press Ctrl+C to exit.`);
}

const args = process.argv.slice(2);
const flagIndex = args.findIndex(a => a === '--ai' || a === '--llm');
const tableFlag = args.find(a => a.startsWith('--table='));
const tableArg  = tableFlag ? tableFlag.split('=')[1] : 'testCandle';
const useLLM    = args.includes('--llm');
const posArgs   = args.filter(a => !a.startsWith('--'));

if (posArgs.length < 4) {
    console.log("Usage: node backtest.js <symbol> <timeframe> <start_iso> <end_iso> [step_mins] [lookahead_mins] [--ai] [--table=testCandle|binanceCandle]");
    console.log("Example: node backtest.js BTCUSDT 1d 2023-01-01 2024-12-31 --ai --table=binanceCandle");
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
const tfMap = { '1m':1, '3m':3, '5m':5, '15m':15, '30m':30, '1h':60, '2h':120, '4h':240, '6h':360, '8h':480, '12h':720, '1d':1440, '3d':4320, '1w':10080, '1M':43200 };
const stepMins = posArgs[4] ? parseInt(posArgs[4]) : (tfMap[timeframe] || 1440);
const lookaheadMins = posArgs[5] ? parseInt(posArgs[5]) : stepMins * 2;

// Interactive wallet setup
const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

(async () => {
    console.log('\n════════════════════════════════════════════════════════════════');
    console.log('             🐺 Wolf of Noida — Backtest Setup                  ');
    console.log('════════════════════════════════════════════════════════════════\n');
    console.log('  Your wallet has two parts:');
    console.log('  1️⃣  Cash available  — money sitting idle, used to BUY stocks');
    console.log('  2️⃣  Already in stocks — amount already invested at start price');
    console.log('  Total Balance = Cash + Stocks\n');

    const cashRaw    = await ask('💵 Cash available to trade (USD) [default: 50000]: ');
    const stocksRaw  = await ask('📈 Already invested in stocks  (USD) [default: 50000]: ');
    rl.close();

    const cashAmount   = (cashRaw.trim()   !== '') ? parseFloat(cashRaw)   : 50000;
    const stocksAmount = (stocksRaw.trim() !== '') ? parseFloat(stocksRaw) : 50000;
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
        { totalBalance, stocksAmount, cashAmount, tableArg }
    ).catch(console.error);
})();
