import pino from 'pino';
import { randomUUID } from 'crypto';
import fs from 'fs';
import { join, resolve } from 'path';

const DEFAULT_RETENTION_DAYS = 7;
const LOG_RETENTION_DAYS = Number.isFinite(Number(process.env.LOG_RETENTION_DAYS))
  ? Number(process.env.LOG_RETENTION_DAYS)
  : DEFAULT_RETENTION_DAYS;
const LOGS_DIR = resolve('logs');
const LOG_FILE_PATTERN = 'app-%Y-%M-%d.log';
const MAX_LOG_SIZE_BYTES = 50 * 1024 * 1024; // 50MB cap before size rotation

function ensureLogsDir() {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  } catch (err) {
    console.error('Failed to create logs directory', err);
  }
}

function pruneOldLogs() {
  if (!Number.isFinite(LOG_RETENTION_DAYS) || LOG_RETENTION_DAYS <= 0) {
    return;
  }
  let entries;
  try {
    entries = fs.readdirSync(LOGS_DIR, { withFileTypes: true });
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      console.error('Failed to read logs directory', err);
    }
    return;
  }

  const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith('app-') || !entry.name.endsWith('.log')) {
      continue;
    }
    const filePath = join(LOGS_DIR, entry.name);
    let stats;
    try {
      stats = fs.statSync(filePath);
    } catch (err) {
      console.error('Failed to inspect log file for pruning', filePath, err);
      continue;
    }
    if (stats.mtimeMs < cutoff) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error('Failed to remove expired log file', filePath, err);
      }
    }
  }
}

const isTestEnv = process.env.NODE_ENV === 'test';
if (!isTestEnv) {
  ensureLogsDir();
  pruneOldLogs();
}

const transport = isTestEnv
  ? undefined
  : pino.transport({
      target: '@jvddavid/pino-rotating-file',
      options: {
        path: LOGS_DIR,
        pattern: LOG_FILE_PATTERN,
        maxSize: MAX_LOG_SIZE_BYTES,
        mkdir: true,
        append: true,
        sync: false,
        fsync: false,
      },
    });

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

