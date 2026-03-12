const { RSI, MACD, BollingerBands, SMA, EMA, ADX, ATR } = require('technicalindicators');

class IndicatorService {
    /**
     * Calculate Relative Strength Index (RSI).
     * @param {Array<number>} closePrices - Array of closing prices.
     * @param {number} period - RSI period (default 14).
     * @returns {Array<number>} - RSI values.
     */
    calculateRSI(closePrices, period = 14) {
        if (closePrices.length < period) return [];

        const input = {
            values: closePrices,
            period: period
        };
        return RSI.calculate(input);
    }

    /**
     * Calculate Moving Average Convergence Divergence (MACD).
     * @param {Array<number>} closePrices - Array of closing prices.
     * @returns {Array<Object>} - Array containing { MACD, signal, histogram }.
     */
    calculateMACD(closePrices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
        if (closePrices.length < slowPeriod) return [];

        const input = {
            values: closePrices,
            fastPeriod,
            slowPeriod,
            signalPeriod,
            SimpleMAOscillator: false,
            SimpleMASignal: false
        };
        return MACD.calculate(input);
    }

    /**
     * Calculate Bollinger Bands (BB).
     * @param {Array<number>} closePrices - Array of closing prices.
     * @returns {Array<Object>} - Array containing { lower, middle, upper, pb }.
     */
    calculateBollingerBands(closePrices, period = 20, stdDev = 2) {
        if (closePrices.length < period) return [];

        const input = {
            period: period,
            values: closePrices,
            stdDev: stdDev
        };
        return BollingerBands.calculate(input);
    }

    /**
     * Calculate Exponential Moving Average (EMA).
     */
    calculateEMA(closePrices, period = 9) {
        if (closePrices.length < period) return [];

        return EMA.calculate({ period: period, values: closePrices });
    }

    /**
     * Calculate Average Directional Index (ADX).
     */
    calculateADX(high, low, close, period = 14) {
        if (close.length < period) return [];
        return ADX.calculate({ high, low, close, period });
    }

    /**
     * Calculate Average True Range (ATR).
     */
    calculateATR(high, low, close, period = 14) {
        if (close.length < period) return [];
        return ATR.calculate({ high, low, close, period });
    }

