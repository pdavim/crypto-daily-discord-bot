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
const MAX_LOG_SIZE_BYTES = 50 * 1024 * 1024;

function ensureLogsDir() {
  try { fs.mkdirSync(LOGS_DIR, { recursive: true }); } catch (err) {
    console.error('Failed to create logs directory', err);
  }
}

function pruneOldLogs() {
  if (!Number.isFinite(LOG_RETENTION_DAYS) || LOG_RETENTION_DAYS <= 0) return;
  let entries;
  try { entries = fs.readdirSync(LOGS_DIR, { withFileTypes: true }); }
  catch (err) { if (err?.code !== 'ENOENT') console.error('Failed to read logs directory', err); return; }

  const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith('app-') || !entry.name.endsWith('.log')) continue;
    const filePath = join(LOGS_DIR, entry.name);
    try {
      const stats = fs.statSync(filePath);
      if (stats.mtimeMs < cutoff) fs.unlinkSync(filePath);
    } catch (err) {
      console.error('Failed to handle log file', filePath, err);
    }
  }
}

const isTestEnv = process.env.NODE_ENV === 'test';
if (!isTestEnv) { ensureLogsDir(); pruneOldLogs(); }

const NODE_MAJOR_VERSION = Number.parseInt(process.versions?.node?.split?.('.')[0] ?? '0', 10);
const defaultSyncTransport = process.platform === 'win32' || NODE_MAJOR_VERSION >= 22;

const hasCliOnceFlag = process.argv.includes('--once');
const hasExplicitSync = process.env.LOG_SYNC === 'true';
const hasExplicitAsync = process.env.LOG_SYNC === 'false';

const useSyncTransport = hasExplicitAsync
  ? false
  : hasExplicitSync || hasCliOnceFlag || defaultSyncTransport;

let transport;
if (!isTestEnv) {
  try {
    transport = pino.transport({
      target: '@jvddavid/pino-rotating-file',
      options: {
        path: LOGS_DIR,
        pattern: LOG_FILE_PATTERN,
        maxSize: MAX_LOG_SIZE_BYTES,
        mkdir: true,
        append: true,
        sync: useSyncTransport,
        fsync: false,
      },
    });

    if (typeof transport?.on === 'function') {
      transport.on('error', (err) => {
        console.error('Logger transport error; falling back to stdout logging.', err);
      });
    }
  } catch (err) {
    console.error('Failed to initialize rotating-file transport; falling back to stdout logging.', err);
    transport = undefined;
  }
}


// 👇 pass transport as the 2nd argument, not inside options.transport
export const logger = isTestEnv
  ? pino({ level: process.env.LOG_LEVEL || 'info' })
  : pino({ level: process.env.LOG_LEVEL || 'info' }, transport ?? pino.destination({ sync: true }));

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
