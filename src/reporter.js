export function buildSummary({ assetKey, tf, ohlc, returns, tech, macroNote, verdict }) {
    return [
        `**${assetKey} — ${tf}**`,
        `• OHLC: O ${ohlc.o.toFixed(4)} / H ${ohlc.h.toFixed(4)} / L ${ohlc.l.toFixed(4)} / C ${ohlc.c.toFixed(4)}`,
        `• Volume: ${Intl.NumberFormat().format(ohlc.v)}`,
        `• Returns: 24h ${returns.d1 ?? "—"} · 7d ${returns.d7 ?? "—"} · 30d ${returns.d30 ?? "—"}`,
        `• Técnicos: MA(20/50/200) ${tech.ma} · RSI(14) ${tech.rsi} · MACD ${tech.macd} · BB ${tech.bb} · SAR ${tech.sar} · VolDiv ${tech.vdiv ?? "—"}`,
        macroNote ? `• Macro: ${macroNote}` : null,
        `• Recomendação: ${verdict}`
    ].filter(Boolean).join("\n");
}

export function neutralVerdict(tech) {
    // Heurística simples: usa RSI/MACD/BB para 📈/📉/🔁
    if (tech.rsi < 30 && tech.macdHist > 0) return "Comprar (📈)";
    if (tech.rsi > 70 && tech.macdHist < 0) return "Vender (📉)";
    return "Manter (🔁)";
}
