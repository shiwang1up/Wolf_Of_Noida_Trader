require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { prisma } = require('../utils/db');
const logger = require('../utils/logger');

/**
 * Resets the database by deleting all records from all tables.
 * Use this for a fresh start.
 */
async function resetDatabase() {
    try {
        logger.info('--- Database Reset Initiated ---');

        // Ordered deletion to respect potential (though not currently present) foreign key constraints
        // If you add relations later, delete the children first.

        logger.info('Deleting Liquidity Zones...');
        await prisma.liquidityZone.deleteMany();

        logger.info('Deleting Orderbook Snapshots...');
        await prisma.orderbookSnapshot.deleteMany();

        logger.info('Deleting Signals...');
        await prisma.signal.deleteMany();

        logger.info('Deleting News...');
        await prisma.news.deleteMany();

        logger.info('Deleting Sentiment...');
        await prisma.sentiment.deleteMany();

        logger.info('Deleting Candles...');
        await prisma.candle.deleteMany();

        logger.info('Deleting Markets...');
        await prisma.market.deleteMany();

        logger.info('✅ Database reset successfully.');
        logger.info('--- Database Reset Complete ---');
        process.exit(0);
    } catch (error) {
        logger.error('❌ Database reset failed:', error.message);
        process.exit(1);
    }
}

resetDatabase();
