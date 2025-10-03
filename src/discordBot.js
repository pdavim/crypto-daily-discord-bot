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
import { getAccountOverview, submitOrder } from "./trading/binance.js";
import { openPosition, adjustMargin } from "./trading/executor.js";


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

const DISCORD_MESSAGE_LIMIT = 2000;

const MAX_LIST_ITEMS = {
    assets: 5,
    spotBalances: 6,
    marginAssets: 6,
    marginPositions: 5,
};

const MIN_PROFIT_PERCENT_MIN = 0;
const MIN_PROFIT_PERCENT_MAX = 100;

function toFiniteNumber(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function getTradingConfig() {
    return typeof CFG.trading === "object" && CFG.trading !== null ? CFG.trading : { enabled: false };
}

function computeMaxNotionalLimit(tradingCfg) {
    const equity = toFiniteNumber(CFG.accountEquity);
    const maxPct = toFiniteNumber(tradingCfg.maxPositionPct);
    const leverage = toFiniteNumber(tradingCfg.maxLeverage) ?? 1;
    if (equity === null || equity <= 0 || maxPct === null || maxPct <= 0) {
        return null;
    }
    const lev = leverage !== null && leverage > 0 ? leverage : 1;
    return equity * maxPct * lev;
}

function formatQuantity(value) {
    return Number.isFinite(value) ? quantityFormatter.format(value) : "—";
}

function formatPrice(value) {
    return Number.isFinite(value) ? priceFormatter.format(value) : "—";
}

function resolveTradeAbortMessage(reason, details = {}) {
    switch (reason) {
        case 'disabled':
            return 'Trading está desabilitado na configuração.';
        case 'missingSymbol':
            return 'Símbolo não informado para a operação.';
        case 'invalidQuantity':
            return 'Quantidade inválida para a operação solicitada.';
        case 'invalidPrice':
            return 'Preço inválido informado para a ordem.';
        case 'missingPrice':
            return 'Preço de referência obrigatório para validar o notional mínimo.';
        case 'belowMinNotional': {
            const min = Number.isFinite(details?.minNotional) ? formatAmount(details.minNotional) : undefined;
            const provided = Number.isFinite(details?.notional) ? formatAmount(details.notional) : undefined;
            if (min && provided) {
                return `Valor informado (${provided}) está abaixo do notional mínimo (${min}).`;
            }
            return 'Valor abaixo do notional mínimo configurado.';
        }
        case 'exceedsRiskLimit': {
            const max = Number.isFinite(details?.maxNotional) ? formatAmount(details.maxNotional) : undefined;
            const provided = Number.isFinite(details?.notional) ? formatAmount(details.notional) : undefined;
            if (max && provided) {
                return `Valor informado (${provided}) excede o limite máximo (${max}).`;
            }
            return 'Valor informado excede o limite máximo permitido.';
        }
        default:
            return 'Operação não pôde ser executada pelas salvaguardas configuradas.';
    }
}

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
        name: "trade",
        description: "Envia ordens spot, margin ou futures respeitando os limites configurados.",
        options: () => [
            {
                name: "buy",
                description: "Envia uma ordem de compra para o símbolo informado.",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "symbol",
                        description: "Par de negociação (ex: BTCUSDT).",
                        type: ApplicationCommandOptionType.String,
                        required: true,
                    },
                    {
                        name: "quantity",
                        description: "Quantidade em unidades base.",
                        type: ApplicationCommandOptionType.Number,
                        required: false,
                    },
                    {
                        name: "notional",
                        description: "Valor em moeda cotada para validar limites.",
                        type: ApplicationCommandOptionType.Number,
                        required: false,
                    },
                    {
                        name: "order_type",
                        description: "Tipo de ordem (MARKET ou LIMIT).",
                        type: ApplicationCommandOptionType.String,
                        required: false,
                        choices: [
                            { name: "MARKET", value: "MARKET" },
                            { name: "LIMIT", value: "LIMIT" },
                        ],
                    },
                    {
                        name: "price",
                        description: "Preço para ordens LIMIT ou cálculo de notional.",
                        type: ApplicationCommandOptionType.Number,
                        required: false,
                    },
                    {
                        name: "margin",
                        description: "Ativa fluxo de margem com transfer e borrow automáticos.",
                        type: ApplicationCommandOptionType.Boolean,
                        required: false,
                    },
                    {
                        name: "futures",
                        description: "Ativa execução via openPosition em modo futures.",
                        type: ApplicationCommandOptionType.Boolean,
                        required: false,
                    },
                ]
            },
            {
                name: "sell",
                description: "Envia uma ordem de venda para o símbolo informado.",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "symbol",
                        description: "Par de negociação (ex: BTCUSDT).",
                        type: ApplicationCommandOptionType.String,
                        required: true,
                    },
                    {
                        name: "quantity",
                        description: "Quantidade em unidades base.",
                        type: ApplicationCommandOptionType.Number,
                        required: false,
                    },
                    {
                        name: "notional",
                        description: "Valor em moeda cotada para validar limites.",
                        type: ApplicationCommandOptionType.Number,
                        required: false,
                    },
                    {
                        name: "order_type",
                        description: "Tipo de ordem (MARKET ou LIMIT).",
                        type: ApplicationCommandOptionType.String,
                        required: false,
                        choices: [
                            { name: "MARKET", value: "MARKET" },
                            { name: "LIMIT", value: "LIMIT" },
                        ],
                    },
                    {
                        name: "price",
                        description: "Preço para ordens LIMIT ou cálculo de notional.",
                        type: ApplicationCommandOptionType.Number,
                        required: false,
                    },
                    {
                        name: "margin",
                        description: "Ativa fluxo de margem com transfer e borrow automáticos.",
                        type: ApplicationCommandOptionType.Boolean,
                        required: false,
                    },
                    {
                        name: "futures",
                        description: "Ativa execução via openPosition em modo futures.",
                        type: ApplicationCommandOptionType.Boolean,
                        required: false,
                    },
                ]
            }
        ],
        helpDetails: [
            "Informe quantity e/ou notional para validar limites. O modo margin executa transferências automáticas antes da ordem.",
        ]
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

