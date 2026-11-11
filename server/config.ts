import path from 'node:path';
import 'dotenv/config';
import {z} from 'zod';

const schema=z.object({
  PORT:z.coerce.number().int().positive().default(4000), HOST:z.string().default('0.0.0.0'),
  CORS_ORIGIN:z.string().url().default('http://localhost:5173'), COOKIE_SECRET:z.string().min(32),
  COOKIE_SECURE:z.enum(['true','false']).default('false'), UPLOAD_DIR:z.string().default('./uploads'),
  MAX_UPLOAD_BYTES:z.coerce.number().positive().default(5_242_880), NODE_ENV:z.string().default('development'),
  DB_HOST:z.string().default('127.0.0.1'), DB_PORT:z.coerce.number().int().positive().default(3306),
  DB_USER:z.string().min(1), DB_PASSWORD:z.string(), DB_NAME:z.string().regex(/^[a-zA-Z0-9_-]+$/),
  DB_CONNECTION_LIMIT:z.coerce.number().int().positive().default(10),
});
export function config(){
  const c=schema.parse(process.env);
  const credentials=`${encodeURIComponent(c.DB_USER)}:${encodeURIComponent(c.DB_PASSWORD)}`;
  process.env.DATABASE_URL=`mysql://${credentials}@${c.DB_HOST}:${c.DB_PORT}/${c.DB_NAME}?connection_limit=${c.DB_CONNECTION_LIMIT}`;
  return {...c,COOKIE_SECURE:c.COOKIE_SECURE==='true',UPLOAD_DIR:path.resolve(c.UPLOAD_DIR)};
}
