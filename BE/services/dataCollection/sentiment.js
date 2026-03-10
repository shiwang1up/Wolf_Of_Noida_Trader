const axios = require('axios');
const logger = require('../../utils/logger');

class SentimentService {
    constructor() {
        this.fearGreedBaseUrl = 'https://api.alternative.me/fng/';
        this.cryptoPanicBaseUrl = 'https://cryptopanic.com/api/developer/v2/posts/';
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
     * Fetch recent news headlines from CryptoPanic.
     * Allowed filters: 'rising', 'hot', 'bullish', 'bearish', 'important', 'saved', 'lol'
     */
    async getNews(filters = 'important', currencies = 'BTC,ETH') {
        if (!this.cryptoPanicToken) {
            logger.warn('CryptoPanic token is missing.');
            return null;
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
            return results.slice(0, 20).map(post => post.title);
        } catch (error) {
            logger.error('Error fetching News from CryptoPanic:', error.message);
            return null;
        }
    }
}

module.exports = new SentimentService();
