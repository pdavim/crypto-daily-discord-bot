import pg from "pg";
import { registerType as registerVectorType } from "pgvector/pg";
import { CFG, onConfigChange } from "./config.js";
import { logger, withContext } from "./logger.js";

const { Pool } = pg;

let pool;
let activeConnectionString;

const createPool = (connectionString) => {
    const instance = new Pool({ connectionString });
    instance.on("connect", async (client) => {
        const log = withContext(logger);
        try {
            await registerVectorType(client);
        } catch (error) {
            log.warn({ fn: "db.registerVector", err: error }, "Failed to register pgvector type parser for connection.");
        }
    });
    instance.on("error", (error) => {
        const log = withContext(logger);
        log.error({ fn: "db.pool", err: error }, "Unexpected error emitted by Postgres pool.");
    });
    return instance;
};

const recyclePool = async () => {
    if (!pool) {
        return;
    }

    const current = pool;
    pool = undefined;
    activeConnectionString = undefined;
    try {
        await current.end();
    } catch (error) {
        const log = withContext(logger);
        log.warn({ fn: "db.recyclePool", err: error }, "Failed to gracefully close Postgres pool.");
    }
};

const ensurePool = async () => {
    const connectionString = CFG?.rag?.pgUrl;
    if (!connectionString) {
        throw new Error("CFG.rag.pgUrl must be configured before issuing database queries.");
    }

    if (pool && connectionString === activeConnectionString) {
        return pool;
    }

    await recyclePool();

    pool = createPool(connectionString);
    activeConnectionString = connectionString;
    return pool;
};

export const query = async (text, params = []) => {
    const client = await ensurePool();
    return client.query(text, params);
};

export const close = async () => {
    await recyclePool();
};

onConfigChange((nextConfig) => {
    const connectionString = nextConfig?.rag?.pgUrl;
    if (!connectionString) {
        void recyclePool();
        return;
    }

    if (activeConnectionString && connectionString !== activeConnectionString) {
        void recyclePool();
    }
});
