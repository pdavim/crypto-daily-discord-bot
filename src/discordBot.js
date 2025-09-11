import { Client, GatewayIntentBits } from 'discord.js';
import { CFG } from './config.js';
import { logger } from './logger.js';

let clientPromise;
function getClient() {
    if (!CFG.botToken || !CFG.channelChartsId) {
        logger.warn({ asset: undefined, timeframe: undefined, fn: 'getClient' }, 'Missing bot token or channel ID; skipping Discord chart upload');
        return null;
    }
    if (!clientPromise) {
        const client = new Client({ intents: [GatewayIntentBits.Guilds] });
        clientPromise = client.login(CFG.botToken).then(() => client);
        client.on('error', e => logger.error({ asset: undefined, timeframe: undefined, fn: 'getClient', err: e }, 'Discord client error'));
    }
    return clientPromise;
}

export async function postCharts(files) {
    if (!Array.isArray(files)) files = [files];
    const client = await getClient();
    if (!client) return false;
    try {
        const channel = await client.channels.fetch(CFG.channelChartsId);
        await channel.send({ files });
        return true;
    } catch (e) {
        logger.error({ asset: undefined, timeframe: undefined, fn: 'postCharts', err: e }, 'Failed to post charts to Discord');
        return false;
    }
}

