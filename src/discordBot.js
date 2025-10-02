/**
 * Discord bot command layer que registra slash commands, formata respostas e integra
 * recursos recentes como o resumo `/binance`, configurações de lucro mínimo e
 * gráficos com previsões/alertas enriquecidos.
 */
import { Client, GatewayIntentBits, ApplicationCommandOptionType } from "discord.js";
import { CFG } from "./config.js";
import { logger, withContext } from "./logger.js";
import { ASSETS, TIMEFRAMES, BINANCE_INTERVALS } from "./assets.js";
import { fetchOHLCV } from "./data/binance.js";
import { renderChartPNG } from "./chart.js";
import { addAssetToWatch, removeAssetFromWatch, getWatchlist as loadWatchlist } from "./watchlist.js";
import { setSetting } from "./settings.js";
import {
    getMinimumProfitSettings,
    setDefaultMinimumProfit,
    setPersonalMinimumProfit,
} from "./minimumProfit.js";
import { getAccountOverview } from "./trading/binance.js";


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

const amountFormatter = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
const quantityFormatter = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 8 });
const priceFormatter = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MAX_LIST_ITEMS = {
    assets: 5,
    spotBalances: 6,
    marginAssets: 6,
    marginPositions: 5,
};

const MIN_PROFIT_PERCENT_MIN = 0;
const MIN_PROFIT_PERCENT_MAX = 100;

const COMMAND_BLUEPRINTS = [
    {
        name: "chart",
        description: "Exibe um gráfico de preços com indicadores técnicos.",
        options: () => [
            {
                name: "ativo",
                description: "Ativo a ser analisado.",
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: ASSETS.map(asset => ({ name: asset.key, value: asset.key }))
            },
            {
                name: "tf",
                description: "Timeframe desejado.",
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: TIMEFRAMES.map(timeframe => ({ name: timeframe, value: timeframe }))
            }
        ],
        helpDetails: ["Retorna uma imagem com candles e indicadores sobrepostos."]
    },
    {
        name: "watch",
        description: "Gerencia sua lista pessoal de ativos monitorados.",
        options: () => [
            {
                name: "add",
                description: "Adiciona um ativo à watchlist pessoal.",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "ativo",
                        description: "Ativo que será incluído na watchlist.",
                        type: ApplicationCommandOptionType.String,
                        required: true,
                        choices: ASSETS.map(asset => ({ name: asset.key, value: asset.key }))
                    }
                ]
            },
            {
                name: "remove",
                description: "Remove um ativo da watchlist pessoal.",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "ativo",
                        description: "Ativo que será removido da watchlist.",
                        type: ApplicationCommandOptionType.String,
                        required: true,
                        choices: ASSETS.map(asset => ({ name: asset.key, value: asset.key }))
                    }
                ]
            }
        ],
        helpDetails: ["Utilize os subcomandos add/remove para manter a sua lista personalizada."]
    },
    {
        name: "status",
        description: "Mostra o uptime do bot e os ativos monitorados pelo usuário.",
        helpDetails: ["Útil para confirmar se o bot está rodando e quais ativos estão na sua watchlist."]
    },
    {
        name: "analysis",
        description: "Executa uma análise técnica resumida para um ativo e timeframe.",
        options: () => [
            {
                name: "ativo",
                description: "Ativo a ser analisado.",
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: ASSETS.map(asset => ({ name: asset.key, value: asset.key }))
            },
            {
                name: "tf",
                description: "Timeframe desejado para a análise.",
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: TIMEFRAMES.map(timeframe => ({ name: timeframe, value: timeframe }))
            }
        ],
        helpDetails: ["Retorna o mesmo resumo utilizado pelos alertas automáticos."]
    },
    {
        name: "settings",
        description: "Atualiza configurações do bot, como risco e lucro mínimo.",
        options: () => [
            {
                name: "risk",
                description: "Configurações de risco por trade.",
                type: ApplicationCommandOptionType.SubcommandGroup,
                options: [
                    {
                        name: "percent",
                        description: "Define o risco por trade (0 a 5%).",
                        type: ApplicationCommandOptionType.Subcommand,
                        options: [
                            {
                                name: "value",
                                description: "Percentual de risco permitido (0 a 5).",
                                type: ApplicationCommandOptionType.Number,
                                required: true
                            }
                        ]
                    }
                ]
            },
            {
                name: "profit",
                description: "Configurações de lucro mínimo das análises.",
                type: ApplicationCommandOptionType.SubcommandGroup,
                options: [
                    {
                        name: "view",
                        description: "Mostra os valores configurados de lucro mínimo.",
                        type: ApplicationCommandOptionType.Subcommand
                    },
                    {
                        name: "default",
                        description: "Define o lucro mínimo padrão (0 a 100%).",
                        type: ApplicationCommandOptionType.Subcommand,
                        options: [
                            {
                                name: "value",
                                description: "Percentual de lucro mínimo global (0 a 100).",
                                type: ApplicationCommandOptionType.Number,
                                required: true
                            }
                        ]
                    },
                    {
                        name: "personal",
                        description: "Define o seu lucro mínimo pessoal (0 a 100%).",
                        type: ApplicationCommandOptionType.Subcommand,
                        options: [
                            {
                                name: "value",
                                description: "Percentual de lucro mínimo pessoal (0 a 100).",
                                type: ApplicationCommandOptionType.Number,
                                required: true
                            }
                        ]
                    }
                ]
            }
        ],
        helpDetails: [
            "Combine subcomandos para ajustar risco ou personalizar o lucro mínimo aplicado nas análises."
        ]
    },
    {
        name: "binance",
        description: "Mostra saldos, posições e métricas da conta Binance configurada.",
        enabled: () => CFG.enableBinanceCommand,
        helpDetails: ["Disponível apenas quando as credenciais e a flag enableBinanceCommand estão ativas."]
    },
    {
        name: "help",
        description: "Lista os comandos disponíveis e seus objetivos.",
        helpDetails: ["Inclui subcomandos e argumentos obrigatórios para facilitar o uso diário."]
    }
];

