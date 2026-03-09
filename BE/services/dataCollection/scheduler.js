const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const coindcxService = require('./coindcx');
const cryptocompareService = require('./cryptocompare');
const sentimentService = require('./sentiment');
const logger = require('../../utils/logger');

/**
 * A simple scheduler using node-cron. 
 * In a highly scalable production setup, consider BullMQ or Agenda.
 */
class DataScheduler {
    constructor() {
        this.jobs = [];
    }

    async start() {
        logger.info('Starting data polling scheduler...');

        // Immediate Bootstrap Run
        try {
            logger.info('[Scheduler] Running initial bootstrap...');
            await this.forceFetchSentiment();
            await this.forceFetchCandles();

            // Try to generate an initial signal
            const aiEngine = require('../aiEngine/aiService');
            await aiEngine.generateSignal('B-BTC_USDT');
        } catch (e) {
            logger.error('[Scheduler] Bootstrap failed:', e.message);
        }

        this._scheduleCoinDCX();
        this._scheduleSentiment();
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

    async forceFetchCandles() {
        const coindcxService = require('./coindcx');
        // Fetch 100 historical candles
        const candles = await coindcxService.getCandles('B-BTC_USDT', '1m', 100);
        if (candles && Array.isArray(candles) && candles.length > 0) {
            const bulkData = candles.map(candle => ({
                symbol: 'B-BTC_USDT',
                timeframe: '1m',
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
            logger.info(`[Scheduler] Bootstrapped ${candles.length} historical candles for B-BTC_USDT.`);
        }
    }

    _scheduleCoinDCX() {
        // Run every minute to fetch the latest 1m candles for B-BTC_USDT
        const btcJob = cron.schedule('* * * * *', async () => {
            try {
                // Re-use force fetch for simplicity in cron
                await this.forceFetchCandles();

                // Trigger AI prediction every 5 minutes (or 1m if preferred)
                // We'll generate a signal every minute since it's 1m candles.
                const aiEngine = require('../aiEngine/aiService');
                await aiEngine.generateSignal('B-BTC_USDT');
            } catch (error) {
                logger.error('[Scheduler ERROR] CoinDCX Job Failed:', error.message);
            }
        });

        this.jobs.push(btcJob);
    }

    _scheduleSentiment() {
        // Run every day at Midnight (00:00)
        const sentimentJob = cron.schedule('0 0 * * *', async () => {
            try {
                logger.info('[Scheduler] Fetching Fear & Greed Index on Cron');
                await this.forceFetchSentiment();
            } catch (error) {
                logger.error('[Scheduler ERROR] Sentiment Job Failed:', error.message);
            }
        });

        this.jobs.push(sentimentJob);
    }
}

module.exports = new DataScheduler();
