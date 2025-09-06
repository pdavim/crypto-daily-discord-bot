// ⚠️ Usar apenas se tiveres autorização. Ver ToS da TradingView.
// Este módulo abre a página do símbolo/timeframe e extrai OHLC visíveis.
// Em alternativa, faz screenshot para fins educacionais internos (fair use).
import puppeteer from "puppeteer";

export async function fetchOHLCV_TV(tvSymbol, timeframe = "60") {
    const url = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}&interval=${timeframe}`;
    const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle2" });
    // ⚠️ TV não oferece API pública; scraping pode violar ToS.
    // Exemplo mínimo: ler tooltip/últimos candles do DOM (dependente do layout; frágil).
    const data = await page.evaluate(() => {
        // placeholder: retorna vazio por segurança
        return [];
    });
    await browser.close();
    return data;
}
