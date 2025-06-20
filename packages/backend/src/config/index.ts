import dotenv from 'dotenv';
import process from 'process';

dotenv.config();

const CONFIG = {
  DB_TYPE: process.env.DB_TYPE || 'mysql',
  ANALYTICS_DB_HOST: process.env.ANALYTICS_DB_HOST || 'localhost',
  ANALYTICS_DB_PORT: parseInt(process.env.ANALYTICS_DB_PORT || '3306'),
  DB_USERNAME: process.env.DB_USERNAME || 'root',
  DB_PASSWORD: process.env.DB_PASSWORD || '',
  ANALYTICS_DB_NAME: process.env.ANALYTICS_DB_NAME || 'vapor',
  ANALYTICS_DB_SCHEMA: process.env.ANALYTICS_DB_SCHEMA || 'analytics-mainnet-v2.1',
  DB_SYNCHRONIZE: process.env.DB_SYNCHRONIZE === 'true',
  DB_LOGGING: process.env.DB_LOGGING === 'false',
  DB_CONNECT_TIMEOUT: parseInt(process.env.DB_CONNECT_TIMEOUT || '5000'),
  DB_MAX_QUERY_TIME: parseInt(process.env.DB_MAX_QUERY_TIME || '5000'),
  DB_CHARSET: process.env.DB_CHARSET || 'utf8mb4',
  DB_TIMEZONE: process.env.DB_TIMEZONE || 'Z',
  DB_SUPPORT_BIG_NUMBERS: process.env.DB_SUPPORT_BIG_NUMBERS === 'true',

  BLOCKFROST_URL: process.env.BLOCKFROST_URL || 'https://cardano-mainnet.blockfrost.io/api/v0',
  BLOCKFROST_PROJECT_ID: process.env.BLOCKFROST_PROJECT_ID || '',
  CARDANO_NETWORK: process.env.CARDANO_NETWORK || 'Mainnet',

  API_PORT: parseInt(process.env.API_PORT || '3000'),
  WEBSOCKET_PORT: parseInt(process.env.WEBSOCKET_PORT || '3001'),
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',

  BOT_ENABLED: process.env.BOT_ENABLED === 'true',
  MONITORING_INTERVAL: parseInt(process.env.MONITORING_INTERVAL || '60000'),
  STRATEGY_EXECUTION_INTERVAL: parseInt(process.env.STRATEGY_EXECUTION_INTERVAL || '300000'),
  PRICE_CHECK_INTERVAL: parseInt(process.env.PRICE_CHECK_INTERVAL || '30000'),

  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  LOG_PATH: process.env.LOG_PATH || './',

  JWT_SECRET: process.env.JWT_SECRET || '',
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || '',

  NODE_ENV: process.env.NODE_ENV || 'development',
};

export default CONFIG; 