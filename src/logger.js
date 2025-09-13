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
  return { requestId: randomUUID(), ...ctx };
}

export function withContext(baseLogger, ctx = {}) {
  return baseLogger.child(ctx);
}

export default logger;

