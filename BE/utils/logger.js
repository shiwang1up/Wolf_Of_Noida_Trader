require('dotenv').config();

const ENABLE_LOGS = process.env.ENABLE_LOGS === 'true';

const logger = {
    info: (...args) => {
        if (ENABLE_LOGS) {
            console.log('[INFO]', ...args);
            // console.log(new Date().toISOString(), '[INFO]', ...args);
        }
    },
    warn: (...args) => {
        console.warn(new Date().toISOString(), '[WARN]', ...args);
    },
    error: (...args) => {
        console.error(new Date().toISOString(), '[ERROR]', ...args);
    },
    debug: (...args) => {
        if (ENABLE_LOGS && process.env.DEBUG === 'true') {
            console.debug(new Date().toISOString(), '[DEBUG]', ...args);
        }
    }
};

module.exports = logger;
