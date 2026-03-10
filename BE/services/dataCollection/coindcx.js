const axios = require('axios');
const crypto = require('crypto');
const logger = require('../../utils/logger');

class CoinDCXService {
    constructor() {
        this.apiKey = process.env.COINDCX_KEY;
        this.apiSecret = process.env.COINDCX_SECRET;
        this.baseUrl = 'https://public.coindcx.com';
        this.exchangeUrl = 'https://api.coindcx.com';
    }

    /**
     * Generates headers required for authenticated CoinDCX API calls.
     */
    _getAuthHeaders(payload = {}) {
        if (!this.apiKey || !this.apiSecret) {
            logger.warn("CoinDCX API keys are missing!");
            return {};
        }

        const timeStamp = Math.floor(Date.now() / 1000);
        const body = { timestamp: timeStamp, ...payload };
        const signature = crypto
            .createHmac('sha256', this.apiSecret)
            .update(JSON.stringify(body))
            .digest('hex');

        return {
            'X-AUTH-APIKEY': this.apiKey,
            'X-AUTH-SIGNATURE': signature,
            'Content-Type': 'application/json'
        };
    }

    /**
     * Fetches historical candlestick (K-line) data for a given market.
     * Note: CoinDCX public API uses a different endpoint structure.
     * Adjust according to actual CoinDCX public API doc for candles.
     */
    async getCandles(pair = 'B-BTC_USDT', interval = '1m', limit = 100) {
        try {
            // Updated to the working public endpoint
            const response = await axios.get(`${this.baseUrl}/market_data/candles`, {
                params: {
                    pair,
                    interval,
                    limit
                }
            });
            return response.data;
        } catch (error) {
            logger.error(`Error fetching candles for ${pair}:`, error.message);
            throw error;
        }
    }

    /**
     * Fetches the current orderbook for a given market.
     */
    async getOrderbook(pair = 'B-BTC_USDT') {
        try {
            const response = await axios.get(`${this.baseUrl}/market_data/orderbook`, {
                params: { pair }
            });
            return response.data;
        } catch (error) {
            logger.error(`Error fetching orderbook for ${pair}:`, error.message);
            throw error;
        }
    }

    /**
     * Fetches all active markets from CoinDCX.
     * Source of truth: `GET /exchange/v1/markets`
     *
     * Returns objects shaped for DB upsert:
     * { symbol, pair, baseCoin, quoteCoin, status }
     */
    async getActiveMarkets() {
        try {
            // `symbol` is internal symbol (e.g. BTCUSDT), `pair` is used in candle/orderbook APIs (e.g. B-BTC_USDT)
            // `base_currency_short_name` is base (e.g. BTC), `target_currency_short_name` is quote (e.g. USDT)
            let markets = null;
            try {
                const response = await axios.get(`${this.exchangeUrl}/exchange/v1/markets`);
                markets = response.data;
            } catch (e) {
                logger.warn('[CoinDCX] Failed to fetch /exchange/v1/markets. Falling back to markets_details.');
            }

            // Fallback for older implementation (kept for resilience)
            if (!markets) {
                const fallbackRes = await axios.get(`${this.exchangeUrl}/exchange/v1/markets_details`);
                markets = fallbackRes.data;
            }

            if (!Array.isArray(markets)) {
                logger.warn('CoinDCX returned non-array for markets:', markets);
                return [];
            }

            const mapped = markets.map((m) => {
                // New endpoint: { symbol, pair, base_currency_short_name, target_currency_short_name, ... }
                if (m.symbol && m.pair && m.base_currency_short_name && m.target_currency_short_name) {
                    return {
                        symbol: m.symbol,
                        pair: m.pair,
                        baseCoin: m.base_currency_short_name,
                        quoteCoin: m.target_currency_short_name,
                        status: m.status || 'active'
                    };
                }

                // Fallback endpoint: markets_details uses `coindcx_name` as internal symbol-like identifier in this codebase historically.
                // We keep it for resilience, but prefer the `symbol` field from /markets.
                return {
                    symbol: m.symbol || m.coindcx_name,
                    pair: m.pair,
                    baseCoin: m.base_currency_short_name || m.target_currency_short_name,
                    quoteCoin: m.target_currency_short_name || m.base_currency_short_name,
                    status: m.status || 'active'
                };
            });

            const activeMarkets = mapped
                .filter(m => m.status === 'active')
                .filter(m => (m.quoteCoin === 'USDT' || m.quoteCoin === 'INR'));

            logger.info(`[CoinDCX] Fetched ${activeMarkets.length} active (USDT/INR) markets.`);
            return activeMarkets;
        } catch (error) {
            logger.error('Error fetching active markets from CoinDCX:', error.message);
            return [];
        }
    }
}

module.exports = new CoinDCXService();
