const axios = require('axios');
const crypto = require('crypto');

class CoinDCXService {
    constructor() {
        this.apiKey = process.env.COINDCX_KEY;
        this.apiSecret = process.env.COINDCX_SECRET;
        this.baseUrl = 'https://public.coindcx.com';
    }

    /**
     * Generates headers required for authenticated CoinDCX API calls.
     */
    _getAuthHeaders(payload = {}) {
        if (!this.apiKey || !this.apiSecret) {
            console.warn("CoinDCX API keys are missing!");
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
            console.error(`Error fetching candles for ${pair}:`, error.message);
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
            console.error(`Error fetching orderbook for ${pair}:`, error.message);
            throw error;
        }
    }
}

module.exports = new CoinDCXService();
