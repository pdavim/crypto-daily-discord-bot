// call openrouter ai
// obejcte: detailed adn deep analysis of several assets, using various data sources
// fallback to simple technical analysis if openrouter fails
// use binance for price data, news api for news, web search for web snippets
// indicators list to consider:
// - SMA (20,50,200)
// - RSI (14)
// - MACD (12,26,9)
// - Bollinger Bands (20,2) + width + squeeze
// - Parabolic SAR
// - Volume Divergence
// - ATR (14)
// - Trend from MAs
// - Heuristic Score (0-100) + semaforo
// - Sparkline of closes
// - atr14
// - bollWidth
// - isBBSqueeze
// - crossUp
// - crossDown
// - sparkline
// - trendFromMAs
// - scoreHeuristic
// - semaforo
// return a markdown detailed report with sugestions for each asset
// include a macro context section with general market news and web snippets
// final report structure:
// - Asset name
// - Price and OHLCV
// - Returns (1d,7d,30d)
// - Technical indicators values
// - News summary
// - Web snippets
// - Macro context
// - Verdict (bullish, bearish, neutral) with justification
// - Technical indicators considered
// - entry and exit points if applicable
// - Risk assessment
// - Confidence level
// - Suggested position size
// - Timeframe for the analysis
// - Any relevant charts or sparklines
// - Sources of information 
// - Disclaimer
// - This report is for educational purposes only and not financial advice.


import OpenAi from "openai";
import { CFG } from "./config.js";
import { ASSETS } from "./assets.js";
import { fetchOHLCV } from "./data/binance.js";
import { getAssetNews } from "./news.js";
import { searchWeb } from "./websearch.js";
import { sma, rsi, macd, atr14, bollinger, bollWidth, crossUp, crossDown, parabolicSAR, semaforo, isBBSqueeze, sparkline, volumeDivergence, trendFromMAs, scoreHeuristic } from "./indicators.js";
import { buildAlerts } from "./alerts.js";

const openrouter = CFG.openrouterApiKey
    ? new OpenAi({ baseURL: 'https://openrouter.ai/api/v1', apiKey: CFG.openrouterApiKey })
    : null;

// OpenRouter chat completion
export async function callOpenRouter(messages) {
    console.log("Calling OpenRouter...");
    if (!openrouter) {
        throw new Error("OpenRouter API key missing");
    }
    if (!CFG.openrouterModel) {
        throw new Error("OpenRouter model missing");
    }
    try {
        const response = await openrouter.chat.completions.create({
            model: CFG.openrouterModel,
            messages,
        });
        return response.choices[0].message.content;
    } catch (error) {
        console.error("Error calling OpenRouter:", error);
        throw error;
    }
}

function calcReturn(closes, days) {
    const last = closes.at(-1);
    const prev = closes.at(-(days + 1));
    if (!last || !prev) return 0;
    return ((last - prev) / prev) * 100;
}

function fallbackVerdict({ ma20, ma50, rsi14 }) {
    if (ma20 > ma50 && rsi14 > 55) {
        return "📈 Uptrend with bullish momentum.";
    }
    if (ma20 < ma50 && rsi14 < 45) {
        return "📉 Downtrend with weak momentum.";
    }
    return "🔁 Mixed technical signals, hold.";
}

async function getMacroContext() {
    console.log("Fetching macro context...");
    try {
        const { summary } = await getAssetNews({ symbol: "crypto market" });
        const web = await searchWeb("crypto market");
        return [summary, web.slice(0, 2).join(" | ")].filter(Boolean).join(" | ");
    } catch {
        return "";
    }
}

