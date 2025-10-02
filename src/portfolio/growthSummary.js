import path from "node:path";

const DEFAULT_LOCALE = "pt-PT";
const CURRENCY = "EUR";

const buildFormatter = (locale, options, fallback) => {
    try {
        return new Intl.NumberFormat(locale, options);
    } catch (_) {
        const fallbackLocale = typeof fallback === "string" && fallback.trim() !== "" ? fallback : "en-US";
        return new Intl.NumberFormat(fallbackLocale, options);
    }
};

const formatCurrency = (value, { locale = DEFAULT_LOCALE } = {}) => {
    const formatter = buildFormatter(locale, {
        style: "currency",
        currency: CURRENCY,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    if (!Number.isFinite(value)) {
        return formatter.format(0);
    }
    return formatter.format(value);
};

const formatPercent = (value, { locale = DEFAULT_LOCALE, minimumFractionDigits = 2, maximumFractionDigits = 2 } = {}) => {
    const formatter = buildFormatter(locale, {
        style: "percent",
        minimumFractionDigits,
        maximumFractionDigits,
    });
    if (!Number.isFinite(value)) {
        return formatter.format(0);
    }
    return formatter.format(value);
};

const formatNumber = (value, { locale = DEFAULT_LOCALE, minimumFractionDigits = 0, maximumFractionDigits = 2 } = {}) => {
    const formatter = buildFormatter(locale, {
        minimumFractionDigits,
        maximumFractionDigits,
    });
    if (!Number.isFinite(value)) {
        return formatter.format(0);
    }
    return formatter.format(value);
};

const formatDate = (value, { locale = DEFAULT_LOCALE } = {}) => {
    if (!value) {
        return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return null;
    }
    try {
        const formatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
        return formatter.format(date);
    } catch (_) {
        const formatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
        return formatter.format(date);
    }
};

const formatYears = (value, { locale = DEFAULT_LOCALE } = {}) => {
    if (!Number.isFinite(value) || value <= 0) {
        return null;
    }
    const formatter = buildFormatter(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return `${formatter.format(value)} anos`;
};

const sanitizeMention = (mention) => {
    if (typeof mention !== "string") {
        return "";
    }
    const trimmed = mention.trim();
    if (trimmed === "@here" || trimmed === "@everyone" || /^<@&\d+>$/.test(trimmed) || /^<@!\d+>$/.test(trimmed)) {
        return trimmed;
    }
    return trimmed;
};

const formatReportsLine = ({ summary, includeReportLinks, locale }) => {
    if (!includeReportLinks) {
        return null;
    }
    const reportPaths = [];
    const summaryPath = summary?.reports?.summaryPath;
    const chartPath = summary?.reports?.chartPath;
    if (typeof summaryPath === "string" && summaryPath.trim() !== "") {
        reportPaths.push(path.relative(process.cwd(), summaryPath));
    }
    if (typeof chartPath === "string" && chartPath.trim() !== "") {
        reportPaths.push(path.relative(process.cwd(), chartPath));
    }
    if (reportPaths.length === 0) {
        return null;
    }
    const formatter = buildFormatter(locale, { style: "percent", minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const progressPct = Number.isFinite(summary?.progress?.pct)
        ? formatPercent(summary.progress.pct, { locale, minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : formatter.format(0);
    return `- Relatórios salvos (${progressPct} da meta): ${reportPaths.map(entry => `\`${entry}\``).join(", ")}`;
};

const MAX_DIGEST_ASSETS = 5;
const MAX_TRADES_PER_ATTACHMENT = 1000;

const buildTradeAggregates = (trades) => {
    const aggregates = new Map();
    for (const trade of trades) {
        const asset = typeof trade?.asset === "string" ? trade.asset.toUpperCase() : null;
        const action = typeof trade?.action === "string" ? trade.action.toUpperCase() : null;
        const quantity = Number(trade?.quantity);
        const price = Number(trade?.price);
        const notional = Number.isFinite(quantity) && Number.isFinite(price) ? quantity * price : 0;
        if (!asset || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0 || (action !== "BUY" && action !== "SELL")) {
            continue;
        }
        const entry = aggregates.get(asset) ?? {
            asset,
            buyCount: 0,
            buyQty: 0,
            buyNotional: 0,
            sellCount: 0,
            sellQty: 0,
            sellNotional: 0,
        };
        if (action === "BUY") {
            entry.buyCount += 1;
            entry.buyQty += quantity;
            entry.buyNotional += notional;
        } else {
            entry.sellCount += 1;
            entry.sellQty += quantity;
            entry.sellNotional += notional;
        }
        aggregates.set(asset, entry);
    }
    return Array.from(aggregates.values()).map((entry) => ({
        ...entry,
        netQty: entry.buyQty - entry.sellQty,
        netNotional: entry.buyNotional - entry.sellNotional,
        totalNotional: entry.buyNotional + entry.sellNotional,
    }));
};

const buildTradeDigest = ({ trades, locale }) => {
    if (!Array.isArray(trades) || trades.length === 0) {
        return null;
    }
    const aggregates = buildTradeAggregates(trades)
        .sort((a, b) => b.totalNotional - a.totalNotional || b.buyCount + b.sellCount - (a.buyCount + a.sellCount));
    if (aggregates.length === 0) {
        return null;
    }
    const formatterQty = (value) => formatNumber(value, {
        locale,
        minimumFractionDigits: 0,
        maximumFractionDigits: 4,
    });
    const topAggregates = aggregates.slice(0, MAX_DIGEST_ASSETS);
    const digestParts = topAggregates.map((entry) => {
        const segments = [];
        if (entry.buyCount > 0) {
            segments.push(`B${entry.buyCount}=${formatterQty(entry.buyQty)}`);
        }
        if (entry.sellCount > 0) {
            segments.push(`S${entry.sellCount}=${formatterQty(entry.sellQty)}`);
        }
        if (segments.length === 0) {
            segments.push("sem trades");
        }
        const net = entry.netQty;
        const netLabel = Number.isFinite(net) && net !== 0
            ? `Δ ${net > 0 ? "+" : ""}${formatterQty(net)}`
            : "Δ 0";
        segments.push(netLabel);
        return `${entry.asset}: ${segments.join(" · ")}`;
    });
    const remaining = aggregates.length - topAggregates.length;
    if (remaining > 0) {
        digestParts.push(`+${remaining} ativos`);
    }
    return digestParts.join(" | ");
};

const sanitizeRunId = (runAt) => {
    const base = typeof runAt === "string" && runAt.trim() !== ""
        ? runAt
        : new Date().toISOString();
    return base.replace(/[^a-z0-9]+/gi, "-").replace(/-+/g, "-");
};

const chunkTrades = (trades) => {
    if (!Array.isArray(trades) || trades.length === 0) {
        return [];
    }
    const chunks = [];
    for (let idx = 0; idx < trades.length; idx += MAX_TRADES_PER_ATTACHMENT) {
        chunks.push(trades.slice(idx, idx + MAX_TRADES_PER_ATTACHMENT));
    }
    return chunks;
};

const formatCsvLine = (trade) => {
    const timestamp = typeof trade?.timestamp === "string" ? trade.timestamp : "";
    const asset = typeof trade?.asset === "string" ? trade.asset.toUpperCase() : "";
    const action = typeof trade?.action === "string" ? trade.action.toUpperCase() : "";
    const quantity = Number(trade?.quantity);
    const price = Number(trade?.price);
    const value = Number(trade?.value);
    const reason = typeof trade?.reason === "string" ? trade.reason : "";
    const formatDecimal = (input, fractionDigits) => {
        if (!Number.isFinite(input)) {
            return "0";
        }
        return input.toFixed(fractionDigits);
    };
    return [
        timestamp,
        asset,
        action,
        formatDecimal(quantity, 8),
        formatDecimal(price, 2),
        formatDecimal(value, 2),
        reason,
    ].join(",");
};

const buildTradeAttachments = ({ trades, runAt }) => {
    if (!Array.isArray(trades) || trades.length === 0) {
        return [];
    }
    const chunks = chunkTrades(trades);
    const runId = sanitizeRunId(runAt);
    const attachments = [];
    chunks.forEach((chunk, index) => {
        const suffix = chunks.length > 1 ? `-${index + 1}` : "";
        const csvLines = ["timestamp,asset,side,quantity,price,notional,reason", ...chunk.map(formatCsvLine)];
        const csvContent = csvLines.join("\n");
        const csvBuffer = Buffer.from(csvContent, "utf8");
        attachments.push({
            filename: `portfolio-trades-${runId}${suffix}.csv`,
            contentType: "text/csv",
            content: csvBuffer,
            size: csvBuffer.length,
        });
        const jsonContent = JSON.stringify(chunk, null, 2);
        const jsonBuffer = Buffer.from(jsonContent, "utf8");
        attachments.push({
            filename: `portfolio-trades-${runId}${suffix}.json`,
            contentType: "application/json",
            content: jsonBuffer,
            size: jsonBuffer.length,
        });
    });
    return attachments;
};

/**
 * Builds a Discord-friendly summary message describing the current state of the 100€ → 10M€ simulation.
 * @param {Object} params - Message builder parameters.
 * @param {Object} params.summary - Result returned by the portfolio growth simulation.
 * @param {string} [params.mention] - Optional mention ("@here", role id, etc.).
 * @param {string} [params.locale] - Locale used to format numeric values.
 * @param {boolean} [params.includeReportLinks=true] - When true, append local report paths to the message.
 * @returns {string} Discord message body.
 */
export function buildPortfolioGrowthDiscordMessage({
    summary,
    mention = "",
    locale = DEFAULT_LOCALE,
    includeReportLinks = true,
} = {}) {
    if (!summary || typeof summary !== "object") {
        return { message: "", attachments: [] };
    }

    const safeLocale = typeof locale === "string" && locale.trim() !== "" ? locale : DEFAULT_LOCALE;
    const lines = [];
    const sanitizedMention = sanitizeMention(mention);
    if (sanitizedMention) {
        lines.push(sanitizedMention);
    }

    const strategyName = typeof summary.strategy === "string" && summary.strategy.trim() !== ""
        ? summary.strategy.trim()
        : "Default";
    lines.push(`**Simulação 100€ → 10M€ · ${strategyName}**`);

    const finalValue = Number(summary.finalValue) || 0;
    const totalReturnPct = Number(summary.metrics?.totalReturnPct) || 0;
    const cagr = Number(summary.metrics?.cagr) || 0;
    lines.push(`- Valor atual: ${formatCurrency(finalValue, { locale: safeLocale })} (${formatPercent(totalReturnPct, { locale: safeLocale })} total | CAGR ${formatPercent(cagr, { locale: safeLocale })})`);

    const investedCapital = Number(summary.investedCapital) || 0;
    const contributionsTotal = Number(summary.contributionsTotal) || 0;
    const contributionsCount = Number.isFinite(summary.contributionsCount) ? summary.contributionsCount : 0;
    lines.push(`- Capital investido: ${formatCurrency(investedCapital, { locale: safeLocale })} (aportes ${formatCurrency(contributionsTotal, { locale: safeLocale })} em ${formatNumber(contributionsCount, { locale: safeLocale, minimumFractionDigits: 0, maximumFractionDigits: 0 })} contribuições)`);

    const targetCapital = Number(summary.targetCapital) || 0;
    const progressPct = Number(summary.progress?.pct) || 0;
    if (summary.targetReached && summary.targetReachedAt) {
        const reachedDate = formatDate(summary.targetReachedAt, { locale: safeLocale });
        lines.push(`- Meta atingida: ${formatCurrency(targetCapital, { locale: safeLocale })} em ${reachedDate ?? summary.targetReachedAt}`);
    } else {
        const remaining = Math.max(0, targetCapital - finalValue);
        const remainingStr = formatCurrency(remaining, { locale: safeLocale });
        const progressStr = formatPercent(progressPct, { locale: safeLocale });
        const estimatedYears = formatYears(summary.progress?.estimatedYearsToTarget, { locale: safeLocale });
        const estimateSuffix = estimatedYears ? ` · projeção ${estimatedYears}` : "";
        lines.push(`- Meta: ${formatCurrency(targetCapital, { locale: safeLocale })} · progresso ${progressStr} · falta ${remainingStr}${estimateSuffix}`);
    }

    const maxDrawdown = Number(summary.metrics?.maxDrawdownPct) || 0;
    const volatility = Number(summary.metrics?.annualizedVolatility) || 0;
    const sharpeRatio = Number(summary.metrics?.sharpeRatio) || 0;
    lines.push(`- Risco: drawdown máx ${formatPercent(maxDrawdown, { locale: safeLocale })} · vol anual ${formatPercent(volatility, { locale: safeLocale })} · Sharpe ${formatNumber(sharpeRatio, { locale: safeLocale, minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

    const durationDays = Number(summary.metrics?.durationDays) || 0;
    const yearsElapsed = durationDays > 0 ? durationDays / 365 : 0;
    if (yearsElapsed > 0) {
        lines.push(`- Janela analisada: ${formatNumber(yearsElapsed, { locale: safeLocale, minimumFractionDigits: 1, maximumFractionDigits: 1 })} anos (${formatNumber(durationDays, { locale: safeLocale, minimumFractionDigits: 0, maximumFractionDigits: 0 })} dias)`);
    }

    const trades = Array.isArray(summary.trades) ? summary.trades : [];
    const tradeDigest = buildTradeDigest({ trades, locale: safeLocale });
    if (tradeDigest) {
        const tradeCount = formatNumber(trades.length, {
            locale: safeLocale,
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        });
        lines.push(`- Trades (${tradeCount} ordens): ${tradeDigest}`);
    }

    const reportsLine = formatReportsLine({ summary, includeReportLinks, locale: safeLocale });
    if (reportsLine) {
        lines.push(reportsLine);
    }

    const attachments = buildTradeAttachments({ trades, runAt: summary.runAt });
    if (attachments.length > 0) {
        lines.push(`- Diário de trades anexado (${attachments.length} arquivo${attachments.length > 1 ? "s" : ""}).`);
    }

    return {
        message: lines.join("\n"),
        attachments,
    };
}

export const __testUtils = {
    formatCurrency,
    formatPercent,
    formatNumber,
    formatDate,
    formatYears,
    buildTradeDigest,
    buildTradeAttachments,
};