function resolveCommandBlueprints() {
    return COMMAND_BLUEPRINTS.map(blueprint => {
        const options = typeof blueprint.options === "function" ? blueprint.options() : blueprint.options;
        return {
            ...blueprint,
            options
        };
    });
}

function getAvailableCommandBlueprints() {
    return resolveCommandBlueprints().filter(blueprint => !blueprint.enabled || blueprint.enabled());
}

function buildSlashCommands() {
    return getAvailableCommandBlueprints().map(({ enabled, helpDetails, ...command }) => command);
}

function buildOptionHelpLines(options = [], depth = 1) {
    if (!Array.isArray(options) || options.length === 0) return [];
    const indent = "    ".repeat(depth);
    const lines = [];
    for (const option of options) {
        if (option.type === ApplicationCommandOptionType.SubcommandGroup) {
            lines.push(`${indent}• Grupo ${option.name} — ${option.description}`);
            lines.push(...buildOptionHelpLines(option.options, depth + 1));
        } else if (option.type === ApplicationCommandOptionType.Subcommand) {
            lines.push(`${indent}• Subcomando ${option.name} — ${option.description}`);
            lines.push(...buildOptionHelpLines(option.options, depth + 1));
        } else {
            const requirement = option.required ? " (obrigatório)" : "";
            lines.push(`${indent}• ${option.name}${requirement} — ${option.description}`);
        }
    }
    return lines;
}

function buildHelpMessage() {
    const sections = getAvailableCommandBlueprints().map(command => {
        const header = `• /${command.name} — ${command.description}`;
        const extra = Array.isArray(command.helpDetails) ? command.helpDetails.map(detail => `    ${detail}`) : [];
        const optionLines = buildOptionHelpLines(command.options, 1);
        const lines = [header, ...extra, ...optionLines];
        return lines.join("\n");
    });
    return sections.join("\n\n");
}

function formatAmount(value, formatter = amountFormatter) {
    return Number.isFinite(value) ? formatter.format(value) : '0,00';
}

function formatPercentDisplay(value) {
    return value % 1 === 0 ? value.toFixed(0) : value.toFixed(2);
}

function appendOverflowLine(lines, total, max, labelSingular, labelPlural) {
    if (total > max) {
        const remaining = total - max;
        const noun = remaining === 1 ? labelSingular : labelPlural;
        lines.push(`• ... e mais ${remaining} ${noun}`);
    }
}

function formatAccountAssets(assets = []) {
    if (!Array.isArray(assets) || assets.length === 0) {
        return 'Sem dados de ativos configurados.';
    }
    const limit = MAX_LIST_ITEMS.assets;
    const lines = assets.slice(0, limit).map(asset => {
        const name = asset.coin ?? asset.asset ?? asset.symbol ?? '—';
        const deposit = asset.depositAllEnable === false ? '❌' : '✅';
        const withdraw = asset.withdrawAllEnable === false ? '❌' : '✅';
        return `• ${name}: Depósito ${deposit} | Saque ${withdraw}`;
    });
    appendOverflowLine(lines, assets.length, limit, 'ativo', 'ativos');
    return lines.join('\n');
}

