const cron = require('node-cron');
const { prisma } = require('../../utils/db');
const coindcxService = require('./coindcx');
const cryptocompareService = require('./cryptocompare');
const sentimentService = require('./sentiment');
const orderbookService = require('./orderbookService');
const logger = require('../../utils/logger');

/**
 * A simple scheduler using node-cron. 
 * In a highly scalable production setup, consider BullMQ or Agenda.
 */
class DataScheduler {
    constructor() {
        this.jobs = [];
        this.isStarted = false;
    }

    async start() {
        if (this.isStarted) {
            logger.warn('[Scheduler] Attempted to start scheduler, but it is already running.');
            return;
        }
        this.isStarted = true;
        logger.info('Starting data polling scheduler...');

        // Immediate Bootstrap Run
        try {
            logger.info('[Scheduler] Running initial bootstrap...');
            await this.forceFetchMarkets();
            await this.forceFetchSentiment();
            await this.forceFetchNews();

            // Try to generate an initial signal for a quick test
            const activeMarkets = await prisma.market.findMany({
                where: { status: 'active', isTracking: true },
                take: 1
            });
            if (activeMarkets.length > 0) {
                try {
                    await this.forceFetchCandles(activeMarkets[0], 100);
                    const aiEngine = require('../aiEngine/aiService');
                    await aiEngine.generateSignal(activeMarkets[0].symbol, activeMarkets[0].baseCoin, activeMarkets[0].quoteCoin);
                } catch (apiError) {
                    if (apiError.message.includes('Not enough candle data')) {
                        logger.warn(`[Scheduler] Initial AI bootstrap for ${activeMarkets[0].symbol} lacks data. Refetching deeper history...`);
                        await this.forceFetchCandles(activeMarkets[0], 150);
                        // Try one more time
                        try {
                            await aiEngine.generateSignal(activeMarkets[0].symbol, activeMarkets[0].baseCoin, activeMarkets[0].quoteCoin);
                        } catch (e2) {
                            logger.warn(`[Scheduler] Second bootstrap attempt for ${activeMarkets[0].symbol} also failed. Loop will handle it.`);
                        }
                    } else {
                        logger.warn(`[Scheduler] Bootstrap signal for ${activeMarkets[0].symbol} failed: ${apiError.message}. Proceeding...`);
                    }
                }
            }
        } catch (e) {
            logger.error('[Scheduler] Bootstrap failed:', e.message);
        }

        this._scheduleCoinDCX();
        this._scheduleSentiment();
        this._startOrderbookPolling();
        this._scheduleCleanup();
    }

    async forceFetchMarkets() {
        const coindcxService = require('./coindcx');
        logger.info('[Scheduler] Fetching latest active markets from CoinDCX...');
        const markets = await coindcxService.getActiveMarkets();

        if (markets && markets.length > 0) {
            // Rate limiting the upserts to avoid overloading the DB or memory in one tick
            logger.info(`[Scheduler] Upserting ${markets.length} markets into database...`);
            for (const m of markets) {
                await prisma.market.upsert({
                    where: { symbol: m.symbol },
                    update: {
                        status: m.status,
                        pair: m.pair,
                        baseCoin: m.baseCoin,
                        quoteCoin: m.quoteCoin
                    },
                    create: { ...m }
                });
            }
            logger.info(`[Scheduler] Synced ${markets.length} active markets to database.`);

            // [NEW] Auto-enable tracking for default pairs if nothing is being tracked
            const trackedCount = await prisma.market.count({ where: { isTracking: true } });
            if (trackedCount === 0) {
                logger.info('[Scheduler] No markets currently tracked. Auto-enabling BTC and ETH pairs for bootstrap...');
                const defaultPairs = ['I-BTC_INR', 'I-ETH_INR', 'I-SOL_INR'];
                const updated = await prisma.market.updateMany({
                    where: { symbol: { in: defaultPairs } },
                    data: { isTracking: true }
                });
                logger.info(`[Scheduler] Auto-tracked ${updated.count} default markets.`);
            }
        }
    }

