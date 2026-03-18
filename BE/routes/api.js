var express = require('express');
var router = express.Router();
const { prisma } = require('../utils/db');
const aiEngine = require('../services/aiEngine/aiService');

/**
 * Helper to resolve the internal 'symbol' from either a symbol or pair string.
 */
async function resolveSymbol(input) {
    if (!input) return 'BTCINR'; // Default to the currently tracked market

    const market = await prisma.market.findFirst({
        where: {
            OR: [
                { symbol: input },
                { pair: input }
            ]
        }
    });

    return market ? market.symbol : input;
}

/**
 * GET latest signals
 */
router.get('/signals/latest', async function (req, res, next) {
    try {
        const symbol = await resolveSymbol(req.query.symbol);

        // Attempting to pull the latest 10 signals
        const signals = await prisma.signal.findMany({
            where: { symbol },
            orderBy: { timestamp: 'desc' },
            take: 20
        });

        res.json({ success: true, data: signals });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST manually trigger AI analysis for a pair
 */
router.post('/signals/generate', async function (req, res, next) {
    try {
        const symbol = req.body.symbol || 'B-BTC_USDT';
        const newSignal = await aiEngine.generateSignal(symbol);

        res.json({ success: true, data: newSignal });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

const coindcxService = require('../services/dataCollection/coindcx');

/**
 * GET current market data and technical stats 
 */
router.get('/analytics/market', async function (req, res, next) {
    try {
        const symbol = await resolveSymbol(req.query.symbol);
        const timeframe = coindcxService.defaultInterval;

        const candles = await prisma.candle.findMany({
            where: { symbol, timeframe },
            orderBy: { timestamp: 'desc' },
            take: 50
        });

        res.json({ success: true, count: candles.length, data: candles });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET liquidity zones for a symbol
 */
router.get('/analytics/liquidity', async function (req, res, next) {
    try {
        const symbol = await resolveSymbol(req.query.symbol);
        const zones = await prisma.liquidityZone.findMany({
            where: { symbol },
            orderBy: { timestamp: 'desc' },
            take: 20
        });

        res.json({ success: true, data: zones });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET tracked markets
 */
router.get('/markets/tracked', async function (req, res, next) {
    try {
        const tracked = await prisma.market.findMany({
            where: { isTracking: true }
        });
        res.json({ success: true, data: tracked });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
