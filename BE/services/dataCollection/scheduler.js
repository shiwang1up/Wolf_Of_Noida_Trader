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

/**
 * A simple scheduler using node-cron. 
 * In a highly scalable production setup, consider BullMQ or Agenda.
 */
class DataScheduler {
    constructor() {
        this.jobs = [];
    }

    start() {
        console.log('Starting data polling scheduler...');
        this._scheduleCoinDCX();
        this._scheduleSentiment();
    }

    _scheduleCoinDCX() {
        // Run every minute to fetch the latest 1m candles for B-BTC_USDT
        const btcJob = cron.schedule('* * * * *', async () => {
            try {
                console.log('[Scheduler] Fetching latest candles from CoinDCX for B-BTC_USDT');
                const candles = await coindcxService.getCandles('B-BTC_USDT', '1m', 1);

                if (candles && candles.length > 0) {
                    const candle = candles[0]; // Assuming latest candle comes first or structure matches

                    await prisma.candle.upsert({
                        where: {
                            symbol_timeframe_timestamp: {
                                symbol: 'B-BTC_USDT',
                                timeframe: '1m',
                                timestamp: new Date(candle.time) // Ensure candle object structure matches CoinDCX response
                            }
                        },
                        update: {
                            open: parseFloat(candle.open),
                            high: parseFloat(candle.high),
                            low: parseFloat(candle.low),
                            close: parseFloat(candle.close),
                            volume: parseFloat(candle.volume)
                        },
                        create: {
                            symbol: 'B-BTC_USDT',
                            timeframe: '1m',
                            timestamp: new Date(candle.time),
                            open: parseFloat(candle.open),
                            high: parseFloat(candle.high),
                            low: parseFloat(candle.low),
                            close: parseFloat(candle.close),
                            volume: parseFloat(candle.volume)
                        }
                    });
                    console.log('[Scheduler] Saved candle data for B-BTC_USDT');
                }
            } catch (error) {
                console.error('[Scheduler ERROR] CoinDCX Job Failed:', error.message);
            }
        });

        this.jobs.push(btcJob);
    }

    _scheduleSentiment() {
        // Run every day at Midnight (00:00)
        const sentimentJob = cron.schedule('0 0 * * *', async () => {
            try {
                console.log('[Scheduler] Fetching Fear & Greed Index');
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
                    console.log('[Scheduler] Saved Fear & Greed data:', latestFgi.value_classification);
                }
            } catch (error) {
                console.error('[Scheduler ERROR] Sentiment Job Failed:', error.message);
            }
        });

        this.jobs.push(sentimentJob);
    }
}

module.exports = new DataScheduler();
