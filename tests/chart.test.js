import { beforeEach, describe, expect, it, vi } from "vitest";

const renderConfigs = [];

vi.mock("chartjs-node-canvas", () => {
    const renderToBuffer = vi.fn(async (config) => {
        renderConfigs.push(config);
        return Buffer.from("png");
    });
    const ChartJSNodeCanvas = vi.fn(() => ({ renderToBuffer }));
    return {
        __esModule: true,
        ChartJSNodeCanvas,
        default: ChartJSNodeCanvas,
        __renderState: { renderToBuffer, renderConfigs },
    };
});

const adapterPrototype = { parse: vi.fn(), format: vi.fn() };
const controllerRegistry = new Map([["candlestick", {}]]);

vi.mock("chart.js/auto", () => ({
    __esModule: true,
    Chart: {
        register: vi.fn(),
        registry: { controllers: controllerRegistry },
        _adapters: { _date: { prototype: adapterPrototype } },
    },
    _adapters: { _date: { prototype: adapterPrototype } },
}));

vi.mock("chart.js", () => ({
    __esModule: true,
    _adapters: { _date: { prototype: adapterPrototype } },
}));

const directories = new Set();
const files = new Map();

vi.mock("node:fs", () => {
    const existsSync = vi.fn((target) => directories.has(target) || files.has(target));
    const mkdirSync = vi.fn((target) => { directories.add(target); });
    const writeFileSync = vi.fn((target, data) => {
        files.set(target, data);
        const parts = target.split("/").slice(0, -1);
        if (parts.length > 0) {
            const dir = parts.join("/");
            directories.add(dir);
        }
    });
    const renameSync = vi.fn();
    return {
        __esModule: true,
        default: { existsSync, mkdirSync, writeFileSync, renameSync },
        existsSync,
        mkdirSync,
        writeFileSync,
        renameSync,
        __state: { directories, files },
    };
});

vi.mock("../src/logger.js", () => {
    const log = {
        info: vi.fn(),
        debug: vi.fn(),
    };
    return {
        logger: log,
        withContext: vi.fn(() => log),
    };
});

vi.mock("../src/perf.js", () => ({
    recordPerf: vi.fn(),
}));

const resetState = async () => {
    renderConfigs.length = 0;
    const fs = await import("node:fs");
    fs.existsSync.mockClear();
    fs.mkdirSync.mockClear();
    fs.writeFileSync.mockClear();
    fs.renameSync.mockClear();
    fs.__state.directories.clear();
    fs.__state.files.clear();

    const chartCanvas = await import("chartjs-node-canvas");
    chartCanvas.default.mockClear();
    chartCanvas.__renderState.renderToBuffer.mockClear();

    const logger = await import("../src/logger.js");
    logger.withContext.mockClear();
    logger.logger.info.mockClear();
    logger.logger.debug.mockClear();

    const perf = await import("../src/perf.js");
    perf.recordPerf.mockClear();
};

