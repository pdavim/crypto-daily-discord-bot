import pino from 'pino';
import { randomUUID } from 'crypto';
import fs from 'fs';

const logsDir = 'logs';
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const transport = process.env.NODE_ENV === 'test' ? undefined : {
  target: 'pino-rotating-file-stream',
  options: {
    path: logsDir,
    filename: 'app-%DATE%.log',
    interval: '1d',
    maxFiles: 7,
    teeToStdout: true,
  },
};

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  ...(transport ? { transport } : {}),
});

export function createContext(ctx = {}) {
  const { asset, timeframe, ...rest } = ctx;
  return {
    requestId: randomUUID(),
    ...(asset !== undefined ? { asset } : {}),
    ...(timeframe !== undefined ? { timeframe } : {}),
    ...rest,
  };
}

export function withContext(baseLogger, ctx = {}) {
  const context = ctx?.requestId ? ctx : createContext(ctx);
  return baseLogger.child(context);
}

export default logger;

