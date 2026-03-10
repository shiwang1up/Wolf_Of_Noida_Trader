var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
var apiRouter = require('./routes/api');
var scheduler = require('./services/dataCollection/scheduler');

const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const customLogger = require('./utils/logger');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Start the background data polling scheduler after verifying DB
async function bootstrap() {
    try {
        customLogger.info('Verifying PostgreSQL Database Connection...');
        // Quick read/write test to prove connection
        const marketCount = await prisma.market.count();
        customLogger.info(`✅ [DB OK] Connection successful. Currently tracking ${marketCount} markets.`);

        scheduler.start();
    } catch (error) {
        customLogger.error('❌ [DB ERROR] Database connection failed:', error.message);
        customLogger.error('Please check your Docker container, database, and .env credentials.');
        process.exit(1);
    }
}

bootstrap();

var app = express();

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/api', apiRouter);

module.exports = app;
