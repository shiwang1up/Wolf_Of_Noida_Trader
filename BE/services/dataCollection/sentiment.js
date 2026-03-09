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
     */
    async getNews(filter = 'rising', currencies = 'BTC,ETH') {
        if (!this.cryptoPanicToken) {
            logger.warn('CryptoPanic token is missing.');
            return null;
        }

        try {
            const response = await axios.get(this.cryptoPanicBaseUrl, {
                params: {
                    auth_token: this.cryptoPanicToken,
                    currencies,
                    public: 'true'
                },
                headers: { 'Content-Type': 'application/json' }
            });
            // Return only the titles as a compact list for the AI prompt
            const results = response.data.results || [];
            return results.slice(0, 15).map(post => post.title);
        } catch (error) {
            logger.error('Error fetching News from CryptoPanic:', error.message);
            return null;
        }
    }
}

module.exports = new SentimentService();
