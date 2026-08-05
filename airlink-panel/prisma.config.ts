import 'dotenv/config';
import { defineConfig } from 'prisma/config';

declare const process: any;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL || 'file:./storage/dev.db',
  },
});
