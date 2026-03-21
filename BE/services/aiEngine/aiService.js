const { OpenAI } = require('openai');
const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const indicatorService = require('../indicators/indicatorService');
const cryptocompareService = require('../dataCollection/cryptocompare');
const coindcxService = require('../dataCollection/coindcx');
const sentimentService = require('../dataCollection/sentiment');
const { prisma } = require('../../utils/db');
const logger = require('../../utils/logger');

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
                // model: 'qwen/qwen3-32b',
                model: 'llama-3.1-8b-instant',
                // model: 'openai/gpt-oss-120b',
                response_format: { type: "json_object" }
            });
            return completion.choices[0].message.content;
        }

        if (this.genAI) {
            logger.info("Using Gemini API for Market reasoning");
            const model = this.genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });

            const result = await model.generateContent({
                contents: [
                    {
                        role: 'user',
                        parts: [{ text: `${systemPrompt}\n\nMarket State:\n${JSON.stringify(marketStatePayload)}` }]
                    }
                ],
                generationConfig: {
                    responseMimeType: "application/json"
                }
            });

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
            // 1. Fetch recent candles from DB (last 100 for current timeframe)
            const timeframe = coindcxService.defaultInterval;
            const candles = await prisma.candle.findMany({
                where: { symbol, timeframe },
                orderBy: { timestamp: 'desc' },
                take: 1500 // Increased to support 4h (240) and 1d (1440) momentum
            });

            if (candles.length < 50) {
                throw new Error('Not enough candle data to generate indicators');
            }

            // Reverse to get oldest to newest for indicator calculation
            candles.reverse();

            // 2. Extract technical features for the current (1m) state
            const features = indicatorService.getLatestFeatures(candles, '1m');

            // 2a. Fetch 1h macro candles from DB for Anchor Momentum (25% weight)
            let macroFeatures = null;
            try {
                const h1Candles = await prisma.candle.findMany({
                    where: { symbol, timeframe: '1h' },
                    orderBy: { timestamp: 'desc' },
                    take: 60
                });
                if (h1Candles.length >= 24) {
                    h1Candles.reverse();
                    const mf = indicatorService.getLatestFeatures(h1Candles, '1h');

                    // 🚨 CRITICAL FIX: Since 1m candles are limited to 1000 by API (not enough for 1440 mins/1d),
                    // we pull 4h and 1d momentum from the 1h candles instead.
                    if (features.momentum && mf.momentum) {
                        features.momentum.h4 = mf.momentum.h4;
                        features.momentum.d1 = mf.momentum.d1;
                    }

                    macroFeatures = {
                        trend: mf.momentum?.h1 >= 0 ? 'bullish' : 'bearish',
                        momentum_h1_pct: mf.momentum?.h1,
                        rsi: mf.rsi,
                        macd_histogram: mf.macd?.histogram,
                        ema20: mf.ema20,
                        ema50: mf.ema50,
                        atr: mf.atr
                    };
                }
            } catch (e) {
                logger.warn('[AI Engine] Failed to fetch 1h macro candles for multiTimeframeContext:', e.message);
            }

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

            // 3b. Fetch Analyzed Liquidity Zones (Persistent Walls / Spoofing)
            let liquidityZones = [];
            try {
                liquidityZones = await prisma.liquidityZone.findMany({
                    where: { symbol },
                    orderBy: { timestamp: 'desc' },
                    take: 10
                });
            } catch (e) {
                logger.warn('Failed to fetch liquidity zones for AI payload:', e.message);
            }

            // 3c. Fetch Social Stats from CryptoCompare
            let socialSummary = null;
            try {
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
                liquidityZones: liquidityZones.length > 0 ? liquidityZones.map(z => ({
                    type: z.type,
                    side: z.side,
                    price: z.price,
                    volume: z.volume,
                    strength: z.strength
                })) : 'No significant persistent liquidity zones detected.',
                socialStats: socialSummary || 'Unavailable',
                latestNewsHeadlines: newsHeadlines || 'Unavailable',
                // Multi-Timeframe Context Bundle (Anchor + Micro)
                multiTimeframeContext: {
                    macro_1h: macroFeatures || 'Unavailable (no 1h candles stored yet)',
                    micro_1m: {
                        momentum_1m_pct: features.momentum?.m1,
                        rsi: features.rsi,
                        note: 'Use only for precise entry timing (10% weight).'
                    }
                }
            };

            const systemPrompt_weighted = `
                  # MISSION
You are a High-Frequency Crypto Trading Analyst (BTCINR). Your goal is to provide a BUY, HOLD, or SELL signal every 60 seconds by weighing conflicting data points across multiple timeframes.

# WEIGHTAGE ARCHITECTURE (CRITICAL)
1. LIQUIDITY & ORDERBOOK (35%): Focus on 'walls' and B/S Ratio. These are the primary leads for immediate price pressure.
2. ANCHOR MOMENTUM (25%): HIERARCHY: 1d > 4h > 1h > 5m > 1m. Higher timeframes (HTF) determine the 'Master Bias'. Never fight the 1d/4h trend without extreme volume.
3. VOLATILITY CONTEXT (15%): Use ATR, Bollinger %B, and ADX. ADX > 25 indicates a strong trend that HTF momentum will likely continue.
4. SENTIMENT DIVERGENCE (15%): Compare Fear/Greed vs. B/S Ratio. 
5. MICRO-TECHNICALS (10%): 1m RSI and price change. Use ONLY for precision entry timing once the HTF Bias is confirmed.

# DECISION LOGIC RULES (HTF CONFLUENCE)
- [HTF MASTER BIAS] If 1d, 4h, and 1h momentum are ALL negative (<-1%), you are STRICTLY FORBIDDEN from signaling BUY. Any 1m/5m green candles are "Dead Cat Bounces" or liquidity grabs. Signal SELL or HOLD.
- [CONFLUENCE BONUS] If 1m, 5m, 1h, and 4h momentum are all aligned (all positive or all negative), increase 'confidence' by 1.5. These are high-probability trend-following trades.
- [VOLUME VALIDATION] If Volume Spike < -80%, treat the HTF (1d/4h) trend as the absolute truth. Ignore LTF wiggles; they lack the conviction to flip the trend.
- [B/S RATIO TRAP] If B/S Ratio is high (>10) but 1h/4h momentum is negative, do NOT BUY. This indicates passive "limit-order" buying that is being run over by active market sellers.
- [SPOOF FILTER] IF B/S Ratio > 1000 AND Volume Spike < 10%: FLAG as "Potential Orderbook Spoofing." Lower confidence by 1.5.
- [VOLATILITY SQUEEZE] IF ATR is low AND price is pinched between EMA20 and Resistance (within 0.5%): Signal HOLD for "Volatility Squeeze Breakout."

# LIQUIDITY ZONE INTERPRETATION:
- "wall": Persistent liquidity. "strength": (1-10). Strength 10 walls are the only levels capable of reversing an HTF trend.

# OUTPUT FORMAT (Strict JSON)
{
  "signal": "BUY" | "SELL" | "HOLD",
  "confidence": 0-10,
  "primary_driver": "Identify the 35% or 25% weight factor that decided the move",
  "risk_warning": "Identify the conflicting data point (e.g., HTF Bearish Bias or Low Volume)",
  "trend": "bullish" | "bearish" | "ranging",
  "momentum": "strengthening" | "weakening" | "neutral",
  "sentiment": "extreme fear" | "fear" | "neutral" | "greed" | "extreme greed",
  "risk_level": "low" | "medium" | "high",
  "reasoning": [
    "Point 1: HTF Bias (1d/4h) analysis",
    "Point 2: Orderbook & Liquidity analysis",
    "Point 3: Technical/Volatility confluence"
  ],
  "summary": "1 sentence summarizing why the HTF bias and orderbook led to this decision."
}

                  # REFERENCE EXAMPLES FOR DECISION MAKING:

                  Example 1: SELL SIGNAL
                  Market State: { "chartPatterns": { "headAndShoulders": true, "doubleTop": true }, "indicators": { "adx": 81.39, "macd": { "histogram": -1639.24 } }, "volume": { "volumeSpikePercent": -70.4 }, "marketSentiment": { "label": "Extreme Fear" }, "liquidityZones": [{ "type": "wall", "side": "bid", "price": 6393770 }] }
                  Response: {
              "signal": "SELL",
              "confidence": 8.5,
              "primary_driver": "ANCHOR MOMENTUM (25%)",
              "risk_warning": "Extreme Fear Sentiment (Contrarian Risk)",
              "trend": "bearish",
              "momentum": "strengthening",
              "sentiment": "extreme fear",
              "risk_level": "high",
              "reasoning": [
                "Anchor Momentum is overwhelmingly bearish with an extreme ADX of 81.39 and a deep negative MACD histogram, confirming a high-strength downward trend.",
                "Technical exhaustion is validated by Head & Shoulders and Double Top patterns, suggesting the 25% weight for trend direction is the dominant factor here.",
                "Despite being in Extreme Fear, the absence of a strong B/S ratio or significant bid-wall support near the current price allows the downward momentum to target the distant ₹6393770 liquidity zone."
              ],
              "summary": "High-intensity trend strength (ADX > 80) and bearish structural exhaustion necessitate a sell, targeting the deep bid-side liquidity."
            }

                  Example 2: BUY SIGNAL
                  Market State: { "chartPatterns": { "breakout": true, "doubleBottom": true, "engulfing": "bullish" }, "volume": { "volumeSpikePercent": 120.5 }, "momentum": { "m5": 0.85 }, "liquidityZones": [{ "type": "spoofing", "side": "ask", "price": 6600000 }, { "type": "wall", "side": "bid", "price": 6540000 }] }
                  Response: {
              "signal": "BUY",
              "confidence": 8.8,
              "primary_driver": "LIQUIDITY & ORDERBOOK (35%)",
              "risk_warning": "Greed Sentiment (Exhaustion Risk)",
              "trend": "bullish",
              "momentum": "strengthening",
              "sentiment": "greed",
              "risk_level": "medium",
              "reasoning": [
                "Orderbook dynamics provide the primary buy trigger, with a confirmed bid wall at ₹6540000 providing a 35% weighted structural floor.",
                "A massive 120.5% volume spike validates the breakout, satisfying the requirement to trade in the direction of the strengthening anchor momentum.",
                "The 5m momentum (+0.85%) and bullish engulfing pattern confirm an ideal micro-technical entry point within the broader uptrend."
              ],
              "summary": "A high-volume breakout supported by a persistent bid wall at ₹6540000 confirms institutional demand and trend continuation."
            }

                  Example 3: HOLD SIGNAL
                  Market State: { "chartPatterns": { "breakout": "none" }, "indicators": { "rsi": 51.2, "adx": 14.5 }, "volume": { "volumeSpikePercent": -5.2 }, "marketSentiment": { "label": "Neutral" } }
                  Response: {
              "signal": "HOLD",
              "confidence": 9.5,
              "primary_driver": "LIQUIDITY & ORDERBOOK (35%)",
              "risk_warning": "Low Volume Spike (-5.2%)",
              "trend": "ranging",
              "momentum": "neutral",
              "sentiment": "neutral",
              "risk_level": "low",
              "reasoning": [
                "Anchor Momentum is non-existent (ADX 14.5), which carries a 25% weight towards a neutral stance until a directional trend develops.",
                "The Buy/Sell ratio is near 1:1 and liquidity walls are balanced, failing to trigger the 'Bias towards BUY' rule (requires B/S > 4.0).",
                "Volatility context (RSI 51.2) indicates price is in the 'no-man's land' between support and resistance with no volume confirmation to justify a move."
              ],
              "summary": "A total absence of trend strength and balanced orderbook liquidity makes capital preservation the only logical 1-minute decision."
            }`;



            const systemPrompt = `Given the current technical indicators, Market Structure (Support/Resistance), Chart Patterns (Head & Shoulders, Double/Triple Tops & Bottoms, Flags, Engulfing, Breakouts), Volume data, Momentum changes, Broad Market Context (BTC Dominance/Market Cap), Fear & Greed market sentiment, live Orderbook resting liquidity, Analyzed Liquidity Zones (Persistent Walls and Spoofing detection), Social Media statistics, and the latest Crypto news headlines, determine the best trading action.
      
      LIQUIDITY ZONE INTERPRETATION:
      - "wall": Represents persistent liquidity at a price level. These often act as strong support/resistance or "magnets" that price eventually sweeps.
      - "spoofing": Large orders that appear/disappear quickly. These are often used by market makers to manipulate direction and should be viewed with caution.
      - "strength": Higher values (up to 10) indicate the liquidity is more persistent over time.
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
      Evaluate the context accordingly.

      REFERENCE EXAMPLES FOR DECISION MAKING:

      Example 1: SELL SIGNAL
      Market State: { "chartPatterns": { "headAndShoulders": true, "doubleTop": true }, "indicators": { "adx": 81.39, "macd": { "histogram": -1639.24 } }, "volume": { "volumeSpikePercent": -70.4 }, "marketSentiment": { "label": "Extreme Fear" }, "liquidityZones": [{ "type": "wall", "side": "bid", "price": 6393770 }] }
      Response: {
        "signal": "SELL",
        "confidence": 8.0,
        "trend": "bearish",
        "momentum": "weakening",
        "sentiment": "extreme fear",
        "risk_level": "high",
        "reasoning": [
          "The presence of highly bearish chart patterns, specifically a Head & Shoulders combined with Double and Triple Tops, indicates exhaustion at resistance.",
          "An unusually high ADX of 81.39 alongside a negative MACD histogram (-1639.24) and price dipping below the EMA20 confirms strong downward directional momentum.",
          "Despite positive on-chain supply news, trading volume has cratered (-70.4% spike) and market sentiment is in Extreme Fear, leaving the price vulnerable to dropping toward the prominent bid wall at ₹6393770."
        ],
        "summary": "Overwhelming bearish chart patterns and extreme fear sentiment outweigh conflicting news, signaling a high probability of a downward correction."
      }

      Example 2: BUY SIGNAL
      Market State: { "chartPatterns": { "breakout": true, "doubleBottom": true, "engulfing": "bullish" }, "volume": { "volumeSpikePercent": 120.5 }, "momentum": { "m5": 0.85 }, "liquidityZones": [{ "type": "spoofing", "side": "ask", "price": 6600000 }, { "type": "wall", "side": "bid", "price": 6540000 }] }
      Response: {
        "signal": "BUY",
        "confidence": 8.5,
        "trend": "bullish",
        "momentum": "strengthening",
        "sentiment": "greed",
        "risk_level": "medium",
        "reasoning": [
          "Price has successfully printed a breakout above previous resistance, supported by a Double Bottom formation and a Bullish Engulfing candle.",
          "A massive 120.5% spike in volume validates the upward move, while MACD histogram expansion and an RSI of 68 indicate strong, but not yet overbought, bullish momentum.",
          "The presence of spoofing liquidity on the ask side suggests market makers are trying to suppress price artificially, while a strong bid wall has formed at the new support of ₹6540000."
        ],
        "summary": "A high-volume breakout backed by bullish chart patterns and strong ETF inflow news presents a clear buying opportunity."
      }

      Example 3: HOLD SIGNAL
      Market State: { "chartPatterns": { "breakout": "none" }, "indicators": { "rsi": 51.2, "adx": 14.5 }, "volume": { "volumeSpikePercent": -5.2 }, "marketSentiment": { "label": "Neutral" } }
      Response: {
        "signal": "HOLD",
        "confidence": 9.0,
        "trend": "ranging",
        "momentum": "neutral",
        "sentiment": "neutral",
        "risk_level": "low",
        "reasoning": [
          "Price is hovering exactly in the middle of the established support (₹6400000) and resistance (₹6600000) zones with no distinct chart patterns.",
          "Momentum indicators are completely flat, with RSI near 50, a negligible MACD histogram, and an ADX of 14.50 confirming the absence of any directional trend.",
          "Volume is average and the Buy/Sell ratio is nearly 1:1, aligning with the neutral Fear & Greed index and stagnant news cycle pending macroeconomic data."
        ],
        "summary": "The market is exhibiting perfect chop with flat indicators and no volume, making capital preservation the best strategy until a direction is chosen."
      }`;

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
            logger.info(`  🚀 Momentum    : 1m ${marketStatePayload.momentum?.m1?.toFixed(2)}% | 5m ${marketStatePayload.momentum?.m5?.toFixed(2)}% | 1h ${marketStatePayload.momentum?.h1?.toFixed(2)}% | 4h ${marketStatePayload.momentum?.h4?.toFixed(2)}% | 1d ${marketStatePayload.momentum?.d1?.toFixed(2)}%`);
            logger.info(`  🌍 Market Ctx  : BTC Dom. ${marketStatePayload.marketContext?.btcDominance?.toFixed(1)}% | MCap $${(marketStatePayload.marketContext?.totalMarketCap / 1e12).toFixed(2)}T`);
            logger.info(`  😱 Fear & Greed: ${marketStatePayload.marketSentiment?.score} (${marketStatePayload.marketSentiment?.label})`);
            logger.info(`  📖 Orderbook   : Top Bid ${marketStatePayload.orderbook?.topBids?.[0]?.[0]} | Top Ask ${marketStatePayload.orderbook?.topAsks?.[0]?.[0]}`);
            if (Array.isArray(liquidityZones) && liquidityZones.length > 0) {
                logger.info('  🌊 Liquidity   : ' + liquidityZones.slice(0, 3).map(z => `${z.type}(${z.side}@${z.price})`).join(' | '));
            }
            logger.info(`  👥 Social      : Reddit ${marketStatePayload.socialStats?.redditSubscribers?.toLocaleString()} | Twitter ${marketStatePayload.socialStats?.twitterFollowers?.toLocaleString()}`);
            if (marketStatePayload.latestNewsHeadlines && Array.isArray(marketStatePayload.latestNewsHeadlines)) {
                logger.info('  📰 News Headlines:');
                marketStatePayload.latestNewsHeadlines.forEach((h, i) => logger.info(`     ${i + 1}. ${h}`));
            }
            logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            const resultStr = await this._queryLLM(systemPrompt_weighted, marketStatePayload);
            // const resultStr = await this._queryLLM(systemPrompt, marketStatePayload);

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

            // Extract structured fields from LLM response
            const reasoningStr = parsedResult.reasoning && Array.isArray(parsedResult.reasoning)
                ? parsedResult.reasoning.join('\n- ')
                : null;

            logger.info(`[AI Engine] LLM Reasoning for ${symbol}:`, parsedResult.summary);
            logger.info(`[AI Engine] Primary Driver: ${parsedResult.primary_driver} | Risk Warning: ${parsedResult.risk_warning}`);
            logger.info(`[AI Engine] Trend: ${parsedResult.trend} | Momentum: ${parsedResult.momentum} | Sentiment: ${parsedResult.sentiment}`);

            // Ensure risk_level is a valid string before calling toUpperCase()
            const riskLevelStr = typeof parsedResult.risk_level === 'string'
                ? parsedResult.risk_level.toUpperCase()
                : 'UNKNOWN';

            // 6. Save the Signal to database with all structured AI fields
            // Resolve pair from DB market record for storage
            let marketPair = null;
            try {
                const marketRec = await prisma.market.findUnique({ where: { symbol } });
                marketPair = marketRec?.pair || null;
            } catch (_) {}

            const signalRecord = await prisma.signal.create({
                data: {
                    symbol,
                    baseCoin: baseCoin || null,
                    pair: marketPair,
                    action: parsedResult.signal,
                    confidenceScore: parsedResult.confidence,
                    riskLevel: riskLevelStr,
                    summary: parsedResult.summary || null,
                    primaryDriver: parsedResult.primary_driver || null,
                    riskWarning: parsedResult.risk_warning || null,
                    trend: parsedResult.trend || null,
                    momentum: parsedResult.momentum || null,
                    sentiment: parsedResult.sentiment || null,
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
