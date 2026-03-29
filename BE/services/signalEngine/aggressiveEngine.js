'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║      AGGRESSIVE SIGNAL ENGINE  —  High Risk / High Reward        ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║ This engine is tuned to MAXIMIZE PROFIT at the cost of higher    ║
 * ║ drawdowns and more frequent stop-losses.                         ║
 * ║                                                                  ║
 * ║ KEY DIFFERENCES vs Conservative Engine:                          ║
 * ║  • Lower signal thresholds  → more frequent trade signals        ║
 * ║  • Higher score weights     → stronger conviction per indicator   ║
 * ║  • Regime gate DISABLED     → will fight macro trend if needed   ║
 * ║  • Wider RSI entry zones    → buys earlier, holds longer         ║
 * ║  • Larger confluence boost  → 1.65x when all TFs agree           ║
 * ║  • MACD early cross treated as full signal (not partial)         ║
 * ║                                                                  ║
 * ║ Best used in: Bull markets, momentum phases, breakout plays      ║
 * ║ Avoid using in: Bear markets (2022-type), high-fee environments  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * @module aggressiveEngine
 */

/**
 * Compute a high-risk, profit-maximizing trading signal from a market payload.
 *
 * @param {object} payload
 * @param {number} payload.currentPrice
 * @param {object} payload.indicators
 * @param {number} payload.indicators.rsi
 * @param {{ histogram: number, MACD: number, signal: number }} payload.indicators.macd
 * @param {{ pb: number }} payload.indicators.bollingerBands
 * @param {number} payload.indicators.ema20
 * @param {number} payload.indicators.ema50
 * @param {number} payload.indicators.adx
 * @param {number} payload.indicators.atr
 * @param {{ support: number, resistance: number }} payload.marketStructure
 * @param {{ h1?: number, m5?: number, m1?: number }} payload.momentum
 * @param {object} payload.chartPatterns
 * @param {Array}  payload.liquidityZones
 *
 * @returns {{
 *   signal: 'BUY' | 'SELL' | 'HOLD',
 *   confidence: number,
 *   summary: string,
 *   reasoning: string[],
 *   primary_driver: string
 * }}
 */
