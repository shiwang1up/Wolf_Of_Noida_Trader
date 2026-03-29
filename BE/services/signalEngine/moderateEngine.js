'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║         3-MODE MATHEMATICAL SIGNAL ENGINE  (ADX-Driven)          ║
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
 *
 * Smooth linear blending is applied at mode boundaries (18-22, 24-28)
 * so signals don't whipsaw when ADX is right on a threshold.
 *
 * This module is a PURE FUNCTION — no database calls, no IO, no side effects.
 * It can be required by any service: backtester, live trader, REST API, tests.
 *
 * @module signalEngine
 */

/**
 * Compute a trading signal from a market payload.
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
function computeModerateSignal(payload) {
    let bullScore = 0;
    const reasoning = [];

    const h1 = payload.momentum?.h1 ?? 0;
    const m5 = payload.momentum?.m5 ?? 0;
    const m1 = payload.momentum?.m1 ?? 0;
    const rsi = payload.indicators?.rsi ?? 50;
    const macdHist = payload.indicators?.macd?.histogram ?? 0;
    const macdLine = payload.indicators?.macd?.MACD ?? 0;
    const macdSig = payload.indicators?.macd?.signal ?? 0;
    const pb = payload.indicators?.bollingerBands?.pb ?? 0.5;
    const adx = payload.indicators?.adx ?? 20;
    const ema20 = payload.indicators?.ema20 ?? 0;
    const ema50 = payload.indicators?.ema50 ?? 0;
    const price = payload.currentPrice;
    const support = payload.marketStructure?.support ?? 0;
    const resistance = payload.marketStructure?.resistance ?? 0;
    const cp = payload.chartPatterns ?? {};

    // ── MODE DETECTION ──────────────────────────────────────────────────────
    // ADX < 18  → pure REVERSION
    // ADX 18-22 → blend of REVERSION (fading) + MOMENTUM (rising)
    // ADX 22-28 → pure MOMENTUM
    // ADX 24-28 → blend of MOMENTUM (fading) + TRENDING (rising)
    // ADX > 28  → pure TRENDING
    const revWeight   = adx < 18 ? 1.0 : adx < 22 ? (22 - adx) / 4 : 0;
    const trendWeight = adx > 28 ? 1.0 : adx > 24 ? (adx - 24) / 4 : 0;
    const momWeight   = Math.max(0, 1.0 - revWeight - trendWeight);

    const modeLabel = adx < 18 ? '↔️ REVERSION'
        : adx < 22 ? '〰️ REV→MOM'
            : adx < 24 ? '⚡ MOMENTUM'
                : adx < 28 ? '〰️ MOM→TREND'
                    : '📈 TRENDING';

    reasoning.push(`[MODE] ${modeLabel} (ADX=${adx.toFixed(1)}) [rev=${revWeight.toFixed(2)} mom=${momWeight.toFixed(2)} trend=${trendWeight.toFixed(2)}]`);

    // ══════════════════════════════════════════════════════════════════════
    // ① MEAN REVERSION — buy oversold, sell overbought
    //    Best when market is chopping in a range (ADX < 18)
    // ══════════════════════════════════════════════════════════════════════
    if (revWeight > 0) {
        const w = revWeight;
        // Bollinger %B extremes
        if (pb <= 0.00)      { bullScore += 0.55 * w; reasoning.push(`[REV-BB] Below lower band (PB=${pb.toFixed(2)}) 🟢 BOUNCE`); }
        else if (pb < 0.08)  { bullScore += 0.40 * w; reasoning.push(`[REV-BB] Lower band extreme (PB=${pb.toFixed(2)}) → BUY`); }
        else if (pb < 0.18)  { bullScore += 0.22 * w; }
        else if (pb > 1.00)  { bullScore -= 0.55 * w; reasoning.push(`[REV-BB] Above upper band (PB=${pb.toFixed(2)}) 🔴 FADE`); }
        else if (pb > 0.92)  { bullScore -= 0.40 * w; reasoning.push(`[REV-BB] Upper band extreme (PB=${pb.toFixed(2)}) → SELL`); }
        else if (pb > 0.82)  { bullScore -= 0.22 * w; }
        // RSI extremes confirm reversion
        if (rsi < 22)        { bullScore += 0.30 * w; reasoning.push(`[REV-RSI] Extreme oversold (${rsi.toFixed(1)}) → bounce`); }
        else if (rsi < 32)   { bullScore += 0.15 * w; reasoning.push(`[REV-RSI] Oversold (${rsi.toFixed(1)})`); }
        else if (rsi < 42)   { bullScore += 0.07 * w; }
        else if (rsi > 78)   { bullScore -= 0.30 * w; reasoning.push(`[REV-RSI] Extreme overbought (${rsi.toFixed(1)}) → reversal`); }
        else if (rsi > 68)   { bullScore -= 0.15 * w; reasoning.push(`[REV-RSI] Overbought (${rsi.toFixed(1)})`); }
        else if (rsi > 58)   { bullScore -= 0.07 * w; }
        // S/R proximity amplifies
        if (support > 0 && (price - support) / price < 0.008)       { bullScore += 0.20 * w; reasoning.push(`[REV-SR] At support $${support.toFixed(0)}`); }
        if (resistance > 0 && (resistance - price) / price < 0.008) { bullScore -= 0.20 * w; reasoning.push(`[REV-SR] At resistance $${resistance.toFixed(0)}`); }
        // Confirm with short-term momentum (avoid catching falling knife)
        if (pb < 0.20 && h1 > 0) { bullScore += 0.10 * w; reasoning.push('[REV-CONF] Oversold + h1 positive → confirmed bounce'); }
        if (pb > 0.80 && h1 < 0) { bullScore -= 0.10 * w; reasoning.push('[REV-CONF] Overbought + h1 negative → confirmed rejection'); }
        // Reversal candlestick patterns
        if (cp.doubleBottom || cp.tripleBottom) { bullScore += 0.18 * w; reasoning.push('[REV-PAT] Bullish reversal at lows'); }
        if (cp.doubleTop || cp.tripleTop)       { bullScore -= 0.18 * w; reasoning.push('[REV-PAT] Bearish reversal at highs'); }
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
        if (rsi >= 58 && rsi <= 68)     { bullScore += 0.20 * w; reasoning.push(`[MOM-RSI] Bull momentum zone (${rsi.toFixed(1)}) — trend has room`); }
        else if (rsi >= 50 && rsi < 58) { bullScore += 0.10 * w; }
        else if (rsi >= 32 && rsi <= 42){ bullScore -= 0.20 * w; reasoning.push(`[MOM-RSI] Bear momentum zone (${rsi.toFixed(1)}) — selling active`); }
        else if (rsi > 42 && rsi < 50)  { bullScore -= 0.10 * w; }
        // Extreme RSI still signals reversal even in momentum mode
        else if (rsi < 25) { bullScore += 0.25 * w; reasoning.push(`[MOM-RSI] Oversold crash bottom (${rsi.toFixed(1)}) → snap back`); }
        else if (rsi > 80) { bullScore -= 0.25 * w; reasoning.push(`[MOM-RSI] Overbought blow-off (${rsi.toFixed(1)}) → fade`); }
        // MACD histogram direction + expansion (core momentum indicator)
        if (macdLine > macdSig && macdHist > 0) {
            bullScore += 0.18 * w;
            reasoning.push(`[MOM-MACD] Bullish histogram expanding (hist=${macdHist.toFixed(3)})`);
        } else if (macdLine > macdSig && macdHist <= 0) {
            bullScore += 0.05 * w;
        } else if (macdLine < macdSig && macdHist < 0) {
            bullScore -= 0.18 * w;
            reasoning.push(`[MOM-MACD] Bearish histogram expanding (hist=${macdHist.toFixed(3)})`);
        } else if (macdLine < macdSig && macdHist >= 0) {
            bullScore -= 0.05 * w;
        }
        // h1 momentum quality
        if (h1 > 5)       { bullScore += 0.15 * w; reasoning.push(`[MOM-H1] Strong upward momentum h1=${h1.toFixed(1)}%`); }
        else if (h1 > 2)  { bullScore += 0.08 * w; }
        else if (h1 < -5) { bullScore -= 0.15 * w; reasoning.push(`[MOM-H1] Strong downward momentum h1=${h1.toFixed(1)}%`); }
        else if (h1 < -2) { bullScore -= 0.08 * w; }
        // Momentum continuation patterns
        if (cp.flag === 'bull_flag')                              { bullScore += 0.12 * w; reasoning.push('[MOM-PAT] Bull flag — momentum continuation'); }
        if (cp.flag === 'bear_flag')                              { bullScore -= 0.12 * w; reasoning.push('[MOM-PAT] Bear flag — momentum continuation'); }
        if (cp.breakout === 'bullish' || cp.breakout === true)    { bullScore += 0.15 * w; reasoning.push('[MOM-PAT] Bullish momentum breakout'); }
        if (cp.breakout === 'bearish')                            { bullScore -= 0.15 * w; reasoning.push('[MOM-PAT] Bearish momentum breakdown'); }
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
            if (price > ema20 && ema20 > ema50)  { bullScore += 0.20 * w; reasoning.push('[TRD-EMA] Bullish: price > EMA20 > EMA50'); }
            else if (price < ema20 && ema20 < ema50) { bullScore -= 0.20 * w; reasoning.push('[TRD-EMA] Bearish: price < EMA20 < EMA50'); }
        }
        // ADX-confirmed trend strength
        if (adx > 32 && h1 > 0)  { bullScore += 0.18 * w; reasoning.push(`[TRD-ADX] Strong uptrend ADX=${adx.toFixed(1)}`); }
        if (adx > 32 && h1 < 0)  { bullScore -= 0.18 * w; reasoning.push(`[TRD-ADX] Strong downtrend ADX=${adx.toFixed(1)}`); }
        // Momentum direction
        if (h1 > 4)       { bullScore += 0.10 * w; reasoning.push(`[TRD-MOM] h1=${h1.toFixed(1)}% bullish`); }
        else if (h1 > 1)  { bullScore += 0.05 * w; }
        else if (h1 < -4) { bullScore -= 0.10 * w; reasoning.push(`[TRD-MOM] h1=${h1.toFixed(1)}% bearish`); }
        else if (h1 < -1) { bullScore -= 0.05 * w; }
        // RSI extremes — reversal risk even in a strong trend
        if (rsi < 20)      { bullScore += 0.28 * w; reasoning.push(`[TRD-RSI] Extreme crash bottom (${rsi.toFixed(1)}) → reversal`); }
        else if (rsi < 30) { bullScore += 0.15 * w; reasoning.push(`[TRD-RSI] Oversold in trend (${rsi.toFixed(1)}) → bounce`); }
        else if (rsi > 82) { bullScore -= 0.28 * w; reasoning.push(`[TRD-RSI] Extreme blow-off top (${rsi.toFixed(1)}) → reversal`); }
        else if (rsi > 70) { bullScore -= 0.15 * w; reasoning.push(`[TRD-RSI] Overbought in trend (${rsi.toFixed(1)})`); }
        // Trend continuation patterns
        if (cp.headAndShoulders) { bullScore -= 0.20 * w; reasoning.push('[TRD-PAT] H&S — trend reversal'); }
        if (cp.doubleTop)        { bullScore -= 0.15 * w; }
        if (cp.doubleBottom)     { bullScore += 0.15 * w; }
    }

    // ── GLOBAL REGIME GATE (Diamond Hand Filter) ───────────────────────────
    // Never fight a strong macro trend regardless of what mode we are in,
    // unless there is an extreme global over-extended signal.
    const bullRegime = ema20 > 0 && ema50 > 0 && price > ema50 && ema20 > ema50;
    const bearRegime = ema20 > 0 && ema50 > 0 && price < ema50 && ema20 < ema50;

    if (bullRegime && bullScore < -0.15) {
        if (!(rsi > 75 || pb > 0.95 || cp.headAndShoulders)) {
            bullScore = Math.max(bullScore, -0.20);
            reasoning.push('[REGIME] 🐂 Macro Bull → SELL clamped (Diamond Handing)');
        }
    } else if (bearRegime && bullScore > 0.15) {
        if (!(rsi < 25 || pb < 0.05 || cp.doubleBottom)) {
            bullScore = Math.min(bullScore, 0.20);
            reasoning.push('[REGIME] 🐻 Macro Bear → BUY clamped (No knife catching)');
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
    if (bullScore > threshold)       signal = 'BUY';
    else if (bullScore < -threshold) signal = 'SELL';

    reasoning.push(`[DECISION] ${signal} (score: ${bullScore.toFixed(3)}, conf: ${confidence}/10, mode: ${modeLabel})`);
    return {
        signal,
        confidence,
        summary: reasoning[reasoning.length - 1],
        reasoning,
        primary_driver: reasoning[1] ?? reasoning[0]
    };
}

module.exports = { computeModerateSignal };