function splitLinePreservingIndent(line, maxLength) {
    if (!line || line.length <= maxLength) {
        return [line];
    }
    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : "";
    const available = maxLength - indent.length;
    if (available <= 0) {
        return [line];
    }
    const words = line.slice(indent.length).split(" ").filter(Boolean);
    const parts = [];
    let current = "";
    for (const word of words) {
        if (word.length > available) {
            if (current) {
                parts.push(`${indent}${current}`);
                current = "";
            }
            let remaining = word;
            while (remaining.length > available) {
                parts.push(`${indent}${remaining.slice(0, available)}`);
                remaining = remaining.slice(available);
            }
            current = remaining;
            continue;
        }
        const appended = current ? `${current} ${word}` : word;
        if (appended.length > available) {
            if (current) {
                parts.push(`${indent}${current}`);
            }
            current = word;
        } else {
            current = appended;
        }
    }
    if (current) {
        parts.push(`${indent}${current}`);
    }
    return parts;
}

function createChunkBuilder(maxLength = DISCORD_MESSAGE_LIMIT) {
    const chunks = [];
    let currentLines = [];
    let currentLength = 0;

    function flush() {
        if (!currentLines.length) return;
        chunks.push(currentLines.join("\n"));
        currentLines = [];
        currentLength = 0;
    }

    function addLine(line) {
        const safeLine = line ?? "";
        if (safeLine.length > maxLength) {
            const parts = splitLinePreservingIndent(safeLine, maxLength);
            for (const part of parts) {
                addLine(part);
            }
            return;
        }
        if (currentLines.length > 0 && currentLength + 1 + safeLine.length > maxLength) {
            flush();
        }
        currentLines.push(safeLine);
        currentLength = currentLines.length === 1 ? safeLine.length : currentLength + 1 + safeLine.length;
    }

    function addLines(lines = []) {
        for (const line of lines) {
            addLine(line);
        }
    }

    function addBlock(block) {
        if (!block) return;
        addLines(String(block).split("\n"));
    }

    function addBlankLine() {
        if (currentLines.length === 0 && chunks.length === 0) {
            return;
        }
        addLine("");
    }

    function isEmpty() {
        return currentLines.length === 0 && chunks.length === 0;
    }

    function getChunks() {
        flush();
        return chunks.slice();
    }

    return { addLine, addLines, addBlock, addBlankLine, getChunks, isEmpty };
}