function computeAggressiveSignal(payload) {
    let bullScore = 0;
    const reasoning = [];

    // ── Score multiplier: every indicator contribution is amplified ──────────
    // This is the primary "risk dial" — increase to be more aggressive.
    const AGGRESSION = 1.35;

    const h1 = payload.momentum?.h1 ?? 0;
    const m5 = payload.momentum?.m5 ?? 0;
    const m1 = payload.momentum?.m1 ?? 0;
    const rsi = payload.indicators?.rsi ?? 50;
    const macdHist = payload.indicators?.macd?.histogram ?? 0;
    const macdLine = payload.indicators?.macd?.MACD ?? 0;
    const macdSig  = payload.indicators?.macd?.signal ?? 0;
    const pb       = payload.indicators?.bollingerBands?.pb ?? 0.5;
    const adx      = payload.indicators?.adx ?? 20;
    const ema20    = payload.indicators?.ema20 ?? 0;
    const ema50    = payload.indicators?.ema50 ?? 0;
    const price    = payload.currentPrice;
    const support    = payload.marketStructure?.support ?? 0;
    const resistance = payload.marketStructure?.resistance ?? 0;
    const cp = payload.chartPatterns ?? {};

    // ── MODE DETECTION (same boundaries as conservative engine) ─────────────
    const revWeight   = adx < 18 ? 1.0 : adx < 22 ? (22 - adx) / 4 : 0;
    const trendWeight = adx > 28 ? 1.0 : adx > 24 ? (adx - 24) / 4 : 0;
    const momWeight   = Math.max(0, 1.0 - revWeight - trendWeight);

    const modeLabel = adx < 18 ? '↔️ REVERSION'
        : adx < 22 ? '〰️ REV→MOM'
            : adx < 24 ? '⚡ MOMENTUM'
                : adx < 28 ? '〰️ MOM→TREND'
                    : '📈 TRENDING';

    reasoning.push(`[MODE] ${modeLabel} (ADX=${adx.toFixed(1)}) [rev=${revWeight.toFixed(2)} mom=${momWeight.toFixed(2)} trend=${trendWeight.toFixed(2)}] 🔥AGGRESSIVE`);

    // ══════════════════════════════════════════════════════════════════════
    // ① MEAN REVERSION — amplified weights, wider Bollinger ranges
    // ══════════════════════════════════════════════════════════════════════
    if (revWeight > 0) {
        const w = revWeight * AGGRESSION;
        // Wider Bollinger bands response — buy sooner on the way down
        if (pb <= 0.00)      { bullScore += 0.65 * w; reasoning.push(`[REV-BB] Below lower band (PB=${pb.toFixed(2)}) 🟢 BOUNCE`); }
        else if (pb < 0.10)  { bullScore += 0.50 * w; reasoning.push(`[REV-BB] Lower band extreme (PB=${pb.toFixed(2)}) → AGGRESSIVE BUY`); }
        else if (pb < 0.25)  { bullScore += 0.30 * w; reasoning.push(`[REV-BB] Lower band approach (PB=${pb.toFixed(2)}) → Early BUY`); }
        else if (pb > 1.00)  { bullScore -= 0.65 * w; reasoning.push(`[REV-BB] Above upper band (PB=${pb.toFixed(2)}) 🔴 FADE`); }
        else if (pb > 0.90)  { bullScore -= 0.50 * w; reasoning.push(`[REV-BB] Upper band extreme (PB=${pb.toFixed(2)}) → SELL`); }
        else if (pb > 0.75)  { bullScore -= 0.30 * w; reasoning.push(`[REV-BB] Upper band approach (PB=${pb.toFixed(2)}) → Early SELL`); }
        // RSI — wider oversold/overbought zones
        if (rsi < 30)        { bullScore += 0.35 * w; reasoning.push(`[REV-RSI] Oversold (${rsi.toFixed(1)}) → aggressive bounce`); }
        else if (rsi < 42)   { bullScore += 0.18 * w; reasoning.push(`[REV-RSI] Approaching oversold (${rsi.toFixed(1)})`); }
        else if (rsi > 70)   { bullScore -= 0.35 * w; reasoning.push(`[REV-RSI] Overbought (${rsi.toFixed(1)}) → aggressive fade`); }
        else if (rsi > 58)   { bullScore -= 0.18 * w; reasoning.push(`[REV-RSI] Approaching overbought (${rsi.toFixed(1)})`); }
        // S/R — wider proximity zone (0.8% → 1.5%)
        if (support > 0 && (price - support) / price < 0.015)       { bullScore += 0.25 * w; reasoning.push(`[REV-SR] Near support $${support.toFixed(0)}`); }
        if (resistance > 0 && (resistance - price) / price < 0.015) { bullScore -= 0.25 * w; reasoning.push(`[REV-SR] Near resistance $${resistance.toFixed(0)}`); }
        // Momentum confirm (no falling knife filter — bet on the bounce)
        if (h1 > 0) { bullScore += 0.15 * w; reasoning.push('[REV-CONF] h1 positive → bounce play'); }
        if (h1 < 0) { bullScore -= 0.15 * w; reasoning.push('[REV-CONF] h1 negative → rejection play'); }
        // Reversal patterns
        if (cp.doubleBottom || cp.tripleBottom) { bullScore += 0.22 * w; reasoning.push('[REV-PAT] Bullish reversal at lows'); }
        if (cp.doubleTop || cp.tripleTop)       { bullScore -= 0.22 * w; reasoning.push('[REV-PAT] Bearish reversal at highs'); }
        if (cp.engulfing === 'bullish_engulfing') { bullScore += 0.15 * w; reasoning.push('[REV-PAT] Bullish engulfing'); }
        if (cp.engulfing === 'bearish_engulfing') { bullScore -= 0.15 * w; reasoning.push('[REV-PAT] Bearish engulfing'); }
    }

    // ══════════════════════════════════════════════════════════════════════
    // ② MOMENTUM TRADING — earlier entries, treat MACD cross as full signal
    // ══════════════════════════════════════════════════════════════════════
    if (momWeight > 0) {
        const w = momWeight * AGGRESSION;
        // EMA alignment
        if (ema20 > 0 && ema50 > 0) {
            if (price > ema20 && ema20 > ema50) {
                bullScore += 0.28 * w;
                reasoning.push(`[MOM-EMA] Bullish alignment — price > EMA20 > EMA50`);
            } else if (price < ema20 && ema20 < ema50) {
                bullScore -= 0.28 * w;
                reasoning.push(`[MOM-EMA] Bearish alignment — price < EMA20 < EMA50`);
            } else if (price > ema50 && ema20 <= ema50) {
                // Price reclaiming EMA50 — aggressive early entry
                bullScore += 0.12 * w;
                reasoning.push(`[MOM-EMA] Price above EMA50, EMA20 catching up → early bull signal`);
            }
        }
        // RSI momentum zones — wider bull zone (50→75) vs conservative (58→68)
        if (rsi >= 50 && rsi <= 75)      { bullScore += 0.25 * w; reasoning.push(`[MOM-RSI] Aggressive bull zone (${rsi.toFixed(1)}) — ride the trend`); }
        else if (rsi >= 42 && rsi < 50)  { bullScore += 0.12 * w; }
        else if (rsi >= 25 && rsi <= 45) { bullScore -= 0.25 * w; reasoning.push(`[MOM-RSI] Bear momentum zone (${rsi.toFixed(1)}) — sell`); }
        else if (rsi > 45 && rsi < 50)  { bullScore -= 0.12 * w; }
        // Extreme RSI
        else if (rsi < 25) { bullScore += 0.35 * w; reasoning.push(`[MOM-RSI] Crash bottom (${rsi.toFixed(1)}) → snap back bet`); }
        else if (rsi > 80) { bullScore -= 0.35 * w; reasoning.push(`[MOM-RSI] Blow-off top (${rsi.toFixed(1)}) → aggressive short`); }
        // MACD — early cross treated as full signal (not 0.05 penalty)
        if (macdLine > macdSig && macdHist > 0) {
            bullScore += 0.25 * w;
            reasoning.push(`[MOM-MACD] Bullish expansion (hist=${macdHist.toFixed(3)})`);
        } else if (macdLine > macdSig && macdHist <= 0) {
            // Conservative: +0.05. Aggressive: treat as BUY early
            bullScore += 0.18 * w;
            reasoning.push(`[MOM-MACD] Bullish cross — early entry (hist still negative)`);
        } else if (macdLine < macdSig && macdHist < 0) {
            bullScore -= 0.25 * w;
            reasoning.push(`[MOM-MACD] Bearish expansion (hist=${macdHist.toFixed(3)})`);
        } else if (macdLine < macdSig && macdHist >= 0) {
            bullScore -= 0.18 * w;
            reasoning.push(`[MOM-MACD] Bearish cross — early exit (hist still positive)`);
        }
        // h1 momentum
        if (h1 > 3)       { bullScore += 0.20 * w; reasoning.push(`[MOM-H1] Strong up momentum h1=${h1.toFixed(1)}%`); }
        else if (h1 > 1)  { bullScore += 0.12 * w; }
        else if (h1 < -3) { bullScore -= 0.20 * w; reasoning.push(`[MOM-H1] Strong down momentum h1=${h1.toFixed(1)}%`); }
        else if (h1 < -1) { bullScore -= 0.12 * w; }
        // Patterns
        if (cp.flag === 'bull_flag')                           { bullScore += 0.18 * w; reasoning.push('[MOM-PAT] Bull flag — momentum continuation'); }
        if (cp.flag === 'bear_flag')                           { bullScore -= 0.18 * w; reasoning.push('[MOM-PAT] Bear flag — momentum continuation'); }
        if (cp.breakout === 'bullish' || cp.breakout === true) { bullScore += 0.22 * w; reasoning.push('[MOM-PAT] Bullish breakout — go hard'); }
        if (cp.breakout === 'bearish')                         { bullScore -= 0.22 * w; reasoning.push('[MOM-PAT] Bearish breakdown — exit fast'); }
    }

    // ══════════════════════════════════════════════════════════════════════
    // ③ TREND FOLLOWING — stronger weights, hold through dips
    // ══════════════════════════════════════════════════════════════════════
    if (trendWeight > 0) {
        const w = trendWeight * AGGRESSION;
        if (ema20 > 0 && ema50 > 0) {
            if (price > ema20 && ema20 > ema50)  { bullScore += 0.28 * w; reasoning.push('[TRD-EMA] Bullish: price > EMA20 > EMA50'); }
            else if (price < ema20 && ema20 < ema50) { bullScore -= 0.28 * w; reasoning.push('[TRD-EMA] Bearish: price < EMA20 < EMA50'); }
        }
        // ADX strength — amplified
        if (adx > 30 && h1 > 0)  { bullScore += 0.25 * w; reasoning.push(`[TRD-ADX] Strong uptrend ADX=${adx.toFixed(1)} — stay in`); }
        if (adx > 30 && h1 < 0)  { bullScore -= 0.25 * w; reasoning.push(`[TRD-ADX] Strong downtrend ADX=${adx.toFixed(1)} — stay out`); }
        // Momentum
        if (h1 > 2)       { bullScore += 0.15 * w; reasoning.push(`[TRD-MOM] h1=${h1.toFixed(1)}% bullish`); }
        else if (h1 > 0)  { bullScore += 0.07 * w; }
        else if (h1 < -2) { bullScore -= 0.15 * w; reasoning.push(`[TRD-MOM] h1=${h1.toFixed(1)}% bearish`); }
        else if (h1 < 0)  { bullScore -= 0.07 * w; }
        // RSI — only reversal at extremes (less hair-trigger than conservative)
        if (rsi < 18)      { bullScore += 0.35 * w; reasoning.push(`[TRD-RSI] Extreme crash bottom — strong reversal bet`); }
        else if (rsi < 30) { bullScore += 0.15 * w; reasoning.push(`[TRD-RSI] Oversold in trend → bounce`); }
        else if (rsi > 85) { bullScore -= 0.35 * w; reasoning.push(`[TRD-RSI] Extreme blow-off top → exit`); }
        else if (rsi > 75) { bullScore -= 0.15 * w; reasoning.push(`[TRD-RSI] Overbought in trend`); }
        // Patterns
        if (cp.headAndShoulders) { bullScore -= 0.25 * w; reasoning.push('[TRD-PAT] H&S — trend reversal'); }
        if (cp.doubleTop)        { bullScore -= 0.18 * w; }
        if (cp.doubleBottom)     { bullScore += 0.18 * w; }
    }

    // ── REGIME GATE: DISABLED ──────────────────────────────────────────────
    // Conservative engine clamps scores to ±0.20 in macro bull/bear.
    // Aggressive engine DOES NOT — it will trade counter-trend if indicators
    // give a strong enough signal. This is the biggest risk differentiator.
    reasoning.push('[REGIME] Gate DISABLED — willing to trade against macro trend');

    // ── MULTI-TF ALL-ALIGNED CONFLUENCE ────────────────────────────────────
    // Boosted to 1.65x (vs 1.35x conservative) — when everything agrees, bet big
    const allBull = m1 > 0 && m5 > 0 && h1 > 0;
    const allBear = m1 < 0 && m5 < 0 && h1 < 0;
    if (allBull && bullScore > 0) { bullScore *= 1.65; reasoning.push('[CONF] m1+m5+h1 all bullish → 1.65x AGGRESSIVE'); }
    if (allBear && bullScore < 0) { bullScore *= 1.65; reasoning.push('[CONF] m1+m5+h1 all bearish → 1.65x AGGRESSIVE'); }

    // ── FINAL DECISION ──────────────────────────────────────────────────────
    // Lower thresholds → triggers more frequently than conservative engine
    // Conservative: 0.28 / 0.32 / 0.35
    // Aggressive:   0.18 / 0.22 / 0.25
    const confidence = parseFloat(Math.min(10, Math.abs(bullScore) * 10).toFixed(1));
    let signal = 'HOLD';
    const threshold = adx < 18 ? 0.18 : adx < 24 ? 0.22 : 0.25;
    if (bullScore > threshold)       signal = 'BUY';
    else if (bullScore < -threshold) signal = 'SELL';

    reasoning.push(`[DECISION] ${signal} (score: ${bullScore.toFixed(3)}, conf: ${confidence}/10, mode: ${modeLabel}) 🔥`);
    return {
        signal,
        confidence,
        summary: reasoning[reasoning.length - 1],
        reasoning,
        primary_driver: reasoning[1] ?? reasoning[0]
    };
}

module.exports = { computeAggressiveSignal };
