const { OpenAI } = require('openai');
const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const indicatorService = require('../indicators/indicatorService');
const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

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
            console.log("Using Groq API for Market reasoning");
            const completion = await this.groq.chat.completions.create({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: JSON.stringify(marketStatePayload) }
                ],
                model: 'llama3-70b-8192',
                response_format: { type: "json_object" }
            });
            return completion.choices[0].message.content;
        }

        if (this.genAI) {
            console.log("Using Gemini API for Market reasoning");
            const model = this.genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });
            const prompt = `${systemPrompt}\n\nMarket State:\n${JSON.stringify(marketStatePayload)}`;
            const result = await model.generateContent(prompt);
            return result.response.text();
        }

        if (this.openai) {
            console.log("Using OpenAI API for Market reasoning");
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
                } : 'Unknown'
            };

            const systemPrompt = `You are an expert Crypto Trading AI. 
      Given the current technical indicators and market sentiment, determine the best trading action.
      You must respond in pure JSON format:
      {
        "action": "BUY" | "SELL" | "HOLD",
        "confidenceScore": 85.5,
        "riskLevel": "LOW" | "MEDIUM" | "HIGH",
        "reasoning": "string of 2-3 sentences explaining the logic"
      }`;

            // 5. Query the LLM dynamically
            const resultStr = await this._queryLLM(systemPrompt, marketStatePayload);

            // Strip out markdown formatting if Gemini/Groq appends ```json
            const cleanStr = resultStr.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsedResult = JSON.parse(cleanStr);

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

            console.log(`[AI Engine] Generated signal for ${symbol}: ${parsedResult.action}`);
            return signalRecord;
        } catch (error) {
            console.error('[AI Engine Error] Error generating signal:', error.message);
            throw error;
        }
    }
}

module.exports = new AIEngineService();