function formatSpotBalances(balances = []) {
    if (!Array.isArray(balances) || balances.length === 0) {
        return 'Sem saldos spot disponíveis.';
    }
    const limit = MAX_LIST_ITEMS.spotBalances;
    const lines = balances.slice(0, limit).map(balance => {
        const total = formatAmount(balance.total);
        const free = formatAmount(balance.free);
        const locked = formatAmount(balance.locked);
        return `• ${balance.asset}: ${total} (Livre ${free} | Travado ${locked})`;
    });
    appendOverflowLine(lines, balances.length, limit, 'saldo', 'saldos');
    return lines.join('\n');
}

function formatMarginAccount(account) {
    if (!account) {
        return 'Sem dados da conta de margem.';
    }
    const parts = [];
    if (Number.isFinite(account.totalNetAssetOfBtc)) {
        parts.push(`• Patrimônio líquido: ${formatAmount(account.totalNetAssetOfBtc, quantityFormatter)} BTC`);
    }
    if (Number.isFinite(account.totalAssetOfBtc) || Number.isFinite(account.totalLiabilityOfBtc)) {
        const assets = formatAmount(account.totalAssetOfBtc, quantityFormatter);
        const liabilities = formatAmount(account.totalLiabilityOfBtc, quantityFormatter);
        parts.push(`• Ativos: ${assets} BTC | Passivos: ${liabilities} BTC`);
    }
    if (Number.isFinite(account.marginLevel) && account.marginLevel > 0) {
        const marginLevel = formatAmount(account.marginLevel, amountFormatter);
        parts.push(`• Nível de margem: ${marginLevel}x`);
    }
    return parts.length ? parts.join('\n') : 'Sem dados da conta de margem.';
}

function formatMarginAssets(userAssets = []) {
    if (!Array.isArray(userAssets) || userAssets.length === 0) {
        return 'Sem ativos na conta de margem.';
    }
    const limit = MAX_LIST_ITEMS.marginAssets;
    const lines = userAssets.slice(0, limit).map(asset => {
        const free = formatAmount(asset.free);
        const borrowed = formatAmount(asset.borrowed);
        const interest = formatAmount(asset.interest);
        const net = formatAmount(asset.netAsset);
        return `• ${asset.asset}: Livre ${free} | Empréstimo ${borrowed} | Juros ${interest} | Líquido ${net}`;
    });
    appendOverflowLine(lines, userAssets.length, limit, 'ativo', 'ativos');
    return lines.join('\n');
}

function formatMarginPositions(positions = []) {
    if (!Array.isArray(positions) || positions.length === 0) {
        return 'Sem posições de margem abertas.';
    }
    const limit = MAX_LIST_ITEMS.marginPositions;
    const lines = positions.slice(0, limit).map(position => {
        const qty = formatAmount(position.positionAmt, quantityFormatter);
        const entry = formatAmount(position.entryPrice, priceFormatter);
        const mark = formatAmount(position.markPrice, priceFormatter);
        const pnl = formatAmount(position.unrealizedProfit, priceFormatter);
        const liq = Number.isFinite(position.liquidationPrice) ? ` | Liq.: ${formatAmount(position.liquidationPrice, priceFormatter)}` : '';
        return `• ${position.symbol} (${position.marginType})\n  Qtde: ${qty} | Entrada: ${entry} | Marca: ${mark} | PnL: ${pnl}${liq}`;
    });
    appendOverflowLine(lines, positions.length, limit, 'posição', 'posições');
    return lines.join('\n');
}

