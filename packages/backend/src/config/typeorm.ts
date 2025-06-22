import 'reflect-metadata';
import { DataSource, DataSourceOptions, Repository, ObjectLiteral } from 'typeorm';
import { Price, CollateralizedDebtPosition } from '../entities';
import CONFIG from './index';
import logger from '../utils/logger';

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: CONFIG.ANALYTICS_DB_HOST,
  port: CONFIG.ANALYTICS_DB_PORT,
  username: CONFIG.DB_USERNAME,
  password: CONFIG.DB_PASSWORD,
  database: CONFIG.ANALYTICS_DB_NAME,
  entities: [Price, CollateralizedDebtPosition],
  synchronize: false,
  logging: CONFIG.NODE_ENV === 'development' && CONFIG.DB_LOGGING ? ['error', 'warn'] : ['error'],
  connectTimeout: CONFIG.DB_CONNECT_TIMEOUT,
  acquireTimeout: CONFIG.DB_MAX_QUERY_TIME,
  charset: CONFIG.DB_CHARSET,
  timezone: CONFIG.DB_TIMEZONE,
  supportBigNumbers: CONFIG.DB_SUPPORT_BIG_NUMBERS,
  bigNumberStrings: true,
  dateStrings: true,
  extra: {
    connectionLimit: 10,
  },
} as DataSourceOptions);

export async function initializeTypeORM(): Promise<void> {
  try {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
  } catch (error) {
    logger.error('Failed to initialize TypeORM Data Source:', error);
    throw error;
  }
}

export async function closeTypeORM(): Promise<void> {
  try {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
      logger.info('TypeORM Data Source closed successfully');
    }
  } catch (error) {
    logger.error('Failed to close TypeORM Data Source:', error);
    throw error;
  }
}

export function getRepository<T extends ObjectLiteral>(entity: new () => T): Repository<T> {
  return AppDataSource.getRepository(entity) as Repository<T>;
} 