function buildOptionHelpLines(options = [], depth = 1, maxChunkLength = DISCORD_MESSAGE_LIMIT) {
    if (!Array.isArray(options) || options.length === 0) return [];
    const indent = "    ".repeat(depth);
    const builder = createChunkBuilder(maxChunkLength);
    for (const option of options) {
        if (!option) continue;
        if (option.type === ApplicationCommandOptionType.SubcommandGroup) {
            builder.addLine(`${indent}• Grupo ${option.name} — ${option.description}`);
            const nestedChunks = buildOptionHelpLines(option.options, depth + 1, maxChunkLength);
            for (const chunk of nestedChunks) {
                builder.addBlock(chunk);
            }
        } else if (option.type === ApplicationCommandOptionType.Subcommand) {
            builder.addLine(`${indent}• Subcomando ${option.name} — ${option.description}`);
            const nestedChunks = buildOptionHelpLines(option.options, depth + 1, maxChunkLength);
            for (const chunk of nestedChunks) {
                builder.addBlock(chunk);
            }
        } else {
            const requirement = option.required ? " (obrigatório)" : "";
            builder.addLine(`${indent}• ${option.name}${requirement} — ${option.description}`);
        }
    }
    return builder.getChunks();
}

export function buildHelpMessage({
    commands = getAvailableCommandBlueprints(),
    maxChunkLength = DISCORD_MESSAGE_LIMIT,
} = {}) {
    const builder = createChunkBuilder(maxChunkLength);
    for (const command of commands) {
        if (!command) continue;
        if (!builder.isEmpty()) {
            builder.addBlankLine();
        }
        builder.addLine(`• /${command.name} — ${command.description}`);
        if (Array.isArray(command.helpDetails)) {
            for (const detail of command.helpDetails) {
                builder.addLine(`    ${detail}`);
            }
        }
        const optionChunks = buildOptionHelpLines(command.options, 1, maxChunkLength);
        for (const chunk of optionChunks) {
            builder.addBlock(chunk);
        }
    }
    return builder.getChunks();
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
export async function handleInteraction(interaction, { helpMessageBuilder = buildHelpMessage } = {}) {
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
    } else if (interaction.commandName === 'trade') {
        const tradingCfg = getTradingConfig();
        if (!tradingCfg.enabled) {
            await interaction.reply({ content: 'Trading está desabilitado na configuração.', ephemeral: true });
            return;
        }

        const sub = interaction.options.getSubcommand();
        const side = sub === 'sell' ? 'SELL' : 'BUY';
        const direction = side === 'SELL' ? 'short' : 'long';
        const rawSymbol = interaction.options.getString('symbol', true);
        const symbol = rawSymbol ? rawSymbol.toUpperCase() : rawSymbol;
        const quantityInput = interaction.options.getNumber('quantity');
        const notionalInput = interaction.options.getNumber('notional');
        const orderTypeRaw = interaction.options.getString('order_type');
        const priceInput = interaction.options.getNumber('price');
        const marginSelected = interaction.options.getBoolean('margin') ?? false;
        const futuresSelected = interaction.options.getBoolean('futures') ?? false;

        if (marginSelected && futuresSelected) {
            await interaction.reply({ content: 'Escolha apenas um modo entre margem e futures.', ephemeral: true });
            return;
        }

        if (!symbol) {
            await interaction.reply({ content: 'Informe um símbolo válido para negociar.', ephemeral: true });
            return;
        }

        const qty = toFiniteNumber(quantityInput);
        const notionalProvided = toFiniteNumber(notionalInput);
        const orderType = (orderTypeRaw ?? 'MARKET').toUpperCase();
        const priceValue = toFiniteNumber(priceInput);

        if (!['MARKET', 'LIMIT'].includes(orderType)) {
            await interaction.reply({ content: 'Tipo de ordem inválido. Utilize MARKET ou LIMIT.', ephemeral: true });
            return;
        }

        if (orderType !== 'MARKET' && (priceValue === null || priceValue <= 0)) {
            await interaction.reply({ content: 'Informe um preço positivo para ordens LIMIT.', ephemeral: true });
            return;
        }

        if (qty !== null && qty <= 0) {
            await interaction.reply({ content: 'Informe uma quantidade positiva.', ephemeral: true });
            return;
        }

        if (notionalProvided !== null && notionalProvided <= 0) {
            await interaction.reply({ content: 'O valor notional deve ser positivo.', ephemeral: true });
            return;
        }

        let derivedQuantity = qty;
        if ((derivedQuantity === null || derivedQuantity <= 0) && notionalProvided !== null && priceValue !== null && priceValue > 0) {
            derivedQuantity = notionalProvided / priceValue;
        }

        if ((marginSelected || futuresSelected) && (derivedQuantity === null || derivedQuantity <= 0)) {
            await interaction.reply({ content: 'Forneça uma quantidade válida para operações de margem ou futures.', ephemeral: true });
            return;
        }

        const referencePrice = priceValue ?? (notionalProvided !== null && derivedQuantity ? notionalProvided / derivedQuantity : null);
        const computedNotional = notionalProvided ?? (derivedQuantity && referencePrice ? derivedQuantity * referencePrice : null);

        if (computedNotional === null || computedNotional <= 0) {
            await interaction.reply({ content: 'Forneça um notional ou preço para validar os limites configurados.', ephemeral: true });
            return;
        }

        const minNotional = toFiniteNumber(tradingCfg.minNotional);
        if (minNotional !== null && minNotional > 0 && computedNotional < minNotional) {
            await interaction.reply({
                content: `Valor informado (${formatAmount(computedNotional)}) está abaixo do notional mínimo (${formatAmount(minNotional)}).`,
                ephemeral: true,
            });
            return;
        }

        const maxNotional = computeMaxNotionalLimit(tradingCfg);
        if (maxNotional !== null && computedNotional > maxNotional) {
            await interaction.reply({
                content: `Valor informado (${formatAmount(computedNotional)}) excede o limite máximo (${formatAmount(maxNotional)}).`,
                ephemeral: true,
            });
            return;
        }

        const params = {};
        if (notionalProvided !== null && (!derivedQuantity || derivedQuantity <= 0)) {
            params.quoteOrderQty = notionalProvided;
        }

        const modeLabel = marginSelected ? 'margin' : futuresSelected ? 'futures' : 'spot';
        const marginNotes = [];

        try {
            let execution;
            if (marginSelected || futuresSelected) {
                const transfer = await adjustMargin({ operation: 'transferIn' });
                if (!transfer?.adjusted) {
                    marginNotes.push(`Transferência ignorada (${transfer?.reason ?? 'motivo desconhecido'})`);
                }
                if (marginSelected && side === 'SELL') {
                    const borrow = await adjustMargin({ operation: 'borrow' });
                    if (!borrow?.adjusted) {
                        marginNotes.push(`Borrow ignorado (${borrow?.reason ?? 'motivo desconhecido'})`);
                    }
                }

                const metadata = referencePrice ? { referencePrice } : {};
                execution = await openPosition({
                    symbol,
                    direction,
                    quantity: derivedQuantity ?? undefined,
                    price: orderType === 'MARKET' ? undefined : priceValue ?? undefined,
                    type: orderType,
                    params: Object.keys(params).length ? params : undefined,
                    metadata,
                });

                if (!execution?.executed) {
                    const reason = execution?.reason ?? 'unknown';
                    const details = execution?.details;
                    const message = resolveTradeAbortMessage(reason, details);
                    await interaction.reply({ content: message, ephemeral: true });
                    return;
                }
            } else {
                const order = await submitOrder({
                    symbol,
                    side,
                    type: orderType,
                    quantity: derivedQuantity ?? undefined,
                    price: orderType === 'MARKET' ? undefined : priceValue ?? undefined,
                    params: Object.keys(params).length ? params : undefined,
                }, { context: { symbol, intent: 'manualTrade', side } });
                execution = { executed: true, order };
            }

            const order = execution?.order ?? {};
            const rawFillPrice = toFiniteNumber(order.fillPrice) ?? toFiniteNumber(order.price) ?? referencePrice;
            const lines = [
                `Operação ${side} ${symbol} confirmada (${orderType} • ${modeLabel}).`,
                `Quantidade: ${formatQuantity(derivedQuantity)}`,
                `Notional: ${formatAmount(computedNotional)}`,
                `Preço: ${formatPrice(rawFillPrice)}`,
            ];
            if (order.orderId) {
                lines.push(`ID da ordem: ${order.orderId}`);
            }
            if (marginNotes.length) {
                lines.push(`Observações: ${marginNotes.join('; ')}`);
            }

            await interaction.reply({ content: lines.join('\n'), ephemeral: true });
        } catch (err) {
            const message = err?.message ? `Falha ao enviar ordem: ${err.message}` : 'Falha ao enviar ordem.';
            await interaction.reply({ content: message, ephemeral: true });
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
        const chunks = helpMessageBuilder();
        if (!Array.isArray(chunks) || chunks.length === 0) {
            await interaction.reply({ content: 'Nenhum comando disponível no momento.', ephemeral: true });
            return;
        }
        const [firstChunk, ...restChunks] = chunks;
        await interaction.reply({ content: firstChunk, ephemeral: true });
        for (const chunk of restChunks) {
            if (!chunk) continue;
            if (typeof interaction.followUp === 'function') {
                // Discord limita mensagens a 2000 caracteres; os chunks já respeitam esse teto.
                // eslint-disable-next-line no-await-in-loop
                await interaction.followUp({ content: chunk, ephemeral: true });
            } else {
                break;
            }
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

