import pino from 'pino';
import { randomUUID } from 'crypto';

export const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export function createContext(ctx = {}) {
  return { requestId: randomUUID(), ...ctx };
}

export function withContext(baseLogger, ctx = {}) {
  return baseLogger.child(ctx);
}

export default logger;

