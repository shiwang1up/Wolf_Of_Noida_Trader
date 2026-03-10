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
                model: 'qwen/qwen3-32b',
                // model: 'openai/gpt-oss-120b',
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
    async generateSignal(symbol = 'BTCUSDT', baseCoin = 'BTC', quoteCoin = 'USDT') {
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
                // CoinDCX orderbook/candles use `pair` (e.g. B-BTC_USDT), not `symbol` (e.g. BTCUSDT).
                // Resolve pair via DB mapping; fallback to passing `symbol` if caller already provided a pair.
                let pair = symbol;
                const looksLikePair = typeof symbol === 'string' && (symbol.startsWith('B-') || symbol.includes('_'));
                if (!looksLikePair) {
                    const market = await prisma.market.findUnique({ where: { symbol } });
                    if (market?.pair) pair = market.pair;
                }

                const obData = await coindcxService.getOrderbook(pair);
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
                // Defaulting to BTC (CoinId 1182) for this specific metric
                // Note: If you want Multi-Coin social stats, you'll need an endpoint to resolve baseCoin to CryptoCompare CoinId
                if (baseCoin === 'BTC') {
                    const socialData = await cryptocompareService.getSocialData(1182);
                    if (socialData) {
                        socialSummary = {
                            totalPoints: socialData.General?.Points,
                            redditSubscribers: socialData.Reddit?.subscribers,
                            twitterFollowers: socialData.Twitter?.followers,
                        };
                    }
                }
            } catch (e) {
                logger.warn('Failed to fetch social data for AI payload:', e.message);
            }

            // 3c. Fetch Latest Cached Crypto News from DB
            let newsHeadlines = null;
            try {
                // In the future, news could be filtered by finding elements parsing the `baseCoin` 
                const cachedNews = await prisma.news.findFirst({
                    orderBy: { timestamp: 'desc' },
                    where: { source: 'CryptoPanic' }
                });
                if (cachedNews && cachedNews.headlines) {
                    newsHeadlines = cachedNews.headlines;
                }
            } catch (e) {
                logger.warn(`Failed to fetch cached CryptoPanic news for AI payload:`, e.message);
            }

            // 3d. Fetch Global Market Metrics (CoinGecko)
            let globalMetrics = { totalMarketCap: 0, btcDominance: 0 };
            try {
                const metrics = await cryptocompareService.getGlobalMarketData();
                if (metrics && metrics.totalMarketCap && metrics.btcDominance) {
                    globalMetrics = metrics;
                }
            } catch (e) {
                logger.warn('Failed to fetch global market data for AI payload:', e.message);
            }

            // 4. Construct Prompt payload
            const marketStatePayload = {
                symbol,
                baseCoin,
                quoteCoin,
                currentPrice: features.currentPrice,
                indicators: {
                    rsi: features.rsi,
                    macd: features.macd,
                    bollingerBands: features.bollingerBands,
                    ema20: features.ema20,
                    ema50: features.ema50,
                    adx: features.adx,
                    atr: features.atr
                },
                marketStructure: {
                    support: features.support,
                    resistance: features.resistance
                },
                volume: {
                    lastVolume: features.volume,
                    volumeSpikePercent: features.volumeSpike,
                    buySellRatio: features.buySellRatio
                },
                momentum: features.momentum,
                chartPatterns: features.chartPatterns,
                marketContext: globalMetrics,
                marketSentiment: latestSentiment ? {
                    score: latestSentiment.score, // e.g. 0 to 100
                    label: latestSentiment.label
                } : 'Unknown',
                orderbook: orderbookSummary || 'Unavailable',
                socialStats: socialSummary || 'Unavailable',
                latestNewsHeadlines: newsHeadlines || 'Unavailable'
            };

            const systemPrompt = `You are an expert Crypto Trading AI. 
      Given the current technical indicators, Market Structure (Support/Resistance), Chart Patterns (Head & Shoulders, Double/Triple Tops & Bottoms, Flags, Engulfing, Breakouts), Volume data, Momentum changes, Broad Market Context (BTC Dominance/Market Cap), Fear & Greed market sentiment, live Orderbook resting liquidity, Social Media statistics, and the latest Crypto news headlines, determine the best trading action.
      You must respond in pure JSON format exactly matching this schema:
      {
        "signal": "BUY" | "SELL" | "HOLD",
        "confidence": 6.5,
        "trend": "bullish" | "bearish" | "ranging",
        "momentum": "strengthening" | "weakening" | "neutral",
        "sentiment": "extreme fear" | "fear" | "neutral" | "greed" | "extreme greed",
        "risk_level": "low" | "medium" | "high",
        "reasoning": [
          "string explaining point 1",
          "string explaining point 2",
          "string explaining point 3"
        ],
        "summary": "1 sentence summarizing the overall decision."
      }
      IMPORTANT: The current market is ${symbol} (Base: ${baseCoin}, Quote: ${quoteCoin}). 
      - All asset-specific prices, indicators, and orderbook data are denominated in **${quoteCoin}**.
      - Global market metrics (Total Market Cap) are denominated in **USD**.
      Evaluate the context accordingly.`;

            // 5. Query the LLM dynamically
            const currencySymbol = quoteCoin === 'INR' ? '₹' : '$';
            logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            logger.info(`  [AI ENGINE] DATA BEING FED TO LLM FOR ${symbol}`);
            logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            logger.info(`  📈 Price       : ${currencySymbol}${marketStatePayload.currentPrice}`);
            logger.info(`  🧱 Structure   : Support ${currencySymbol}${marketStatePayload.marketStructure?.support?.toFixed(1)} | Resistance ${currencySymbol}${marketStatePayload.marketStructure?.resistance?.toFixed(1)}`);
            logger.info(`  📉 Patterns    : H&S: ${marketStatePayload.chartPatterns?.headAndShoulders} | Breakout: ${marketStatePayload.chartPatterns?.breakout}`);
            logger.info(`  📉 Tops/Bottoms: D-Top: ${marketStatePayload.chartPatterns?.doubleTop} | T-Top: ${marketStatePayload.chartPatterns?.tripleTop} | D-Bot: ${marketStatePayload.chartPatterns?.doubleBottom} | T-Bot: ${marketStatePayload.chartPatterns?.tripleBottom}`);
            logger.info(`  📉 Candle/Trend: Flag: ${marketStatePayload.chartPatterns?.flag} | Engulfing: ${marketStatePayload.chartPatterns?.engulfing}`);
            logger.info(`  📊 RSI         : ${marketStatePayload.indicators.rsi?.toFixed(2)}`);
            logger.info(`  📊 MACD Hist   : ${marketStatePayload.indicators.macd?.histogram?.toFixed(2)}`);
            logger.info(`  📊 Bollinger %B: ${marketStatePayload.indicators.bollingerBands?.pb?.toFixed(3)}`);
            logger.info(`  📊 EMA20       : ${marketStatePayload.indicators.ema20?.toFixed(2)}`);
            logger.info(`  📊 EMA50       : ${marketStatePayload.indicators.ema50?.toFixed(2)}`);
            logger.info(`  📊 ADX         : ${marketStatePayload.indicators.adx?.toFixed(2)}`);
            logger.info(`  📊 ATR         : ${marketStatePayload.indicators.atr?.toFixed(2)}`);
            logger.info(`  🔊 Volume      : ${marketStatePayload.volume?.lastVolume?.toFixed(2)} BTC (Spike: ${marketStatePayload.volume?.volumeSpikePercent?.toFixed(1)}%) | B/S Ratio: ${marketStatePayload.volume?.buySellRatio?.toFixed(2)}`);
            logger.info(`  🚀 Momentum    : 1m ${marketStatePayload.momentum?.m1?.toFixed(2)}% | 5m ${marketStatePayload.momentum?.m5?.toFixed(2)}% | 1h ${marketStatePayload.momentum?.h1?.toFixed(2)}%`);
            logger.info(`  🌍 Market Ctx  : BTC Dom. ${marketStatePayload.marketContext?.btcDominance?.toFixed(1)}% | MCap $${(marketStatePayload.marketContext?.totalMarketCap / 1e12).toFixed(2)}T`);
            logger.info(`  😱 Fear & Greed: ${marketStatePayload.marketSentiment?.score} (${marketStatePayload.marketSentiment?.label})`);
            logger.info(`  📖 Orderbook   : Top Bid ${marketStatePayload.orderbook?.topBids?.[0]?.[0]} | Top Ask ${marketStatePayload.orderbook?.topAsks?.[0]?.[0]}`);
            logger.info(`  👥 Social      : Reddit ${marketStatePayload.socialStats?.redditSubscribers?.toLocaleString()} | Twitter ${marketStatePayload.socialStats?.twitterFollowers?.toLocaleString()}`);
            if (marketStatePayload.latestNewsHeadlines && Array.isArray(marketStatePayload.latestNewsHeadlines)) {
                logger.info('  📰 News Headlines:');
                marketStatePayload.latestNewsHeadlines.forEach((h, i) => logger.info(`     ${i + 1}. ${h}`));
            }
            logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            const resultStr = await this._queryLLM(systemPrompt, marketStatePayload);

            if (!resultStr) {
                throw new Error("LLM returned an empty or undefined response.");
            }

            let parsedResult;
            try {
                // Strip out markdown formatting if Gemini/Groq appends ```json
                const cleanStr = resultStr.replace(/```json/g, '').replace(/```/g, '').trim();
                parsedResult = JSON.parse(cleanStr);
            } catch (err) {
                logger.error('[AI Engine] Failed to parse LLM Response. Raw Output:', resultStr);
                throw new Error("LLM output is not valid JSON.");
            }

            logger.info(`[AI Engine] LLM Reasoning for ${symbol}:`, parsedResult.summary);
            logger.info(`[AI Engine] Trend: ${parsedResult.trend} | Momentum: ${parsedResult.momentum} | Sub-sentiment: ${parsedResult.sentiment}`);

            // Construct reasoning string for DB compatibility
            let reasoningStr = parsedResult.summary;
            if (parsedResult.reasoning && Array.isArray(parsedResult.reasoning)) {
                reasoningStr += "\n\nPoints:\n- " + parsedResult.reasoning.join("\n- ");
            }

            // Ensure risk_level is a valid string before calling toUpperCase()
            const riskLevelStr = typeof parsedResult.risk_level === 'string'
                ? parsedResult.risk_level.toUpperCase()
                : 'UNKNOWN';

            // 6. Save the Signal to database
            const signalRecord = await prisma.signal.create({
                data: {
                    symbol,
                    action: parsedResult.signal,              // mapped from "signal"
                    confidenceScore: parsedResult.confidence, // mapped from "confidence"
                    riskLevel: riskLevelStr,                  // securely casted
                    reasoning: reasoningStr,
                    currentPrice: features.currentPrice,
                    timestamp: new Date()
                }
            });

            logger.info(`[AI Engine] Generated signal for ${symbol}: ${signalRecord.action} (Confidence: ${signalRecord.confidenceScore}/10)`);
            return signalRecord;
        } catch (error) {
            logger.error('[AI Engine Error] Error generating signal:', error.message);
            throw error;
        }
    }
}

module.exports = new AIEngineService();