    /**
     * Detect Head & Shoulders pattern.
     * Looks at the last N candles to find a shape where there are three peaks,
     * the middle peak being the highest (Head) and the two outer peaks being similar in height (Shoulders).
     */
    detectHeadAndShoulders(highs) {
        if (highs.length < 20) return false;

        // Simplified approach: scan last 20 periods for 3 distinct local maximums.
        const peaks = this._findLocalPeaks(highs, 20);

        if (peaks.length >= 3) {
            // Check the last 3 peaks specifically
            const last3 = peaks.slice(-3);
            const leftShoulder = last3[0].value;
            const head = last3[1].value;
            const rightShoulder = last3[2].value;

            // Head must be highest
            if (head > leftShoulder && head > rightShoulder) {
                // Shoulders must be relatively close in height (e.g. within 0.5% of each other)
                const diff = Math.abs(leftShoulder - rightShoulder) / leftShoulder;
                if (diff < 0.005) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Detect Double Top pattern.
     * Looks at the last N candles to find two distinct peaks of similar heights,
     * separated by a valley.
     */
    detectDoubleTop(highs) {
        if (highs.length < 20) return false;

        const peaks = this._findLocalPeaks(highs, 20);

        if (peaks.length >= 2) {
            const last2 = peaks.slice(-2);
            const peak1 = last2[0].value;
            const peak2 = last2[1].value;
            const separation = last2[1].index - last2[0].index;

            // Must be separated by at least 3 candles to be a meaningful double top
            if (separation >= 3) {
                // Peaks must be near identical (e.g. within 0.2% of each other)
                const diff = Math.abs(peak1 - peak2) / peak1;
                if (diff < 0.002) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Detect Double Bottom pattern.
     * Looks for two distinct valleys of similar depths, separated by a peak.
     */
    detectDoubleBottom(lows) {
        if (lows.length < 20) return false;

        const valleys = this._findLocalValleys(lows, 20);

        if (valleys.length >= 2) {
            const last2 = valleys.slice(-2);
            const valley1 = last2[0].value;
            const valley2 = last2[1].value;
            const separation = last2[1].index - last2[0].index;

            // Must be separated by at least 3 candles
            if (separation >= 3) {
                // Valleys must be near identical (e.g. within 0.2% of each other)
                const diff = Math.abs(valley1 - valley2) / valley1;
                if (diff < 0.002) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Detect Triple Top pattern.
     * Looks for three distinct peaks of similar heights.
     */
    detectTripleTop(highs) {
        if (highs.length < 20) return false;

        const peaks = this._findLocalPeaks(highs, 20);

        if (peaks.length >= 3) {
            const last3 = peaks.slice(-3);
            const peak1 = last3[0].value;
            const peak2 = last3[1].value;
            const peak3 = last3[2].value;

            const diff1 = Math.abs(peak1 - peak2) / peak1;
            const diff2 = Math.abs(peak2 - peak3) / peak2;
            const diff3 = Math.abs(peak1 - peak3) / peak1;

            if (diff1 < 0.002 && diff2 < 0.002 && diff3 < 0.002) {
                return true;
            }
        }
        return false;
    }

    /**
     * Detect Triple Bottom pattern.
     * Looks for three distinct valleys of similar depths.
     */
    detectTripleBottom(lows) {
        if (lows.length < 20) return false;

        const valleys = this._findLocalValleys(lows, 20);

        if (valleys.length >= 3) {
            const last3 = valleys.slice(-3);
            const v1 = last3[0].value;
            const v2 = last3[1].value;
            const v3 = last3[2].value;

            const diff1 = Math.abs(v1 - v2) / v1;
            const diff2 = Math.abs(v2 - v3) / v2;
            const diff3 = Math.abs(v1 - v3) / v1;

            if (diff1 < 0.002 && diff2 < 0.002 && diff3 < 0.002) {
                return true;
            }
        }
        return false;
    }

    /**
     * Helper to find local peaks in a numeric array.
     */
    _findLocalPeaks(values, windowSize = 20) {
        const recent = values.slice(-windowSize);
        let peaks = [];
        for (let i = 1; i < recent.length - 1; i++) {
            if (recent[i] > recent[i - 1] && recent[i] > recent[i + 1]) {
                peaks.push({ index: i, value: recent[i] });
            }
        }
        return peaks;
    }

    /**
     * Helper to find local valleys in a numeric array.
     */
    _findLocalValleys(values, windowSize = 20) {
        const recent = values.slice(-windowSize);
        let valleys = [];
        for (let i = 1; i < recent.length - 1; i++) {
            if (recent[i] < recent[i - 1] && recent[i] < recent[i + 1]) {
                valleys.push({ index: i, value: recent[i] });
            }
        }
        return valleys;
    }

    /**
     * Detect Bull/Bear Flag (Proxy).
     * Flagpole: Strong directional movement over a short period.
     * Flag: Consolidation against the trend.
     */
    detectBullBearFlag(closes) {
        if (closes.length < 15) return 'none';

        const recent = closes.slice(-15);
        // Look back 10 candles for the flagpole
        const poleStart = recent[0];
        const poleEnd = recent[10];

        // Flagpole size (%)
        const poleChange = ((poleEnd - poleStart) / poleStart) * 100;

        // Consolidation over the last 5 candles
        const flagEnd = recent[14];
        const flagChange = ((flagEnd - poleEnd) / poleEnd) * 100;

        // Bull Flag: Strong move up (> 1%), slight move down/sideways (-0.5% to +0.2%)
        if (poleChange > 1.0 && flagChange < 0.2 && flagChange > -0.5) {
            return 'bull_flag';
        }

        // Bear Flag: Strong move down (< -1%), slight move up/sideways (-0.2% to +0.5%)
        if (poleChange < -1.0 && flagChange > -0.2 && flagChange < 0.5) {
            return 'bear_flag';
        }

        return 'none';
    }

    /**
     * Detect Bullish/Bearish Engulfing pattern on the latest 2 candles.
     */
    detectEngulfing(opens, closes) {
        if (opens.length < 2 || closes.length < 2) return 'none';

        const prevOpen = opens[opens.length - 2];
        const prevClose = closes[closes.length - 2];
        const currOpen = opens[opens.length - 1];
        const currClose = closes[closes.length - 1];

        const prevIsBullish = prevClose > prevOpen;
        const prevIsBearish = prevClose < prevOpen;
        const currIsBullish = currClose > currOpen;
        const currIsBearish = currClose < currOpen;

        const prevBodyTop = Math.max(prevOpen, prevClose);
        const prevBodyBottom = Math.min(prevOpen, prevClose);
        const currBodyTop = Math.max(currOpen, currClose);
        const currBodyBottom = Math.min(currOpen, currClose);

        // Bullish Engulfing: previous is bearish, current is bullish and completely covers previous body
        if (prevIsBearish && currIsBullish && currBodyTop > prevBodyTop && currBodyBottom < prevBodyBottom) {
            return 'bullish_engulfing';
        }

        // Bearish Engulfing: previous is bullish, current is bearish and completely covers previous body
        if (prevIsBullish && currIsBearish && currBodyBottom < prevBodyBottom && currBodyTop > prevBodyTop) {
            return 'bearish_engulfing';
        }

        return 'none';
    }

    /**
     * Runs all indicators on the provided dataset and extracts the latest feature row.
     * Used for passing the current state into the AI reasoning engine.
     * @param {Array<Object>} candles - Array of candle objects. Must be ordered oldest to newest.
     */
    getLatestFeatures(candles) {
        if (!candles || candles.length === 0) return {};

        const openPrices = candles.map(c => parseFloat(c.open));
        const closePrices = candles.map(c => parseFloat(c.close));
        const highPrices = candles.map(c => parseFloat(c.high));
        const lowPrices = candles.map(c => parseFloat(c.low));
        const volumes = candles.map(c => parseFloat(c.volume));

        const rsi = this.calculateRSI(closePrices);
        const macd = this.calculateMACD(closePrices);
        const bb = this.calculateBollingerBands(closePrices);
        const ema20 = this.calculateEMA(closePrices, 20);
        const ema50 = this.calculateEMA(closePrices, 50);
        const adx = this.calculateADX(highPrices, lowPrices, closePrices);
        const atr = this.calculateATR(highPrices, lowPrices, closePrices);

        // Advanced Metrics
        const currentPrice = closePrices[closePrices.length - 1];
        const lastHigh = highPrices[highPrices.length - 1];
        const lastLow = lowPrices[lowPrices.length - 1];
        const lastVol = volumes[volumes.length - 1];

        // Support/Resistance (Min/Max of last 100)
        const recentHighs = highPrices.slice(-100);
        const recentLows = lowPrices.slice(-100);
        const support = Math.min(...recentLows);
        const resistance = Math.max(...recentHighs);

        // Volume Spike (Current Vol / Avg Vol of last 20)
        let volSpike = 0;
        if (volumes.length >= 20) {
            const avgVol = volumes.slice(-20).reduce((a, b) => a + b) / 20;
            volSpike = ((lastVol - avgVol) / avgVol) * 100;
        }

        // Buy/Sell Proxy Ratio (Price close to high vs low)
        let buySellRatio = 1.0;
        if (lastHigh - lastLow > 0) {
            const buyPressure = currentPrice - lastLow;
            const sellPressure = lastHigh - currentPrice;
            buySellRatio = sellPressure === 0 ? 5.0 : (buyPressure / sellPressure);
        }

        // Momentum changes
        // NOTE: Offsets are in "number of candles" and currently tuned for 1m candles.
        // If you use a different timeframe, update these offsets or derive them from timeframe.
        const MOMENTUM_OFFSETS = {
            M1_CANDLES: 1,   // 1 candle @ 1m -> ~1 minute momentum
            M5_CANDLES: 5,   // 5 candles @ 1m -> ~5 minute momentum
            H1_CANDLES: 60,  // 60 candles @ 1m -> ~1 hour momentum
        };

        const getMomentum = (candleOffset) => {
            if (closePrices.length > candleOffset) {
                const oldPrice = closePrices[closePrices.length - 1 - candleOffset];
                return ((currentPrice - oldPrice) / oldPrice) * 100;
            }
            return 0;
        };

        // Pattern Detection
        const isHeadAndShoulders = this.detectHeadAndShoulders(highPrices);
        const isDoubleTop = this.detectDoubleTop(highPrices);
        const isDoubleBottom = this.detectDoubleBottom(lowPrices);
        const isTripleTop = this.detectTripleTop(highPrices);
        const isTripleBottom = this.detectTripleBottom(lowPrices);
        const flagPattern = this.detectBullBearFlag(closePrices);
        const engulfingPattern = this.detectEngulfing(openPrices, closePrices);

        // Breakout pattern: when current price decisively breaks out of recent resistance or support
        // E.g., current price is > current resistance by > 0.1% or < current support by < 0.1%
        let breakout = 'none';
        const prevClose = closePrices[closePrices.length - 2] || currentPrice;

        // Did we just cross resistance? (prev below -> now above)
        if (prevClose <= resistance && currentPrice > resistance) {
            breakout = 'bullish_breakout';
        }
        // Did we just cross support? (prev above -> now below)
        else if (prevClose >= support && currentPrice < support) {
            breakout = 'bearish_breakdown';
        }

        // Return the very last computed value for each
        return {
            currentPrice,
            support,
            resistance,
            volume: lastVol,
            volumeSpike: volSpike,
            buySellRatio: buySellRatio,
            momentum: {
                // These labels (m1, m5, h1) assume 1m candles; see MOMENTUM_OFFSETS above.
                m1: getMomentum(MOMENTUM_OFFSETS.M1_CANDLES),
                m5: getMomentum(MOMENTUM_OFFSETS.M5_CANDLES),
                h1: getMomentum(MOMENTUM_OFFSETS.H1_CANDLES)
            },
            chartPatterns: {
                headAndShoulders: isHeadAndShoulders,
                doubleTop: isDoubleTop,
                doubleBottom: isDoubleBottom,
                tripleTop: isTripleTop,
                tripleBottom: isTripleBottom,
                flag: flagPattern,
                engulfing: engulfingPattern,
                breakout: breakout
            },
            rsi: rsi.length > 0 ? rsi[rsi.length - 1] : null,
            macd: macd.length > 0 ? macd[macd.length - 1] : null,
            bollingerBands: bb.length > 0 ? bb[bb.length - 1] : null,
            ema20: ema20.length > 0 ? ema20[ema20.length - 1] : null,
            ema50: ema50.length > 0 ? ema50[ema50.length - 1] : null,
            adx: adx.length > 0 ? adx[adx.length - 1]?.adx : null,
            atr: atr.length > 0 ? atr[atr.length - 1] : null,
        };
    }
}

module.exports = new IndicatorService();
