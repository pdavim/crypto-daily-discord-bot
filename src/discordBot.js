import { Client, GatewayIntentBits, ApplicationCommandOptionType } from 'discord.js';
import { CFG } from './config.js';
import { logger, withContext } from './logger.js';
import { ASSETS, TIMEFRAMES, BINANCE_INTERVALS } from './assets.js';
import { fetchOHLCV } from './data/binance.js';
import { renderChartPNG } from './chart.js';
import { addAssetToWatch, removeAssetFromWatch, getWatchlist as loadWatchlist } from './watchlist.js';
import { setSetting } from './settings.js';

const startTime = Date.now();

function getWatchlist(userId) {
    return loadWatchlist(userId);
}

function formatUptime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours || parts.length) parts.push(`${hours}h`);
    if (minutes || parts.length) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);
    return parts.join(' ');
}

let clientPromise;
let analysisCommandHandler;
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

export async function handleInteraction(interaction) {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === 'chart') {
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
            const log = withContext(logger, { asset: assetKey, timeframe: tf });
            log.error({ fn: 'handleInteraction', err: e }, 'Failed to render chart');
            await interaction.editReply('Erro ao gerar gráfico');
        }
    } else if (interaction.commandName === 'watch') {
        const sub = interaction.options.getSubcommand();
        const assetKey = interaction.options.getString('ativo', true).toUpperCase();
        const asset = ASSETS.find(a => a.key === assetKey);
        if (!asset) {
            await interaction.reply({ content: 'Ativo não suportado', ephemeral: true });
            return;
        }
        let msg;
        const userId = interaction.user?.id;
        if (!userId) {
            await interaction.reply({ content: 'Não foi possível identificar o usuário.', ephemeral: true });
            return;
        }
        if (sub === 'add') {
            const added = addAssetToWatch(userId, assetKey);
            msg = added ? `Ativo ${assetKey} adicionado à watchlist` : `Ativo ${assetKey} já estava na watchlist`;
        } else {
            const removed = removeAssetFromWatch(userId, assetKey);
            msg = removed ? `Ativo ${assetKey} removido da watchlist` : `Ativo ${assetKey} não estava na watchlist`;
        }
        await interaction.reply({ content: msg, ephemeral: true });
    } else if (interaction.commandName === 'status') {
        const list = getWatchlist(interaction.user?.id);
        const watchlistText = list.length ? list.join(', ') : 'Nenhum ativo monitorado';
        const uptimeText = formatUptime(Date.now() - startTime);
        const content = `⏱️ Uptime: ${uptimeText}\n👀 Watchlist: ${watchlistText}`;
        await interaction.reply({ content, ephemeral: true });
    } else if (interaction.commandName === 'analysis') {
        const assetKey = interaction.options.getString('ativo', true).toUpperCase();
        const tf = interaction.options.getString('tf', true);
        const asset = ASSETS.find(a => a.key === assetKey);
        if (!asset || !TIMEFRAMES.includes(tf)) {
            await interaction.reply({ content: 'Ativo ou timeframe não suportado', ephemeral: true });
            return;
        }
        await interaction.deferReply({ ephemeral: true });
        const log = withContext(logger, { asset: assetKey, timeframe: tf });
        if (!analysisCommandHandler) {
            await interaction.editReply('Comando de análise indisponível no momento.');
            return;
        }
        try {
            const summary = await analysisCommandHandler({ asset, timeframe: tf });
            if (summary) {
                await interaction.editReply(summary);
            } else {
                await interaction.editReply('Não foi possível gerar o resumo para este ativo.');
            }
        } catch (err) {
            log.error({ fn: 'handleInteraction', err }, 'Failed to run manual analysis');
            await interaction.editReply('Erro ao executar análise. Tente novamente mais tarde.');
        }
    } else if (interaction.commandName === 'settings') {
        const group = interaction.options.getSubcommandGroup(false);
        const sub = interaction.options.getSubcommand(false);
        if (group === 'risk' && sub === 'percent') {
            const percent = interaction.options.getNumber('value', true);
            if (!Number.isFinite(percent) || percent < 0 || percent > 5) {
                await interaction.reply({ content: 'Informe um percentual entre 0 e 5.', ephemeral: true });
                return;
            }
            const decimal = percent / 100;
            const log = withContext(logger, { command: 'settings', group, sub });
            try {
                setSetting('riskPerTrade', decimal);
                CFG.riskPerTrade = decimal;
                const formatted = percent % 1 === 0 ? percent.toFixed(0) : percent.toFixed(2);
                await interaction.reply({ content: `Risco por trade atualizado para ${formatted}%`, ephemeral: true });
            } catch (err) {
                log.error({ fn: 'handleInteraction', err }, 'Failed to update risk settings');
                await interaction.reply({ content: 'Não foi possível atualizar o risco no momento.', ephemeral: true });
            }
        } else {
            await interaction.reply({ content: 'Configuração não suportada.', ephemeral: true });
        }
    }
}

