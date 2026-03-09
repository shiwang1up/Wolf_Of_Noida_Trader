const axios = require('axios');

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
            console.error('Error fetching multiple prices from CryptoCompare:', error.message);
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
            console.error(`Error fetching historical daily for ${fsym}:`, error.message);
            throw error;
        }
    }
}

module.exports = new CryptoCompareService();
