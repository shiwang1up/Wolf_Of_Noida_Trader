require('dotenv').config({ path: '../.env' });
require('dotenv').config({ path: '.env', override: true });
const { prisma } = require('../utils/db');

/**
 * clear-binance.js
 * 
 * Simple utility script to completely wipe all historical Binance candle data
 * from the database to ensure a clean slate before fetching new data.
 * 
 * Usage:
 *   node scripts/clear-binance.js
 */

(async () => {
    console.log("⏳ Clearing BinanceCandle database...");
    try {
        const deleted = await prisma.binanceCandle.deleteMany({});
        console.log(`✅ Successfully wiped ALL ${deleted.count} historical records from the BinanceCandle table.`);
        console.log(`   Your database is now fully clean and ready for a fresh fetch!`);
    } catch (e) {
        console.error("❌ Error clearing data:", e.message);
    } finally {
        await prisma.$disconnect();
    }
})();
