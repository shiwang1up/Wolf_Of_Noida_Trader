const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const logger = require('./logger');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    // Fail fast with a clear, actionable message when the database URL is misconfigured
    throw new Error(
        'DATABASE_URL environment variable is not set or empty. ' +
        'Please configure DATABASE_URL to point to your PostgreSQL instance before starting the application.'
    );
}

const pool = new Pool({ connectionString });

// Handle pool errors to prevent process crashes
pool.on('error', (err) => {
    logger.error('Unexpected error on idle database client', err.message);
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

module.exports = {
    prisma,
    pool,
};
