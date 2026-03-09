const { RSI, MACD, BollingerBands, SMA, EMA } = require('technicalindicators');

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
     * Runs all indicators on the provided dataset and extracts the latest feature row.
     * Used for passing the current state into the AI reasoning engine.
     * @param {Array<Object>} candles - Array of candle objects. Must be ordered oldest to newest.
     */
    getLatestFeatures(candles) {
        const closePrices = candles.map(c => parseFloat(c.close));

        const rsi = this.calculateRSI(closePrices);
        const macd = this.calculateMACD(closePrices);
        const bb = this.calculateBollingerBands(closePrices);
        const ema20 = this.calculateEMA(closePrices, 20);
        const ema50 = this.calculateEMA(closePrices, 50);

        // Return the very last computed value for each
        return {
            currentPrice: closePrices[closePrices.length - 1],
            rsi: rsi.length > 0 ? rsi[rsi.length - 1] : null,
            macd: macd.length > 0 ? macd[macd.length - 1] : null,
            bollingerBands: bb.length > 0 ? bb[bb.length - 1] : null,
            ema20: ema20.length > 0 ? ema20[ema20.length - 1] : null,
            ema50: ema50.length > 0 ? ema50[ema50.length - 1] : null,
        };
    }
}

module.exports = new IndicatorService();