describe("chart rendering", () => {
    beforeEach(async () => {
        vi.resetModules();
        await resetState();
    });

    it("builds candlestick datasets and persists PNG output", async () => {
        const candles = Array.from({ length: 3 }, (_, idx) => {
            const base = Date.UTC(2024, 0, 1, idx);
            return {
                t: base,
                o: 100 + idx,
                h: 101 + idx,
                l: 99 + idx,
                c: 100.5 + idx,
                v: 1_000 + idx,
            };
        });
        const indicators = {
            ma20: candles.map(c => c.c + 0.1),
            ma50: candles.map(c => c.c + 0.2),
            ma200: candles.map(c => c.c + 0.3),
            bbUpper: candles.map(c => c.c + 1),
            bbLower: candles.map(c => c.c - 1),
            sarSeries: candles.map(c => c.c - 0.5),
        };
        const overlays = { volume: true, psar: true };

        const { renderChartPNG } = await import("../src/chart.js");
        const outputPath = await renderChartPNG("BTC", "1h", candles, indicators, overlays);

        expect(outputPath).toBe("charts/BTC_1h.png");

        const fs = await import("node:fs");
        expect(fs.existsSync).toHaveBeenCalledWith("charts");
        expect(fs.mkdirSync).toHaveBeenCalledWith("charts", { recursive: true });
        expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
        const [writePath, buffer] = fs.writeFileSync.mock.calls[0];
        expect(writePath).toBe("charts/BTC_1h.png");
        expect(buffer).toBeInstanceOf(Buffer);

        const { __renderState } = await import("chartjs-node-canvas");
        expect(__renderState.renderToBuffer).toHaveBeenCalledTimes(1);
        const config = renderConfigs[0];
        expect(config.type).toBe("candlestick");
        const datasetTypes = config.data.datasets.map(ds => ds.type);
        expect(datasetTypes).toContain("candlestick");
        expect(datasetTypes).toContain("bar");
        expect(datasetTypes).toContain("scatter");
        const priceDataset = config.data.datasets.find(ds => ds.type === "candlestick");
        expect(priceDataset.data).toEqual(candles.map(c => ({
            x: c.t,
            o: c.o,
            h: c.h,
            l: c.l,
            c: c.c,
        })));
        const volumeDataset = config.data.datasets.find(ds => ds.label === "Volume");
        expect(volumeDataset.yAxisID).toBe("y1");
        expect(volumeDataset.data).toEqual(candles.map(c => ({ x: c.t, y: c.v })));

        const logger = await import("../src/logger.js");
        expect(logger.withContext).toHaveBeenCalledWith(logger.logger, { asset: "BTC", timeframe: "1h" });
        expect(logger.logger.info).toHaveBeenCalledWith({ fn: "renderChartPNG", candlestickAvailable: true }, "candlestick");
        expect(logger.logger.info).toHaveBeenCalledWith({ fn: "renderChartPNG", timeAdapter: true }, "time adapter");

        const perf = await import("../src/perf.js");
        expect(perf.recordPerf).toHaveBeenCalledWith("renderChartPNG", expect.any(Number));
    });

    it("renders forecast charts with confidence annotation and derived timestamp", async () => {
        const base = Date.UTC(2024, 0, 1, 0);
        const closes = [100, 101, 102, 103];
        const timestamps = closes.map((_, idx) => base + idx * 60 * 60 * 1000);

        const { renderForecastChart } = await import("../src/chart.js");
        const out = await renderForecastChart({
            assetKey: "ETH",
            timeframe: "4h",
            closes,
            timestamps,
            forecastValue: 105,
            confidence: 0.72,
            options: { directory: "charts/custom", historyPoints: 3 },
        });

        expect(out).toBe("charts/custom/ETH_4h_forecast.png");

        const { __renderState } = await import("chartjs-node-canvas");
        expect(__renderState.renderToBuffer).toHaveBeenCalledTimes(1);
        const config = renderConfigs[0];
        expect(config.type).toBe("line");
        expect(config.options.scales.x.type).toBe("time");
        const [series, forecastSeries] = config.data.datasets;
        expect(series.label).toBe("ETH 4h Close");
        expect(series.data).toHaveLength(3);
        expect(series.data[0].x).toBe(timestamps[1]);
        expect(series.data.at(-1).y).toBe(103);
        expect(forecastSeries.label).toBe("Forecast (72%)");
        expect(forecastSeries.data).toHaveLength(2);
        const [lastActual, forecastPoint] = forecastSeries.data;
        expect(lastActual).toMatchObject({ x: timestamps[3], y: 103 });
        expect(forecastPoint.y).toBe(105);
        expect(forecastPoint.x).toBe(timestamps[3] + 60 * 60 * 1000);

        const fs = await import("node:fs");
        expect(fs.mkdirSync).toHaveBeenCalledWith("charts/custom", { recursive: true });

        const perf = await import("../src/perf.js");
        expect(perf.recordPerf).toHaveBeenCalledWith("renderForecastChart", expect.any(Number));
    });

    it("renders growth charts with target, cash buffer, and drawdown axes", async () => {
        const history = [
            { timestamp: Date.UTC(2024, 0, 1), totalValue: 100, cash: 20, drawdownPct: 0.02 },
            { timestamp: Date.UTC(2024, 0, 2), totalValue: 110, cash: 22, drawdownPct: 0.01 },
            { timestamp: Date.UTC(2024, 0, 3), totalValue: 120, cash: 25, drawdownPct: 0.0 },
        ];

        const { renderPortfolioGrowthChart } = await import("../src/chart.js");
        const out = await renderPortfolioGrowthChart({
            history,
            targetCapital: 10_000,
            options: { cagr: 0.1234, maxDrawdownPct: 0.25 },
        });

        expect(out).toMatch(/^charts\/growth\/portfolio_growth_\d+\.png$/);

        const { __renderState } = await import("chartjs-node-canvas");
        expect(__renderState.renderToBuffer).toHaveBeenCalledTimes(1);
        const config = renderConfigs[0];
        expect(config.data.datasets.map(ds => ds.label)).toEqual(expect.arrayContaining([
            "Portfolio Value",
            "Invested Capital",
            "Cash Buffer",
            expect.stringContaining("Meta"),
            "Drawdown",
        ]));
        const drawdownDataset = config.data.datasets.find(ds => ds.label === "Drawdown");
        expect(drawdownDataset.yAxisID).toBe("y1");
        expect(config.options.scales.y1).toMatchObject({ position: "right", title: { text: "Drawdown" } });
        expect(config.options.plugins.title.text).toContain("CAGR 12.34%");
        expect(config.options.plugins.title.text).toContain("Max DD 25.0%");

        const fs = await import("node:fs");
        expect(fs.mkdirSync).toHaveBeenCalledWith("charts/growth", { recursive: true });

        const perf = await import("../src/perf.js");
        expect(perf.recordPerf).toHaveBeenCalledWith("renderPortfolioGrowthChart", expect.any(Number));
    });
});
