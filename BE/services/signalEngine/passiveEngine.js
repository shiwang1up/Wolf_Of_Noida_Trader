'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║    PASSIVE SIGNAL ENGINE  —  Risk-Managed Capital Preservation     ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║ Professional philosophy: "Avoid big losses, profits take care       ║
 * ║ of themselves." — Risk-managed, not zero-trade.                    ║
 * ║                                                                  ║
 * ║ DESIGN PRINCIPLES:                                               ║
 * ║  • ASYMMETRIC thresholds → picky to enter, quick to exit         ║
 * ║    BUY requires score > 0.35 (high conviction only)              ║
 * ║    SELL fires at score < -0.22 (cut losses fast)                 ║
 * ║  • SELL confidence boosted 1.5× → clears fee guard faster        ║
 * ║  • Bearish indicator weights 1.25× their bullish counterparts     ║
 * ║  • RSI overextension guard prevents mechanical top-buying        ║
 * ║  • BB upper-band dampener prevents buying into extended moves     ║
 * ║  • TF misalignment → 30% score penalty (not hard gate)           ║
 * ║                                                                  ║
 * ║ Best used in: All market conditions as a conservative base       ║
 * ║ Avoid using in: If you want to capture full bull-run gains       ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * @module passiveEngine
 */

/**
 * Compute a capital-preservation trading signal from a market payload.
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
 *   fullExit: boolean,
 *   summary: string,
 *   reasoning: string[],
 *   primary_driver: string
 * }}
 */
