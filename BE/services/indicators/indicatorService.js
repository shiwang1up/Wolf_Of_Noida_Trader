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
     * Runs all indicators on the provided dataset and extracts the latest feature row.
     * Used for passing the current state into the AI reasoning engine.
     * @param {Array<Object>} candles - Array of candle objects. Must be ordered oldest to newest.
     */
    getLatestFeatures(candles) {
        if (!candles || candles.length === 0) return {};

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