    async forceFetchSentiment() {
        const sentimentService = require('./sentiment');
        const fgiData = await sentimentService.getFearGreedIndex();
        if (fgiData && fgiData.data && fgiData.data.length > 0) {
            const latestFgi = fgiData.data[0];
            await prisma.sentiment.create({
                data: {
                    source: 'FearGreedIndex',
                    score: parseFloat(latestFgi.value),
                    label: latestFgi.value_classification,
                    timestamp: new Date(latestFgi.timestamp * 1000)
                }
            });
            logger.info('[Scheduler] Saved Fear & Greed data:', latestFgi.value_classification);
        }
    }

    async forceFetchNews() {
        const sentimentService = require('./sentiment');

        // Check if we already have recent news cached (less than 8 hours old)
        const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000);
        const recentCache = await prisma.news.findFirst({
            orderBy: { timestamp: 'desc' },
            where: {
                source: 'CryptoPanic',
                timestamp: { gte: eightHoursAgo }
            }
        });

        if (recentCache) {
            logger.info('[Scheduler] CryptoPanic news is less than 8 hours old. Using cached DB version instead of fetching.');
            return;
        }

        const news = await sentimentService.getNews('important', 'BTC,ETH');
        if (news && news.length > 0) {
            await prisma.news.create({
                data: {
                    source: 'CryptoPanic',
                    headlines: news,
                    timestamp: new Date()
                }
            });
            logger.info(`[Scheduler] Cached ${news.length} CryptoPanic news headlines to DB.`);
        }
    }

    async forceFetchCandles(market, limit = 100) {
        const coindcxService = require('./coindcx');
        // Fetch historical candles using 'pair' (e.g. B-BTC_USDT) per official documentation
        const candles = await coindcxService.getCandles(market.pair, coindcxService.defaultInterval, limit);
        if (candles && Array.isArray(candles) && candles.length > 0) {
            // CoinDCX returns candles in descending order (newest first)
            // We must reverse them so the database and AI engines process them chronologically
            const bulkData = candles.reverse().map(candle => ({
                symbol: market.symbol, // Store internal symbol (e.g. BTCUSDT)
                timeframe: coindcxService.defaultInterval,
                timestamp: new Date(candle.time),
                open: parseFloat(candle.open),
                high: parseFloat(candle.high),
                low: parseFloat(candle.low),
                close: parseFloat(candle.close),
                volume: parseFloat(candle.volume)
            }));

            // Prisma skip duplicates isn't perfect, so upsert in a tx or loop
            await prisma.$transaction(
                bulkData.map(c => prisma.candle.upsert({
                    where: { symbol_timeframe_timestamp: { symbol: c.symbol, timeframe: c.timeframe, timestamp: c.timestamp } },
                    update: { ...c },
                    create: { ...c }
                }))
            );
            logger.info(`[Scheduler] Bootstrapped ${candles.length} historical candles for ${market.symbol}.`);
        }
    }

    _scheduleCoinDCX() {
        // Run every minute to fetch the latest candles for tracked coins
        // (Note: frequency matches defaultInterval '1m')
        const marketJob = cron.schedule('* * * * *', async () => {
            try {
                // Fetch tracked active markets from our DB.
                const activeMarkets = await prisma.market.findMany({
                    where: { status: 'active', isTracking: true },
                    take: 5
                });

                if (activeMarkets.length > 0) {
                    logger.info(`[Scheduler] Processing ${activeMarkets.length} tracked markets...`);
                } else {
                    // Periodic heartbeat to show the scheduler is alive
                    logger.info('[Scheduler] Heartbeat: No markets are currently selected for tracking. Run "forceFetchMarkets" or update DB.');
                    await this.forceFetchMarkets(); // This will auto-enable defaults if count is 0
                }

                const aiEngine = require('../aiEngine/aiService');

                // Loop through dynamic markets
                for (const market of activeMarkets) {
                    try {
                        // Check if we have enough candles for AI Engine (needs 50+)
                        const timeframe = coindcxService.defaultInterval;
                        const candleCount = await prisma.candle.count({
                            where: { symbol: market.symbol, timeframe }
                        });

                        if (candleCount < 50) {
                            logger.info(`[Scheduler] Market ${market.symbol} has insufficient candles (${candleCount}). Bootstrapping 100 historical candles...`);
                            await this.forceFetchCandles(market, 100);
                        } else {
                            // Regularly fetch the latest 5 candles to keep data fresh
                            await this.forceFetchCandles(market, 5);
                        }

                        // Generate Signal dynamically parsing the baseCoin (e.g., 'BTC')
                        await aiEngine.generateSignal(market.symbol, market.baseCoin, market.quoteCoin);
                    } catch (loopError) {
                        if (loopError.message.includes('Not enough candle data')) {
                            logger.warn(`[Scheduler] AI Engine lacks data for ${market.symbol}. Retrying deep bootstrap...`);
                            await this.forceFetchCandles(market, 150); // Fetch even more
                        } else {
                            logger.warn(`[Scheduler WARNING] API or Indicator generation failed for ${market.symbol}:`, loopError.message);
                        }
                    }

                    // Simple sleep to ease off API limits
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }

            } catch (error) {
                logger.error('[Scheduler ERROR] Dynamic CoinDCX Job Failed:', error.message);
            }
        });

        this.jobs.push(marketJob);
    }

    _scheduleSentiment() {
        // Run every day at Midnight (00:00) for Fear & Greed
        const fgiJob = cron.schedule('0 0 * * *', async () => {
            try {
                logger.info('[Scheduler] Fetching Fear & Greed Index on Cron');
                await this.forceFetchSentiment();
            } catch (error) {
                logger.error('[Scheduler ERROR] Fear & Greed Job Failed:', error.message);
            }
        });

        // Run 3 times a day (every 8 hours) for CryptoPanic News to stay within free tier
        const newsJob = cron.schedule('0 0,8,16 * * *', async () => {
            try {
                logger.info('[Scheduler] Fetching CryptoPanic News on Cron');
                await this.forceFetchNews();
            } catch (error) {
                logger.error('[Scheduler ERROR] CryptoPanic News Job Failed:', error.message);
            }
        });

        // Run once a day to refresh CoinDCX Available Markets list
        const marketSyncJob = cron.schedule('0 1 * * *', async () => {
            try {
                logger.info('[Scheduler] Syncing dynamic markets from CoinDCX on Cron');
                await this.forceFetchMarkets();
            } catch (error) {
                logger.error('[Scheduler ERROR] Market Sync Job Failed:', error.message);
            }
        });

        this.jobs.push(fgiJob, newsJob, marketSyncJob);
    }

    _startOrderbookPolling() {
        // High-frequency orderbook polling (every 10 seconds)
        // This is sub-minute, so we use setInterval instead of cron
        setInterval(async () => {
            try {
                const trackedMarkets = await prisma.market.findMany({
                    where: { status: 'active', isTracking: true }
                });

                for (const market of trackedMarkets) {
                    await orderbookService.captureSnapshot(market.symbol, market.pair);
                }
            } catch (error) {
                logger.error('[Scheduler] Orderbook polling error:', error.message);
            }
        }, 10000); // 10 seconds frequency

        // Analysis polling (every 5 minutes)
        setInterval(async () => {
            try {
                const trackedMarkets = await prisma.market.findMany({
                    where: { status: 'active', isTracking: true }
                });

                for (const market of trackedMarkets) {
                    await orderbookService.analyzeLiquidity(market.symbol, 10);
                }
            } catch (error) {
                logger.error('[Scheduler] Liquidity analysis error:', error.message);
            }
        }, 5 * 60 * 1000); // 5 minutes frequency
    }

    _scheduleCleanup() {
        // Run cleanup every hour
        const cleanupJob = cron.schedule('0 * * * *', async () => {
            await orderbookService.cleanup();
        });
        this.jobs.push(cleanupJob);
    }
}

module.exports = new DataScheduler();
