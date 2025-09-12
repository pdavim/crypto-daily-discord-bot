import { Client, GatewayIntentBits, ApplicationCommandOptionType } from 'discord.js';
import { CFG } from './config.js';
import { logger } from './logger.js';
import { ASSETS, TIMEFRAMES, BINANCE_INTERVALS } from './assets.js';
import { fetchOHLCV } from './data/binance.js';
import { renderChartPNG } from './chart.js';

let clientPromise;
function tfToInterval(tf) { return BINANCE_INTERVALS[tf] || tf; }

function build45mCandles(candles15m) {
    const out = [];
    for (let i = 0; i + 3 <= candles15m.length; i += 3) {
        const slice = candles15m.slice(i, i + 3);
        out.push({
            t: slice[0].t,
            o: slice[0].o,
            h: Math.max(...slice.map(c => c.h)),
            l: Math.min(...slice.map(c => c.l)),
            c: slice[slice.length - 1].c,
            v: slice.reduce((sum, c) => sum + c.v, 0)
        });
    }
    return out;
}

async function handleInteraction(interaction) {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'chart') return;
    const assetKey = interaction.options.getString('ativo', true).toUpperCase();
    const tf = interaction.options.getString('tf', true);
    const asset = ASSETS.find(a => a.key === assetKey);
    if (!asset || !TIMEFRAMES.includes(tf)) {
        await interaction.reply({ content: 'Ativo ou timeframe não suportado', ephemeral: true });
        return;
    }
    await interaction.deferReply();
    try {
        let candles = await fetchOHLCV(asset.binance, tfToInterval(tf));
        if (tf === '45m') candles = build45mCandles(candles);
        const chartPath = await renderChartPNG(asset.key, tf, candles);
        await interaction.editReply({ files: [chartPath] });
    } catch (e) {
        logger.error({ asset: assetKey, timeframe: tf, fn: 'handleInteraction', err: e }, 'Failed to render chart');
        await interaction.editReply('Erro ao gerar gráfico');
    }
}

function getClient() {
    if (!CFG.botToken) {
        logger.warn({ asset: undefined, timeframe: undefined, fn: 'getClient' }, 'Missing bot token; skipping Discord bot');
        return null;
    }
    if (!clientPromise) {
        const client = new Client({ intents: [GatewayIntentBits.Guilds] });
        clientPromise = client.login(CFG.botToken).then(async () => {
            const commands = [{
                name: 'chart',
                description: 'Show price chart',
                options: [
                    {
                        name: 'ativo',
                        description: 'Ativo',
                        type: ApplicationCommandOptionType.String,
                        required: true,
                        choices: ASSETS.map(a => ({ name: a.key, value: a.key }))
                    },
                    {
                        name: 'tf',
                        description: 'Timeframe',
                        type: ApplicationCommandOptionType.String,
                        required: true,
                        choices: TIMEFRAMES.map(t => ({ name: t, value: t }))
                    }
                ]
            }];
            await client.application.commands.set(commands);
            client.on('interactionCreate', handleInteraction);
            return client;
        });
        client.on('error', e => logger.error({ asset: undefined, timeframe: undefined, fn: 'getClient', err: e }, 'Discord client error'));
    }
    return clientPromise;
}

export async function postCharts(files) {
    if (!Array.isArray(files)) files = [files];
    if (!CFG.channelChartsId) {
        logger.warn({ asset: undefined, timeframe: undefined, fn: 'postCharts' }, 'Missing channel ID; cannot post charts');
        return false;
    }
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

export function initBot() {
    return getClient();
}

