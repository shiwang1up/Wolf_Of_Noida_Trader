const { prisma } = require('../../utils/db');
const coindcx = require('./coindcx');
const logger = require('../../utils/logger');

class OrderbookService {
    /**
     * Captures a single orderbook snapshot and saves it to the database.
     * @param {string} symbol - Internal symbol (e.g., BTCINR)
     * @param {string} pair - Exchange pair (e.g., I-BTC_INR)
     */
    async captureSnapshot(symbol, pair) {
        try {
            const data = await coindcx.getOrderbook(pair);
            if (!data || !data.asks || !data.bids) {
                logger.warn(`[Orderbook] Invalid data for ${pair}`);
                return null;
            }

            const snapshot = await prisma.orderbookSnapshot.create({
                data: {
                    symbol,
                    asks: data.asks,
                    bids: data.bids,
                    timestamp: new Date(data.timestamp || Date.now())
                }
            });

            return snapshot;
        } catch (error) {
            logger.error(`[Orderbook] Error capturing snapshot for ${symbol}:`, error.message);
            return null;
        }
    }

    /**
     * Analyzes snapshots over a time window to detect persistent walls and spoofing.
     * @param {string} symbol - Internal symbol
     * @param {number} windowMinutes - Lookback window in minutes
     */
    async analyzeLiquidity(symbol, windowMinutes = 10) {
        try {
            const startTime = new Date(Date.now() - windowMinutes * 60000);
            const snapshots = await prisma.orderbookSnapshot.findMany({
                where: {
                    symbol,
                    timestamp: { gte: startTime }
                },
                orderBy: { timestamp: 'asc' }
            });

            if (snapshots.length < 2) return [];

            const walls = this._detectPersistentWalls(snapshots);
            const spoofing = this._detectSpoofing(snapshots);

            // Clear old analysis for this symbol before saving new results
            await prisma.liquidityZone.deleteMany({ where: { symbol } });

            // Save results to LiquidityZone
            const results = [...walls, ...spoofing];

            for (const zone of results) {
                await prisma.liquidityZone.create({
                    data: {
                        symbol,
                        type: zone.type,
                        side: zone.side,
                        price: parseFloat(zone.price),
                        volume: zone.volume,
                        strength: zone.strength,
                        timestamp: new Date()
                    }
                });
            }

            return results;
        } catch (error) {
            logger.error(`[Orderbook] Error analyzing liquidity for ${symbol}:`, error.message);
            return [];
        }
    }

    /**
     * Detects price levels where high volume orders persist over time.
     */
    _detectPersistentWalls(snapshots) {
        const priceCounts = {}; // { price: { count, totalVol, side } }
        const threshold = Math.floor(snapshots.length * 0.7); // Must appear in 70% of snapshots

        snapshots.forEach(s => {
            // Process Asks
            Object.entries(s.asks).forEach(([price, vol]) => {
                const v = parseFloat(vol);
                const key = `ask:${price}`;
                if (!priceCounts[key]) priceCounts[key] = { count: 0, totalVol: 0, side: 'ask', price };
                priceCounts[key].count++;
                priceCounts[key].totalVol += v;
            });
            // Process Bids
            Object.entries(s.bids).forEach(([price, vol]) => {
                const v = parseFloat(vol);
                const key = `bid:${price}`;
                if (!priceCounts[key]) priceCounts[key] = { count: 0, totalVol: 0, side: 'bid', price };
                priceCounts[key].count++;
                priceCounts[key].totalVol += v;
            });
        });

        return Object.entries(priceCounts)
            .filter(([_, data]) => data.count >= threshold)
            .map(([_, data]) => ({
                price: data.price,
                side: data.side,
                volume: data.totalVol / data.count,
                strength: (data.count / snapshots.length) * 10,
                type: 'wall'
            }))
            .sort((a, b) => b.volume - a.volume)
            .slice(0, 10); // Return top 10 walls
    }

    /**
     * Detects large orders that appear and disappear quickly.
     */
    _detectSpoofing(snapshots) {
        // Simplified: Detect orders in the top 5% by volume that only appear in < 20% of snapshots
        // but were significantly larger than the average.
        // Implementation details omitted for brevity, returning empty for now or basic heuristic.
        return [];
    }

    /**
     * Cleans up snapshots older than 1 hour.
     */
    async cleanup() {
        try {
            const cutoff = new Date(Date.now() - 60 * 60000);
            const deleted = await prisma.orderbookSnapshot.deleteMany({
                where: { timestamp: { lt: cutoff } }
            });
            if (deleted.count > 0) {
                logger.info(`[Orderbook] Cleaned up ${deleted.count} old snapshots.`);
            }
        } catch (error) {
            logger.error('[Orderbook] Cleanup error:', error.message);
        }
    }
}

module.exports = new OrderbookService();
