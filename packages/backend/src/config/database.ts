import mysql from 'mysql2/promise';
import CONFIG from './index';
import logger from '../utils/logger';

export interface IDatabase {
  connection: mysql.Connection | null;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
}

class Database implements IDatabase {
  public connection: mysql.Connection | null = null;

  async connect(): Promise<void> {
    try {
      logger.info('Connecting to Analytics Database...');
      
      this.connection = await mysql.createConnection({
        host: CONFIG.ANALYTICS_DB_HOST,
        port: CONFIG.ANALYTICS_DB_PORT,
        user: CONFIG.DB_USERNAME,
        password: CONFIG.DB_PASSWORD,
        database: CONFIG.ANALYTICS_DB_NAME,
        charset: CONFIG.DB_CHARSET,
        timezone: CONFIG.DB_TIMEZONE,
        connectTimeout: CONFIG.DB_CONNECT_TIMEOUT,
        supportBigNumbers: CONFIG.DB_SUPPORT_BIG_NUMBERS,
        bigNumberStrings: true,
        dateStrings: true,
      });

      logger.info(`Successfully connected to Analytics Database: ${CONFIG.ANALYTICS_DB_NAME}`);
    } catch (error) {
      logger.error('Failed to connect to Analytics Database:', error);
      throw new Error(`Database connection failed: ${error}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      try {
        await this.connection.end();
        this.connection = null;
        logger.info('Database connection closed');
      } catch (error) {
        logger.error('Error closing database connection:', error);
        throw error;
      }
    }
  }

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    if (!this.connection) {
      throw new Error('Database not connected. Call connect() first.');
    }

    try {
      const [rows] = await this.connection.execute(sql, params);
      return rows as T[];
    } catch (error) {
      logger.error('Database query error:', { sql, params, error });
      throw error;
    }
  }
}

export const database = new Database();
export default database; 