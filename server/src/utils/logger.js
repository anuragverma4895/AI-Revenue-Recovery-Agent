/**
 * Simple structured logger.
 * Uses console with timestamps and levels.
 * In production, this would be replaced with winston/pino.
 */

const LOG_LEVELS = {
  ERROR: 'ERROR',
  WARN: 'WARN',
  INFO: 'INFO',
  DEBUG: 'DEBUG'
};

const formatTimestamp = () => new Date().toISOString();

const log = (level, message, data = null) => {
  const entry = {
    timestamp: formatTimestamp(),
    level,
    message,
    ...(data && { data })
  };

  switch (level) {
    case LOG_LEVELS.ERROR:
      console.error(JSON.stringify(entry));
      break;
    case LOG_LEVELS.WARN:
      console.warn(JSON.stringify(entry));
      break;
    case LOG_LEVELS.DEBUG:
      if (process.env.NODE_ENV === 'development') {
        console.log(JSON.stringify(entry));
      }
      break;
    default:
      console.log(JSON.stringify(entry));
  }
};

const logger = {
  info: (message, data) => log(LOG_LEVELS.INFO, message, data),
  warn: (message, data) => log(LOG_LEVELS.WARN, message, data),
  error: (message, data) => log(LOG_LEVELS.ERROR, message, data),
  debug: (message, data) => log(LOG_LEVELS.DEBUG, message, data)
};

module.exports = { logger };
