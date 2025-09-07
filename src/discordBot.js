import { Client, GatewayIntentBits } from 'discord.js';
import { CFG } from './config.js';

let clientPromise;
function getClient() {
    if (!clientPromise) {
        const client = new Client({ intents: [GatewayIntentBits.Guilds] });
        clientPromise = client.login(CFG.botToken).then(() => client);
        client.on('error', e => console.error('Discord client error', e));
    }
    return clientPromise;
}

export async function postCharts(files) {
    if (!Array.isArray(files)) files = [files];
    const client = await getClient();
    const channel = await client.channels.fetch(CFG.channelChartsId);
    await channel.send({ files });
}
