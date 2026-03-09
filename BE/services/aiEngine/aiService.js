const { OpenAI } = require('openai');
const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const indicatorService = require('../indicators/indicatorService');
const cryptocompareService = require('../dataCollection/cryptocompare');
const coindcxService = require('../dataCollection/coindcx');
const sentimentService = require('../dataCollection/sentiment');
const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const logger = require('../../utils/logger');

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

class AIEngineService {
    constructor() {
        this.openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
        this.groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
        this.genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
    }

    /**
     * Helper to route the prompt to the first available LLM provider.
     * Priorities: Groq -> Gemini -> OpenAI (or based on query param if passed in future).
     */
    async _queryLLM(systemPrompt, marketStatePayload) {
        if (this.groq) {
            logger.info("Using Groq API for Market reasoning");
            const completion = await this.groq.chat.completions.create({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: JSON.stringify(marketStatePayload) }
                ],
                model: 'openai/gpt-oss-120b',
                response_format: { type: "json_object" }
            });
            return completion.choices[0].message.content;
        }

        if (this.genAI) {
            logger.info("Using Gemini API for Market reasoning");
            const model = this.genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });
            const prompt = `${systemPrompt}\n\nMarket State:\n${JSON.stringify(marketStatePayload)}`;
            const result = await model.generateContent(prompt);
            return result.response.text();
        }

        if (this.openai) {
            logger.info("Using OpenAI API for Market reasoning");
            const completion = await this.openai.chat.completions.create({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: JSON.stringify(marketStatePayload) }
                ],
                model: 'gpt-4-turbo-preview',
                response_format: { type: "json_object" }
            });
            return completion.choices[0].message.content;
        }

        throw new Error('No LLM Provider API Keys found in .env (Add GROQ_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY)');
    }

    /**
     * Generates a trading signal for a specific symbol.
     */
    async generateSignal(symbol = 'B-BTC_USDT') {
        try {
            // 1. Fetch recent candles from DB (last 100 for 1m timeframe)
            const candles = await prisma.candle.findMany({
                where: { symbol, timeframe: '1m' },
                orderBy: { timestamp: 'desc' },
                take: 100
            });

            if (candles.length < 50) {
                throw new Error('Not enough candle data to generate indicators');
            }

            // Reverse to get oldest to newest for indicator calculation
            candles.reverse();

            // 2. Extract technical features for the current state
            const features = indicatorService.getLatestFeatures(candles);

            // 3. Fetch latest Sentiment Data
            const latestSentiment = await prisma.sentiment.findFirst({
                orderBy: { timestamp: 'desc' },
                where: { source: 'FearGreedIndex' }
            });

            // 3a. Fetch Live Orderbook (Top 3 Bids/Asks)
            let orderbookSummary = null;
            try {
                const obData = await coindcxService.getOrderbook(symbol);
                if (obData && obData.bids && obData.asks) {
                    const sortedBids = Object.entries(obData.bids).sort((a, b) => parseFloat(b[0]) - parseFloat(a[0])).slice(0, 3);
                    const sortedAsks = Object.entries(obData.asks).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])).slice(0, 3);

                    orderbookSummary = {
                        topBids: sortedBids,
                        topAsks: sortedAsks
                    };
                }
            } catch (e) {
                logger.warn('Failed to fetch orderbook for AI payload:', e.message);
            }

            // 3b. Fetch Social Stats from CryptoCompare
            let socialSummary = null;
            try {
                // Defaulting to BTC for this specific pair
                const socialData = await cryptocompareService.getSocialData(1182);
                if (socialData) {
                    socialSummary = {
                        totalPoints: socialData.General?.Points,
                        redditSubscribers: socialData.Reddit?.subscribers,
                        twitterFollowers: socialData.Twitter?.followers,
                    };
                }
            } catch (e) {
                logger.warn('Failed to fetch social data for AI payload:', e.message);
            }

            // 3c. Fetch Latest Crypto News from CryptoPanic
            let newsHeadlines = null;
            try {
                newsHeadlines = await sentimentService.getNews('rising', 'BTC,ETH');
            } catch (e) {
                logger.warn('Failed to fetch CryptoPanic news for AI payload:', e.message);
            }

            // 4. Construct Prompt payload
            const marketStatePayload = {
                symbol,
                currentPrice: features.currentPrice,
                indicators: {
                    rsi: features.rsi,
                    macd: features.macd,
                    bollingerBands: features.bollingerBands,
                    ema20: features.ema20,
                    ema50: features.ema50
                },
                marketSentiment: latestSentiment ? {
                    score: latestSentiment.score, // e.g. 0 to 100
                    label: latestSentiment.label
                } : 'Unknown',
                orderbook: orderbookSummary || 'Unavailable',
                socialStats: socialSummary || 'Unavailable',
                latestNewsHeadlines: newsHeadlines || 'Unavailable'
            };

            const systemPrompt = `You are an expert Crypto Trading AI. 
      Given the current technical indicators, Fear & Greed market sentiment, live Orderbook resting liquidity, Social Media statistics, and the latest Crypto news headlines, determine the best trading action.
      You must respond in pure JSON format:
      {
        "action": "BUY" | "SELL" | "HOLD",
        "confidenceScore": 8.5, // A score out of 10 (e.g. 1 to 10)
        "riskLevel": "LOW" | "MEDIUM" | "HIGH",
        "reasoning": "string of 2-3 sentences explaining the logic for the chosen action AND explicitly justifying why the confidence score is what it is."
      }`;

            // 5. Query the LLM dynamically
            logger.info('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            logger.info('  [AI ENGINE] DATA BEING FED TO LLM');
            logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            logger.info(`  📈 Price       : $${marketStatePayload.currentPrice}`);
            logger.info(`  📊 RSI         : ${marketStatePayload.indicators.rsi?.toFixed(2)}`);
            logger.info(`  📊 MACD Hist   : ${marketStatePayload.indicators.macd?.histogram?.toFixed(2)}`);
            logger.info(`  📊 Bollinger %B: ${marketStatePayload.indicators.bollingerBands?.pb?.toFixed(3)}`);
            logger.info(`  📊 EMA20       : ${marketStatePayload.indicators.ema20?.toFixed(2)}`);
            logger.info(`  📊 EMA50       : ${marketStatePayload.indicators.ema50?.toFixed(2)}`);
            logger.info(`  😱 Fear & Greed: ${marketStatePayload.marketSentiment?.score} (${marketStatePayload.marketSentiment?.label})`);
            logger.info(`  📖 Orderbook   : Top Bid ${marketStatePayload.orderbook?.topBids?.[0]?.[0]} | Top Ask ${marketStatePayload.orderbook?.topAsks?.[0]?.[0]}`);
            logger.info(`  👥 Social      : Reddit ${marketStatePayload.socialStats?.redditSubscribers?.toLocaleString()} | Twitter ${marketStatePayload.socialStats?.twitterFollowers?.toLocaleString()}`);
            if (marketStatePayload.latestNewsHeadlines && Array.isArray(marketStatePayload.latestNewsHeadlines)) {
                logger.info('  📰 News Headlines:');
                marketStatePayload.latestNewsHeadlines.forEach((h, i) => logger.info(`     ${i + 1}. ${h}`));
            }
            logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            const resultStr = await this._queryLLM(systemPrompt, marketStatePayload);

            // Strip out markdown formatting if Gemini/Groq appends ```json
            const cleanStr = resultStr.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsedResult = JSON.parse(cleanStr);

            logger.info(`[AI Engine] LLM Reasoning for ${symbol}:`, parsedResult.reasoning);

            // 6. Save the Signal to database
            const signalRecord = await prisma.signal.create({
                data: {
                    symbol,
                    action: parsedResult.action,
                    confidenceScore: parsedResult.confidenceScore,
                    riskLevel: parsedResult.riskLevel,
                    reasoning: parsedResult.reasoning,
                    currentPrice: features.currentPrice,
                    timestamp: new Date()
                }
            });

            logger.info(`[AI Engine] Generated signal for ${symbol}: ${parsedResult.action} (Confidence: ${parsedResult.confidenceScore}/10)`);
            return signalRecord;
        } catch (error) {
            logger.error('[AI Engine Error] Error generating signal:', error.message);
            throw error;
        }
    }
}

module.exports = new AIEngineService();
