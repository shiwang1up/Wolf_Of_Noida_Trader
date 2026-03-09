const axios = require('axios');
const logger = require('../../utils/logger');

class CryptoCompareService {
    constructor() {
        this.apiKey = process.env.CRYPTOCOMPARE_API_KEY;
        this.baseUrl = 'https://min-api.cryptocompare.com/data';
    }

    /**
     * Fetch current prices for multiple symbols against a base currency.
     * e.g. fsyms=BTC,ETH & tsyms=USD
     */
    async getMultipleSymbolPrices(fsyms = ['BTC', 'ETH'], tsyms = ['USD', 'USDT']) {
        try {
            const response = await axios.get(`${this.baseUrl}/pricemulti`, {
                params: {
                    fsyms: fsyms.join(','),
                    tsyms: tsyms.join(','),
                    api_key: this.apiKey,
                }
            });
            return response.data;
        } catch (error) {
            logger.error('Error fetching multiple prices from CryptoCompare:', error.message);
            throw error;
        }
    }

    /**
     * Fetch historical daily OHLCV data for a specific coin.
     */
    async getHistoricalDaily(fsym = 'BTC', tsym = 'USD', limit = 30) {
        try {
            const response = await axios.get(`${this.baseUrl}/v2/histoday`, {
                params: {
                    fsym,
                    tsym,
                    limit,
                    api_key: this.apiKey,
                }
            });
            if (response.data.Response === 'Success') {
                return response.data.Data.Data; // Array of candles
            }
            throw new Error(response.data.Message);
        } catch (error) {
            logger.error(`Error fetching historical daily for ${fsym}:`, error.message);
            throw error;
        }
    }

    /**
     * Fetch social statistics for a coin (defaults to coinId 1182 for BTC).
     */
    async getSocialData(coinId = 1182) {
        try {
            const response = await axios.get(`${this.baseUrl}/social/coin/latest`, {
                params: {
                    coinId,
                    api_key: this.apiKey,
                }
            });
            if (response.data.Response === 'Success') {
                return response.data.Data;
            }
            throw new Error(response.data.Message || 'Failed to fetch social data');
        } catch (error) {
            logger.error(`Error fetching social data for coinId ${coinId}:`, error.message);
            throw error;
        }
    }
}

module.exports = new CryptoCompareService();
