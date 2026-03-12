const axios = require('axios');
const logger = require('../../utils/logger');

class SentimentService {
    constructor() {
        this.fearGreedBaseUrl = 'https://api.alternative.me/fng/';
        this.cryptoPanicBaseUrl = 'https://cryptopanic.com/api/developer/v2/posts/';
        this.cryptoCompareBaseUrl = 'https://min-api.cryptocompare.com/data/news/';
        this.cryptoPanicToken = process.env.CRYPTOPANIC_TOKEN;
    }

    /**
     * Fetch latest Fear and Greed Index.
     * Returns a value between 0 (Extreme Fear) and 100 (Extreme Greed).
     */
    async getFearGreedIndex(limit = 1) {
        try {
            const response = await axios.get(this.fearGreedBaseUrl, {
                params: { limit, format: 'json' }
            });
            return response.data;
        } catch (error) {
            logger.error('Error fetching Fear & Greed Index:', error.message);
            throw error;
        }
    }

    /**
     * Fallback to CryptoCompare when CryptoPanic fails or is rate limited.
     */
    async getCryptoCompareNews(currencies = 'BTC,ETH') {
        try {
            const response = await axios.get(this.cryptoCompareBaseUrl, {
                params: {
                    categories: currencies,
                    excludeCategories: 'Sponsored',
                    lang: 'EN',
                    feeds: 'coindesk,cointelegraph'
                }
            });
            const results = response.data.Data || [];
            return results.slice(0, 20).map(post => post.title);
        } catch (error) {
            logger.error('Error fetching News from CryptoCompare:', error.message);
            return null;
        }
    }

    /**
     * Fetch recent news headlines from CryptoPanic.
     * Allowed filters: 'rising', 'hot', 'bullish', 'bearish', 'important', 'saved', 'lol'
     */
    async getNews(filters = 'important', currencies = 'BTC,ETH') {
        if (!this.cryptoPanicToken) {
            logger.warn('CryptoPanic token is missing. Falling back to CryptoCompare.');
            return this.getCryptoCompareNews(currencies);
        }

        // Validate against CryptoPanic's supported filters
        const allowedFilters = ['rising', 'hot', 'bullish', 'bearish', 'important', 'saved', 'lol'];

        // Handle array or comma-separated string
        let filterStr = Array.isArray(filters) ? filters.join(',') : filters;

        // If a user passed an invalid filter, fallback to 'important'
        const validatedFilters = filterStr.split(',').filter(f => allowedFilters.includes(f.trim()));
        if (validatedFilters.length === 0) validatedFilters.push('important');

        try {
            const response = await axios.get(this.cryptoPanicBaseUrl, {
                params: {
                    auth_token: this.cryptoPanicToken,
                    currencies,
                    filter: validatedFilters.join(','),
                    public: 'true'
                },
                headers: { 'Content-Type': 'application/json' }
            });

            // Return only the titles as a compact list for the AI prompt
            const results = response.data.results || [];

            if (results.length === 0) {
                logger.warn('CryptoPanic returned no news. Falling back to CryptoCompare.');
                return this.getCryptoCompareNews(currencies);
            }

            return results.slice(0, 20).map(post => post.title);
        } catch (error) {
            logger.error('Error fetching News from CryptoPanic. Falling back to CryptoCompare:', error.message);
            return this.getCryptoCompareNews(currencies);
        }
    }
}

module.exports = new SentimentService();