function getClient() {
    const log = withContext(logger);
    if (!CFG.botToken) {
        log.warn({ fn: 'getClient' }, 'Missing bot token; skipping Discord bot');
        return null;
    }
    if (!clientPromise) {
        const client = new Client({ intents: [GatewayIntentBits.Guilds] });
        clientPromise = client.login(CFG.botToken).then(async () => {
            const commands = [
                {
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
                },
                {
                    name: 'watch',
                    description: 'Manage watchlist',
                    options: [
                        {
                            name: 'add',
                            description: 'Add asset to watchlist',
                            type: ApplicationCommandOptionType.Subcommand,
                            options: [
                                {
                                    name: 'ativo',
                                    description: 'Ativo',
                                    type: ApplicationCommandOptionType.String,
                                    required: true,
                                    choices: ASSETS.map(a => ({ name: a.key, value: a.key }))
                                }
                            ]
                        },
                        {
                            name: 'remove',
                            description: 'Remove asset from watchlist',
                            type: ApplicationCommandOptionType.Subcommand,
                            options: [
                                {
                                    name: 'ativo',
                                    description: 'Ativo',
                                    type: ApplicationCommandOptionType.String,
                                    required: true,
                                    choices: ASSETS.map(a => ({ name: a.key, value: a.key }))
                                }
                            ]
                        }
                    ]
                },
                {
                    name: 'status',
                    description: 'Show watchlist and uptime'
                },
                {
                    name: 'analysis',
                    description: 'Executa análise resumida para um ativo',
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
                },
                {
                    name: 'settings',
                    description: 'Atualiza configurações do bot',
                    options: [
                        {
                            name: 'risk',
                            description: 'Configurações de risco',
                            type: ApplicationCommandOptionType.SubcommandGroup,
                            options: [
                                {
                                    name: 'percent',
                                    description: 'Define o risco por trade (0 a 5%)',
                                    type: ApplicationCommandOptionType.Subcommand,
                                    options: [
                                        {
                                            name: 'value',
                                            description: 'Percentual de risco permitido (0 a 5)',
                                            type: ApplicationCommandOptionType.Number,
                                            required: true
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ];
            await client.application.commands.set(commands);
            client.on('interactionCreate', handleInteraction);
            return client;
        });
        client.on('error', e => withContext(logger).error({ fn: 'getClient', err: e }, 'Discord client error'));
    }
    return clientPromise;
}

export async function postCharts(files) {
    if (!Array.isArray(files)) files = [files];
    const log = withContext(logger);
    if (!CFG.channelChartsId) {
        log.warn({ fn: 'postCharts' }, 'Missing channel ID; cannot post charts');
        return false;
    }
    const client = await getClient();
    if (!client) return false;
    try {
        const channel = await client.channels.fetch(CFG.channelChartsId);
        await channel.send({ files });
        return true;
    } catch (e) {
        log.error({ fn: 'postCharts', err: e }, 'Failed to post charts to Discord');
        return false;
    }
}

export function initBot(options = {}) {
    analysisCommandHandler = options.onAnalysis ?? analysisCommandHandler;
    return getClient();
}