// Gather metrics for several assets and use OpenRouter for a brief analysis
export async function runAgent() {
    console.log("Running AI agent for asset analysis...");
    const reports = [];
    const macro = await getMacroContext();

    for (const { key, binance } of ASSETS) {
        try {
            if (!binance) {
                reports.push(`**${key}**\n- No Binance symbol configured.`);
                continue;
            }

            const hourly = await fetchOHLCV(binance, "1h");
            const daily = await fetchOHLCV(binance, "1d");
            if (!hourly.length || !daily.length) {
                reports.push(`**${key}**\n- No candle data.`);
                continue;
            }

            const closesH = hourly.map(c => c.c);
            const highsH = hourly.map(c => c.h);
            const lowsH = hourly.map(c => c.l);
            const volumesH = hourly.map(c => c.v);

            const ma20Series = sma(closesH, 20);
            const ma50Series = sma(closesH, 50);
            const ma200Series = sma(closesH, 200);
            const ma20 = ma20Series.at(-1);
            const ma50 = ma50Series.at(-1);
            const ma200 = ma200Series.at(-1);
            const rsi14 = rsi(closesH, 14).at(-1);
            const macdResult = macd(closesH, 12, 26, 9);
            const macdLine = macdResult.macd.at(-1);
            const macdSignal = macdResult.signal.at(-1);
            const bb = bollinger(closesH, 20, 2);
            const widthSeries = bollWidth(bb.upper, bb.lower, bb.mid);
            const bollW = widthSeries.at(-1);
            const bbSqueeze = isBBSqueeze(widthSeries);
            const atrSeries = atr14(hourly);
            const atrValue = atrSeries.at(-1);
            const sar = parabolicSAR(hourly, 0.02, 0.2).at(-1);
            const volume = volumeDivergence(closesH, volumesH, 14).at(-1);
            const trend = trendFromMAs(ma20Series, ma50Series, ma200Series);
            const heuristic = scoreHeuristic(closesH, 14).at(-1);
            const semaf = semaforo(heuristic);
            const spark = sparkline(closesH);
            const crossUpSignal = crossUp(ma20Series, ma50Series);
            const crossDownSignal = crossDown(ma20Series, ma50Series);
            const lastDaily = daily.at(-1);
            const dailyCloses = daily.map(c => c.c);
            const ret1d = calcReturn(dailyCloses, 1);
            const ret7d = calcReturn(dailyCloses, 7);
            const ret30d = calcReturn(dailyCloses, 30);

            const { summary: newsSummary } = await getAssetNews({ symbol: key });
            const webSnips = await searchWeb(key);

            const prompt = `Asset: ${key}\n` +
                `OHLCV: O:${lastDaily.o} H:${lastDaily.h} L:${lastDaily.l} C:${lastDaily.c} V:${lastDaily.v}\n` +
                `Returns: 24h ${ret1d.toFixed(2)}% 7d ${ret7d.toFixed(2)}% 30d ${ret30d.toFixed(2)}%\n` +
                `MA20: ${ma20?.toFixed(2)} MA50: ${ma50?.toFixed(2)} MA200: ${ma200?.toFixed(2)} RSI14: ${rsi14?.toFixed(2)}\n` +
                `MACD: ${macdLine?.toFixed(2)} Signal: ${macdSignal?.toFixed(2)}\n` +
                `Bollinger Bands: ${bb.upper.at(-1)?.toFixed(2)} / ${bb.lower.at(-1)?.toFixed(2)} Width: ${bollW?.toFixed(2)} Squeeze: ${bbSqueeze}\n` +
                `Parabolic SAR: ${sar?.toFixed(2)}\n` +
                `Volume Divergence: ${volume?.toFixed(2)}\n` +
                `ATR: ${atrValue?.toFixed(2)}\n` +
                `Trend from MAs: ${trend}\n` +
                `Heuristic Score: ${heuristic?.toFixed(2)} Semaforo: ${semaf}\n` +
                `Cross Up: ${crossUpSignal} Cross Down: ${crossDownSignal}\n` +
                `Sparkline: ${spark}\n` +
                `News: ${newsSummary}\n` +
                `Web: ${webSnips.join(' | ')}\n` +
                `Macro: ${macro}\n` +
                `Provide a detailed analysis of the asset's current market position, social hypes, and potential future movements.\n` +
                `Include risk assessment and confidence level in the analysis.\n` +
                `Give a verdict (📈 bullish, 📉 bearish, 🔁 neutral) with 1-2 line detailed justification.\n` +
                `Suggest entry/exit points if possible.`;
            // console.log("Prompt for OpenRouter:", prompt);

            let verdict = "";
            if (openrouter) {
                try {
                    const messages = [
                        { role: "system", content: "You are a crypto trading assistant." },
                        { role: "user", content: [{ type: "text", text: prompt }] }
                    ];
                    verdict = await callOpenRouter(messages);
                } catch (error) {
                    console.error(`OpenRouter call failed for ${key}:`, error);
                    verdict = fallbackVerdict({ ma20, ma50, rsi14 });
                }
            }
            if (!verdict) {
                verdict = fallbackVerdict({ ma20, ma50, rsi14 });
            }

            // Prepare indicator series for alerts
            const alerts = buildAlerts({
                rsiSeries: rsi(closesH, 14),
                macdObj: macdResult,
                bbWidth: widthSeries,
                ma20: ma20Series,
                ma50: ma50Series,
                ma200: ma200Series,
                lastClose: closesH.at(-1),
                var24h: (closesH.at(-1) - closesH.at(-25)) / closesH.at(-25),
                closes: closesH,
                highs: highsH,
                lows: lowsH,
                volumes: volumesH,
                atrSeries,
                upperBB: bb.upper,
                lowerBB: bb.lower,
                sarSeries: parabolicSAR(hourly, 0.02, 0.2),
                trendSeries: [trend],
                heuristicSeries: scoreHeuristic(closesH, 14),
                vwapSeries: undefined, // Add if you have VWAP calculation
                ema9: undefined, // Add if you have EMA9 calculation
                ema21: undefined, // Add if you have EMA21 calculation
                stochasticK: undefined, // Add if you have Stochastic K calculation
                stochasticD: undefined, // Add if you have Stochastic D calculation
                willrSeries: undefined, // Add if you have Williams %R calculation
                cciSeries: undefined, // Add if you have CCI calculation
                obvSeries: undefined // Add if you have OBV calculation
            });

            const report = [
                `**${key}**`,
                `- Price: ${lastDaily.c} (O:${lastDaily.o} H:${lastDaily.h} L:${lastDaily.l} V:${lastDaily.v})`,
                `- Returns: 24h ${ret1d.toFixed(2)}%, 7d ${ret7d.toFixed(2)}%, 30d ${ret30d.toFixed(2)}%`,
                `- Technicals: MA20 ${ma20?.toFixed(2)}, MA50 ${ma50?.toFixed(2)}, MA200 ${ma200?.toFixed(2)}, RSI14 ${rsi14?.toFixed(2)}`,
                `- MACD: ${macdLine?.toFixed(2)} Signal: ${macdSignal?.toFixed(2)}`,
                `- Bollinger Bands: ${bb.upper.at(-1)?.toFixed(2)} / ${bb.lower.at(-1)?.toFixed(2)} Width: ${bollW?.toFixed(2)} Squeeze: ${bbSqueeze}`,
                `- Parabolic SAR: ${sar?.toFixed(2)}`,
                `- Volume Divergence: ${volume?.toFixed(2)}`,
                `- ATR: ${atrValue?.toFixed(2)}`,
                `- Trend from MAs: ${trend}`,
                `- Heuristic Score: ${heuristic?.toFixed(2)} Semaforo: ${semaf}`,
                `- Cross Up: ${crossUpSignal} Cross Down: ${crossDownSignal}`,
                `- Sparkline: ${spark}`,
                `**Alert Status:**`,
                ...alerts,
                `- News: ${newsSummary || 'n/a'}`,
                `- Web: ${webSnips.slice(0, 2).join(' | ') || 'n/a'}`,
                `- Macro: ${macro || 'n/a'}`,
                `- Verdict: ${verdict.trim()}`,
            ].join("\n");

            reports.push(report);
        } catch (error) {
            reports.push(`**${key}**\n- Error: ${error.message}`);
        }
    }

    const macroSection = macro ? `**Macro**\n${macro}` : "";
    const disclaimer = "_This report is for educational purposes only and not financial advice._";
    return [reports.join("\n\n"), macroSection, disclaimer].filter(Boolean).join("\n\n");
}