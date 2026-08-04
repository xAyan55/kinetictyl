import { resolve } from 'node:path';

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'file:./kinetictyl.db';
}

export const CONFIG = {
  PORT: Number(process.env.PORT) || 8080,
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_URL: process.env.DATABASE_URL,
  APP_SECRET: process.env.APP_SECRET || 'z9K7vR2w4xY8pQ1nJ3mB5vT6cE9rW0qY',
  MCJARS_BASE_URL: process.env.MCJARS_BASE_URL || 'https://mcjars.app',
  ALLOW_REGISTRATION: process.env.ALLOW_REGISTRATION !== 'false'
};