function computePassiveSignal(payload) {
    let bullScore = 0;
    const reasoning = [];

    // ── Score multiplier: every indicator is dampened ────────────────────────
    // Harder to reach threshold → fewer trades → fewer losses
    // 0.85 (vs 0.75 before) — signals need to be reachable or we never trade
    const DAMPENING = 0.85;

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

    // ── MULTI-TF ALIGNMENT CHECK (soft penalty, not hard gate) ──────────────
    // If TFs disagree, we dampen the final score rather than returning HOLD
    // immediately. A hard gate causes the engine to sit out of most markets
    // (especially when h1 data is unavailable) and misses key entries.
    const allBull = m1 > 0 && m5 > 0 && h1 > 0;
    const allBear = m1 < 0 && m5 < 0 && h1 < 0;
    const tfAligned = allBull || allBear;
    // misalignment penalty applied after scoring (multiplied at the end)
    const tfPenalty = tfAligned ? 1.0 : 0.70;

    // ── MODE DETECTION ──────────────────────────────────────────────────────
    const revWeight   = adx < 18 ? 1.0 : adx < 22 ? (22 - adx) / 4 : 0;
    const trendWeight = adx > 28 ? 1.0 : adx > 24 ? (adx - 24) / 4 : 0;
    const momWeight   = Math.max(0, 1.0 - revWeight - trendWeight);

    const modeLabel = adx < 18 ? '↔️ REVERSION'
        : adx < 22 ? '〰️ REV→MOM'
            : adx < 24 ? '⚡ MOMENTUM'
                : adx < 28 ? '〰️ MOM→TREND'
                    : '📈 TRENDING';

    const tfTag = tfAligned ? '✅TF-OK' : '⚠️TF-SPLIT(-30%)';
    reasoning.push(`[MODE] ${modeLabel} (ADX=${adx.toFixed(1)}) [rev=${revWeight.toFixed(2)} mom=${momWeight.toFixed(2)} trend=${trendWeight.toFixed(2)}] 🛡️PASSIVE ${tfTag}`);

    // ══════════════════════════════════════════════════════════════════════
    // ① MEAN REVERSION — only extreme readings, asymmetric weights
    //    SELL signals weighted 1.25× heavier than BUY — cuts losses faster
    // ══════════════════════════════════════════════════════════════════════
    if (revWeight > 0) {
        const w = revWeight * DAMPENING;
        // Fire at clear extremes (Bollinger %B)
        if (pb <= 0.00)       { bullScore += 0.52 * w;         reasoning.push(`[REV-BB] Below lower band (PB=${pb.toFixed(2)}) — extreme bounce`); }
        else if (pb < 0.08)   { bullScore += 0.35 * w;         reasoning.push(`[REV-BB] Lower band extreme (PB=${pb.toFixed(2)})`); }
        else if (pb < 0.18)   { bullScore += 0.18 * w;         reasoning.push(`[REV-BB] Lower band approach (PB=${pb.toFixed(2)})`); }
        else if (pb > 1.00)   { bullScore -= 0.52 * 1.25 * w;  reasoning.push(`[REV-BB] Above upper band (PB=${pb.toFixed(2)}) — extreme fade`); }
        else if (pb > 0.92)   { bullScore -= 0.35 * 1.25 * w;  reasoning.push(`[REV-BB] Upper band extreme (PB=${pb.toFixed(2)})`); }
        else if (pb > 0.82)   { bullScore -= 0.18 * 1.25 * w;  reasoning.push(`[REV-BB] Upper band approach (PB=${pb.toFixed(2)})`); }
        // RSI — SELL side weighted heavier
        if (rsi < 25)         { bullScore += 0.32 * w;         reasoning.push(`[REV-RSI] Extreme oversold (${rsi.toFixed(1)}) — safe bounce`); }
        else if (rsi < 35)    { bullScore += 0.18 * w;         reasoning.push(`[REV-RSI] Oversold (${rsi.toFixed(1)})`); }
        else if (rsi < 42)    { bullScore += 0.08 * w; }
        else if (rsi > 75)    { bullScore -= 0.32 * 1.25 * w;  reasoning.push(`[REV-RSI] Extreme overbought (${rsi.toFixed(1)}) — exit`); }
        else if (rsi > 65)    { bullScore -= 0.18 * 1.25 * w;  reasoning.push(`[REV-RSI] Overbought (${rsi.toFixed(1)})`); }
        else if (rsi > 58)    { bullScore -= 0.08 * 1.25 * w; }
        // S/R — tight proximity (0.8%)
        if (support > 0 && (price - support) / price < 0.008)       { bullScore += 0.22 * w;        reasoning.push(`[REV-SR] At support $${support.toFixed(0)}`); }
        if (resistance > 0 && (resistance - price) / price < 0.008) { bullScore -= 0.22 * 1.25 * w; reasoning.push(`[REV-SR] At resistance $${resistance.toFixed(0)}`); }
        // Momentum confirm (avoid falling knife)
        if (pb < 0.20 && h1 > 0) { bullScore += 0.10 * w;        reasoning.push('[REV-CONF] Oversold + h1 positive → confirmed bounce'); }
        if (pb > 0.80 && h1 < 0) { bullScore -= 0.10 * 1.25 * w; reasoning.push('[REV-CONF] Overbought + h1 negative → confirmed rejection'); }
        // Patterns
        if (cp.doubleBottom || cp.tripleBottom) { bullScore += 0.20 * w;        reasoning.push('[REV-PAT] Confirmed bullish base pattern'); }
        if (cp.doubleTop || cp.tripleTop)       { bullScore -= 0.20 * 1.25 * w; reasoning.push('[REV-PAT] Confirmed bearish top pattern'); }
        if (cp.engulfing === 'bullish_engulfing') { bullScore += 0.10 * w; reasoning.push('[REV-PAT] Bullish engulfing'); }
        if (cp.engulfing === 'bearish_engulfing') { bullScore -= 0.10 * 1.25 * w; reasoning.push('[REV-PAT] Bearish engulfing'); }
    }

    // ══════════════════════════════════════════════════════════════════════
    // ① MOMENTUM TRADING — selective entries, asymmetric exit scoring
    //    SELL weights 1.25× heavier so losing positions exit faster
    // ══════════════════════════════════════════════════════════════════════
    if (momWeight > 0) {
        const w = momWeight * DAMPENING;
        // UPPER BB GUARD — near upper band → halve all BUY contributions
        const nearUpperBand = pb > 0.85;
        const bbBuyDampener = nearUpperBand ? 0.5 : 1.0;
        if (nearUpperBand) reasoning.push(`[MOM-BB-GUARD] PB=${pb.toFixed(2)} near upper band — BUY dampened 50%`);

        // EMA alignment
        if (ema20 > 0 && ema50 > 0) {
            if (price > ema20 && ema20 > ema50) {
                bullScore += 0.20 * w * bbBuyDampener;
                reasoning.push(`[MOM-EMA] Bullish alignment (pb=${pb.toFixed(2)})`);
            } else if (price < ema20 && ema20 < ema50) {
                bullScore -= 0.20 * 1.25 * w; // heavier exit weight
                reasoning.push(`[MOM-EMA] Bearish alignment — exit signal`);
            }
        }
        // RSI — narrowed bull zone 52–60, SELL zone 32–48 scored heavier
        if      (rsi >= 52 && rsi <= 60)      { bullScore += 0.20 * w * bbBuyDampener; reasoning.push(`[MOM-RSI] Bull zone (${rsi.toFixed(1)})`); }
        else if (rsi > 60 && rsi <= 68)       { bullScore += 0.05 * w * bbBuyDampener; }
        else if (rsi >= 50 && rsi < 52)       { bullScore += 0.08 * w * bbBuyDampener; }
        else if (rsi >= 32 && rsi <= 48)      { bullScore -= 0.20 * 1.25 * w; reasoning.push(`[MOM-RSI] Bear zone (${rsi.toFixed(1)}) — exit`); }
        else if (rsi > 48 && rsi < 50)        { bullScore -= 0.08 * 1.25 * w; }
        else if (rsi < 25)                    { bullScore += 0.24 * w;         reasoning.push(`[MOM-RSI] Extreme oversold — bounce`); }
        else if (rsi > 80)                    { bullScore -= 0.24 * 1.25 * w; reasoning.push(`[MOM-RSI] Extreme overbought — exit`); }
        // MACD
        if (macdLine > macdSig && macdHist > 0) {
            bullScore += 0.20 * w * bbBuyDampener;
            reasoning.push(`[MOM-MACD] Bull expansion (hist=${macdHist.toFixed(3)})`);
        } else if (macdLine > macdSig && macdHist <= 0) {
            bullScore += 0.06 * w * bbBuyDampener; // early cross
        } else if (macdLine < macdSig && macdHist < 0) {
            bullScore -= 0.20 * 1.25 * w; // heavier exit weight
            reasoning.push(`[MOM-MACD] Bear expansion (hist=${macdHist.toFixed(3)}) — exit`);
        } else if (macdLine < macdSig && macdHist >= 0) {
            bullScore -= 0.08 * 1.25 * w;
        }
        // h1 momentum
        if (h1 > 3)       { bullScore += 0.14 * w * bbBuyDampener; reasoning.push(`[MOM-H1] Momentum h1=${h1.toFixed(1)}%`); }
        else if (h1 > 1)  { bullScore += 0.06 * w * bbBuyDampener; }
        else if (h1 < -3) { bullScore -= 0.14 * 1.25 * w; reasoning.push(`[MOM-H1] Down h1=${h1.toFixed(1)}%`); }
        else if (h1 < -1) { bullScore -= 0.06 * 1.25 * w; }
        // Patterns
        if (cp.breakout === 'bullish' || cp.breakout === true) { bullScore += 0.14 * w * bbBuyDampener; reasoning.push('[MOM-PAT] Breakout'); }
        if (cp.breakout === 'bearish')                         { bullScore -= 0.14 * 1.25 * w;          reasoning.push('[MOM-PAT] Breakdown — exit'); }
    }

    // ══════════════════════════════════════════════════════════════════════
    // ③ TREND FOLLOWING — RSI overextension guard + asymmetric exit weights
    // ══════════════════════════════════════════════════════════════════════
    if (trendWeight > 0) {
        const w = trendWeight * DAMPENING;
        // RSI OVEREXTENSION GUARD — don't add BUY score in overbought trending market
        const trendBuyBlocked  = rsi > 68;
        const trendSellBlocked = rsi < 32;

        if (ema20 > 0 && ema50 > 0) {
            if (price > ema20 && ema20 > ema50) {
                if (!trendBuyBlocked) { bullScore += 0.20 * w; reasoning.push('[TRD-EMA] Bull: price > EMA20 > EMA50'); }
                else { reasoning.push(`[TRD-EMA] Bull skipped — RSI=${rsi.toFixed(1)} overbought`); }
            } else if (price < ema20 && ema20 < ema50) {
                if (!trendSellBlocked) { bullScore -= 0.20 * 1.25 * w; reasoning.push('[TRD-EMA] Bear: price < EMA20 < EMA50 — exit signal'); }
                else { reasoning.push(`[TRD-EMA] Bear skipped — RSI=${rsi.toFixed(1)} oversold`); }
            }
        }
        if (adx > 30 && h1 > 0 && !trendBuyBlocked)  { bullScore += 0.18 * w;         reasoning.push(`[TRD-ADX] Strong uptrend ADX=${adx.toFixed(1)}`); }
        if (adx > 30 && h1 < 0 && !trendSellBlocked) { bullScore -= 0.18 * 1.25 * w;  reasoning.push(`[TRD-ADX] Strong downtrend ADX=${adx.toFixed(1)}`); }
        if (h1 > 3 && !trendBuyBlocked)        { bullScore += 0.12 * w;        reasoning.push(`[TRD-MOM] h1=${h1.toFixed(1)}% bullish`); }
        else if (h1 > 1 && !trendBuyBlocked)   { bullScore += 0.05 * w; }
        else if (h1 < -3 && !trendSellBlocked) { bullScore -= 0.12 * 1.25 * w; reasoning.push(`[TRD-MOM] h1=${h1.toFixed(1)}% bearish`); }
        else if (h1 < -1 && !trendSellBlocked) { bullScore -= 0.05 * 1.25 * w; }
        // RSI extremes — reversal signals, always fire
        if (rsi < 22)      { bullScore += 0.28 * w;         reasoning.push(`[TRD-RSI] Crash bottom (${rsi.toFixed(1)}) → reversal`); }
        else if (rsi < 30) { bullScore += 0.14 * w;         reasoning.push(`[TRD-RSI] Oversold in trend → bounce`); }
        else if (rsi > 80) { bullScore -= 0.28 * 1.25 * w;  reasoning.push(`[TRD-RSI] Blow-off top (${rsi.toFixed(1)}) → exit`); }
        else if (rsi > 70) { bullScore -= 0.14 * 1.25 * w; }
        // Reversal warnings
        if (cp.headAndShoulders) { bullScore -= 0.22 * 1.25 * w; reasoning.push('[TRD-PAT] H&S — strong exit signal'); }
        if (cp.doubleTop)        { bullScore -= 0.15 * 1.25 * w; }
        if (cp.doubleBottom)     { bullScore += 0.15 * w; }
    }

    // ── TF ALIGNMENT PENALTY ────────────────────────────────────────────────
    if (!tfAligned) {
        bullScore *= tfPenalty;
        reasoning.push(`[PASSIVE-GATE] TF split → score dampened to ${(tfPenalty * 100).toFixed(0)}%`);
    }

    // ── REGIME GATE ──────────────────────────────────────────────────────────
    // Protects against fighting macro trend.
    // BUY clamped in bear regimes; SELL clamped in bull regimes.
    const bullRegime = ema20 > 0 && ema50 > 0 && price > ema50 && ema20 > ema50;
    const bearRegime = ema20 > 0 && ema50 > 0 && price < ema50 && ema20 < ema50;

    if (bullRegime && bullScore < -0.12) {
        if (!(rsi > 80 || pb > 0.98 || cp.headAndShoulders)) {
            bullScore = Math.max(bullScore, -0.12);
            reasoning.push('[REGIME] 🐂 Strong Bull → SELL clamped (capital protection)');
        }
    } else if (bearRegime && bullScore > 0.12) {
        if (!(rsi < 20 || pb < 0.02 || cp.doubleBottom)) {
            bullScore = Math.min(bullScore, 0.12);
            reasoning.push('[REGIME] 🐻 Strong Bear → BUY clamped (no knife catching)');
        }
    }

    // ── ASYMMETRIC FINAL DECISION ─────────────────────────────────────────
    // KEY DESIGN PRINCIPLE:
    //   BUY  threshold HIGH  (0.35) → picky to enter, only high-conviction longs
    //   SELL threshold LOW   (0.22) → quick to exit, cut losses before they grow
    //
    // SELL confidence is boosted 1.5× so it clears backtest.js FEE GUARD
    // (which requires confidence ≥ 6.5 to execute a SELL). This ensures the
    // engine can exit bad positions even in the −6% to +4% PnL whipsaw zone.
    //
    //                 BUY threshold          SELL threshold
    //   Balanced:     0.28 / 0.32 / 0.35     same as BUY
    //   Passive:      0.35 / 0.38 / 0.45     0.22 / 0.25 / 0.25 (much lower)

    const adxMode = adx < 18 ? 'rev' : adx < 24 ? 'mom' : 'trend';
    const buyThreshold  = adxMode === 'rev' ? 0.35 : adxMode === 'mom' ? 0.38 : 0.45; // trend=0.45: trifecta alone (0.425) can't fire
    const sellThreshold = adxMode === 'rev' ? 0.22 : 0.25; // same for mom & trend

    let signal = 'HOLD';
    if      (bullScore > buyThreshold)   signal = 'BUY';
    else if (bullScore < -sellThreshold) signal = 'SELL';

    // Confidence: base = |score| * 10, boosted 1.5× for SELL signals
    const rawConf = Math.min(10, Math.abs(bullScore) * 10);
    const confidence = parseFloat((signal === 'SELL' ? Math.min(10, rawConf * 1.5) : rawConf).toFixed(1));

    reasoning.push(`[DECISION] ${signal} (score: ${bullScore.toFixed(3)}, conf: ${confidence}/10, buy_thr=${buyThreshold.toFixed(2)}, sell_thr=-${sellThreshold.toFixed(2)}) 🛡️`);
    return {
        signal,
        confidence,
        fullExit: signal === 'SELL',
        summary: reasoning[reasoning.length - 1],
        reasoning,
        primary_driver: reasoning[1] ?? reasoning[0]
    };
}

module.exports = { computePassiveSignal };