function buildAccountOverviewMessage(overview) {
    const sections = [
        { title: '**Ativos Configurados**', body: formatAccountAssets(overview?.assets) },
        { title: '**Saldos Spot**', body: formatSpotBalances(overview?.spotBalances) },
        { title: '**Conta de Margem**', body: formatMarginAccount(overview?.marginAccount) },
        { title: '**Ativos na Margem**', body: formatMarginAssets(overview?.marginAccount?.userAssets) },
        { title: '**Posições de Margem**', body: formatMarginPositions(overview?.marginPositions) }
    ];
    return sections.map(section => `${section.title}\n${section.body}`).join('\n\n');
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

/**
 * Handles Discord slash command interactions for charts, watchlists and analysis.
 * @param {Object} interaction - Discord interaction payload.
 * @returns {Promise} Resolves once the interaction response is handled.
 */
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
    } else if (interaction.commandName === 'binance') {
        if (!CFG.enableBinanceCommand) {
            if (typeof interaction.reply === 'function') {
                await interaction.reply({
                    content: 'O comando Binance está desativado neste servidor.',
                    ephemeral: true,
                });
            }
            return;
        }
        await interaction.deferReply({ ephemeral: true });
        const log = withContext(logger, { command: 'binance' });
        try {
            const overview = await getAccountOverview();
            const content = buildAccountOverviewMessage(overview);
            await interaction.editReply(content);
        } catch (err) {
            log.error({ fn: 'handleInteraction', err }, 'Failed to load Binance account data');
            const message = err?.message?.includes('Missing Binance API credentials')
                ? 'Credenciais da Binance não configuradas.'
                : 'Não foi possível carregar dados da Binance no momento.';
            await interaction.editReply(message);
        }
    } else if (interaction.commandName === 'help') {
        const content = buildHelpMessage();
        await interaction.reply({ content, ephemeral: true });
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
        } else if (group === 'profit') {
            if (sub === 'view') {
                const settings = getMinimumProfitSettings();
                const userId = interaction.user?.id ?? null;
                const personalRatio = userId && settings.users[userId] !== undefined
                    ? settings.users[userId]
                    : null;
                const appliedRatio = personalRatio !== null ? personalRatio : settings.default;
                const defaultPercent = formatPercentDisplay(settings.default * 100);
                const appliedPercent = formatPercentDisplay(appliedRatio * 100);
                let personalLine;
                if (personalRatio === null) {
                    personalLine = 'Seu lucro mínimo: usando o padrão do servidor';
                } else {
                    const personalPercent = formatPercentDisplay(personalRatio * 100);
                    personalLine = `Seu lucro mínimo: ${personalPercent}%`;
                }
                const lines = [
                    `Lucro mínimo padrão: ${defaultPercent}%`,
                    personalLine,
                    `Valor aplicado nas análises: ${appliedPercent}%`,
                ];
                await interaction.reply({ content: lines.join('\n'), ephemeral: true });
                return;
            }

            if (sub !== 'default' && sub !== 'personal') {
                await interaction.reply({ content: 'Configuração não suportada.', ephemeral: true });
                return;
            }
            const percent = interaction.options.getNumber('value', true);
            if (!Number.isFinite(percent) || percent < MIN_PROFIT_PERCENT_MIN || percent > MIN_PROFIT_PERCENT_MAX) {
                await interaction.reply({
                    content: `Informe um percentual entre ${MIN_PROFIT_PERCENT_MIN} e ${MIN_PROFIT_PERCENT_MAX}.`,
                    ephemeral: true,
                });
                return;
            }
            const decimal = percent / 100;
            const formatted = formatPercentDisplay(percent);
            const log = withContext(logger, { command: 'settings', group, sub });
            try {
                if (sub === 'default') {
                    setDefaultMinimumProfit(decimal);
                    await interaction.reply({
                        content: `Lucro mínimo padrão atualizado para ${formatted}%`,
                        ephemeral: true,
                    });
                } else {
                    const userId = interaction.user?.id;
                    if (!userId) {
                        await interaction.reply({ content: 'Não foi possível identificar o usuário.', ephemeral: true });
                        return;
                    }
                    setPersonalMinimumProfit(userId, decimal);
                    await interaction.reply({
                        content: `Lucro mínimo pessoal atualizado para ${formatted}%`,
                        ephemeral: true,
                    });
                }
            } catch (err) {
                log.error({ fn: 'handleInteraction', err }, 'Failed to update profit settings');
                await interaction.reply({ content: 'Não foi possível atualizar o lucro mínimo no momento.', ephemeral: true });
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
            const commands = buildSlashCommands();
            await client.application.commands.set(commands);
            client.on('interactionCreate', handleInteraction);
            return client;
        });
        client.on('error', e => withContext(logger).error({ fn: 'getClient', err: e }, 'Discord client error'));
    }
    return clientPromise;
}

/**
 * Uploads chart image files to the configured Discord channel.
 * @param {string[]|string} files - Paths to chart images to upload.
 * @returns {Promise} True when the upload succeeds.
 */
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

/**
 * Initializes the Discord bot client and registers optional command handlers.
 * @param {Object} [options={}] - Hook used to satisfy analysis slash commands.
 * @param {Function} [options.onAnalysis] - Callback executed when the analysis command runs.
 * @returns {Promise} Shared Discord client promise.
 */
export function initBot(options = {}) {
    analysisCommandHandler = options.onAnalysis ?? analysisCommandHandler;
    return getClient();
}

