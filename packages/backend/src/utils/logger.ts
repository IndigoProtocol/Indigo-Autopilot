import winston from 'winston';
import CONFIG from '../config/index';

const demoFormatter = winston.format.printf(({ timestamp, level, message, ...meta }: winston.Logform.TransformableInfo) => {
  const ts = new Date(timestamp as string).toLocaleTimeString();
  const msg = String(message);
  
  if (msg.includes('AUTOPILOT STATUS')) {
    return `\n🤖 [${ts}] ${msg}`;
  }
  
  if (msg.includes('CDP ACTION')) {
    return `⚡ [${ts}] ${msg}`;
  }
  
  if (msg.includes('PORTFOLIO')) {
    return `💼 [${ts}] ${msg}`;
  }
  
  if (msg.includes('PRICES')) {
    return `💰 [${ts}] ${msg}`;
  }
  
  if (level === 'error') {
    return `❌ [${ts}] ${msg}`;
  }
  
  if (level === 'warn') {
    return `⚠️  [${ts}] ${msg}`;
  }
  
  return `ℹ️  [${ts}] ${msg}`;
});

const logger = winston.createLogger({
  level: CONFIG.LOG_LEVEL,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        demoFormatter
      )
    }),
    new winston.transports.File({
      filename: `${CONFIG.LOG_PATH}/logs/error.log`,
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      )
    }),
    new winston.transports.File({
      filename: `${CONFIG.LOG_PATH}/logs/combined.log`,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      )
    }),
  ],
});

export default logger; 