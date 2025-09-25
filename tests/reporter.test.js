import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  sparklineMock,
  parabolicSARMock,
  volumeDivergenceMock,
  trendFromMAsMock,
  scoreHeuristicMock,
  semaforoMock,
  launchMock,
  browserMock
} = vi.hoisted(() => ({
  sparklineMock: vi.fn((series, size) => `spark(${series.length},${size})`),
  parabolicSARMock: vi.fn(() => [0.1, 0.2, 0.3]),
  volumeDivergenceMock: vi.fn(() => [0.01, 0.02, 0.03]),
  trendFromMAsMock: vi.fn((ma20, ma50, ma200 = []) => (ma20.at(-1) - ma50.at(-1)) + (ma50.at(-1) - (ma200.at(-1) ?? 0))),
  scoreHeuristicMock: vi.fn(({ rsi, macdHist, width, trend }) => (rsi ?? 0) / 10 + (macdHist ?? 0) + (width ?? 0) + (trend ?? 0)),
  semaforoMock: vi.fn(score => (score > 0 ? '🟢' : score < 0 ? '🔴' : '🟡')),
  launchMock: vi.fn(),
  browserMock: {
    newPage: vi.fn(),
    close: vi.fn()
  }
}));

vi.mock('../src/indicators.js', () => ({
  sparkline: sparklineMock,
  parabolicSAR: parabolicSARMock,
  volumeDivergence: volumeDivergenceMock,
  trendFromMAs: trendFromMAsMock,
  scoreHeuristic: scoreHeuristicMock,
  semaforo: semaforoMock
}));

vi.mock('puppeteer', () => ({
  default: {
    launch: launchMock
  }
}));

import {
  buildSnapshotForReport,
  buildSummary,
  buildSummaryPdf,
  pct,
  num,
  fmt
} from "../src/reporter.js";

describe('reporter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds consistent snapshots for 4h and 1h data', () => {
    const candles4h = [
      { o: 100, h: 105, l: 95, c: 102, v: 200 },
      { o: 102, h: 110, l: 100, c: 108, v: 250 },
      { o: 108, h: 115, l: 105, c: 112, v: 300 }
    ];
    const candles1h = [
      { o: 100, h: 101, l: 99, c: 100, v: 150 },
      { o: 100, h: 102, l: 98, c: 98, v: 180 }
    ];
    const dailySeries = [
      { t: new Date('2023-12-10T00:00:00Z'), c: 60 },
      { t: new Date('2024-01-01T00:00:00Z'), c: 80 },
      { t: new Date('2024-01-08T00:00:00Z'), c: 100 },
      { t: new Date('2024-01-09T00:00:00Z'), c: 112 }
    ];

    const snapshot4h = buildSnapshotForReport({
      candles: candles4h,
      daily: dailySeries,
      ma20: [100, 105, 110],
      ma50: [95, 100, 105],
      ma100: [90, 95, 100],
      ma200: [85, 90, 95],
      rsi: [40, 35, 25],
      macdObj: { hist: [0.2, 0.5, 0.8] },
      bb: { upper: [null, 115, 120], lower: [null, 95, 100], mid: [null, 105, 110] },
      atr: [0.9, 1.0, 1.2],
      volSeries: [200, 250, 300]
    });

    expect(sparklineMock).toHaveBeenCalledWith([102, 108, 112], 28);
    expect(parabolicSARMock).toHaveBeenCalledWith(candles4h);
    expect(volumeDivergenceMock).toHaveBeenCalledWith([102, 108, 112], [200, 250, 300]);

    expect(snapshot4h.kpis.price).toBe(112);
    expect(snapshot4h.kpis.var).toBeCloseTo(112 / 108 - 1, 6);
    expect(snapshot4h.kpis.var24h).toBeCloseTo(0.12, 6);
    expect(snapshot4h.kpis.var7d).toBeCloseTo(0.4, 6);
    expect(snapshot4h.kpis.var30d).toBeCloseTo(112 / 60 - 1, 6);
    expect(snapshot4h.kpis.rsi).toBe(25);
    expect(snapshot4h.kpis.macdHist).toBe(0.8);
    expect(snapshot4h.kpis.sma200).toBe(95);
    expect(snapshot4h.kpis.bw).toBeCloseTo((120 - 100) / 110, 6);
    expect(snapshot4h.kpis.atr14).toBe(1.2);
    expect(snapshot4h.kpis.vol).toBe(300);
    expect(snapshot4h.kpis.sar).toBe(0.3);
    expect(snapshot4h.kpis.volDiv).toBe(0.03);
    const expectedTrend4h = (110 - 105) + (105 - 95);
    const expectedBw4h = (120 - 100) / 110;
    const expectedScore4h = 25 / 10 + 0.8 + expectedBw4h + expectedTrend4h;
    expect(snapshot4h.kpis.trend).toBe(expectedTrend4h);
    expect(snapshot4h.kpis.score).toBeCloseTo(expectedScore4h, 6);
    expect(snapshot4h.kpis.sem).toBe('🟢');
    expect(snapshot4h.kpis.reco).toBe('Comprar (📈)');
    expect(snapshot4h.kpis.spark).toBe('spark(3,28)');

    const snapshot1h = buildSnapshotForReport({
      candles: candles1h,
      daily: dailySeries,
      ma20: [60, 55, 50],
      ma50: [70, 65, 55],
      ma100: [75, 70, 60],
      ma200: [80, 75, 65],
      rsi: [60, 75, 80],
      macdObj: { hist: [-0.1, -0.3, -0.4] },
      bb: { upper: [null, 65, 70], lower: [null, 55, 50], mid: [null, 60, 60] },
      atr: [0.5, 0.6, 0.7],
      volSeries: [150, 180]
    });

    expect(snapshot1h.kpis.price).toBe(98);
    expect(snapshot1h.kpis.var).toBeCloseTo(98 / 100 - 1, 6);
    expect(snapshot1h.kpis.reco).toBe('Vender (📉)');
    expect(snapshot1h.kpis.sem).toBe('🔴');

    const summary = buildSummary({ assetKey: 'BTC', snapshots: { '4h': snapshot4h, '1h': snapshot1h } });
    expect(summary).toContain('**Asset name**: **BTC**');
    expect(summary).toContain('**Preço**: 📈 112.0000');
    expect(summary).toContain('1h - 📉 -2.00%');
    expect(summary).toContain('4h - 📈 3.70%');
    expect(summary).toContain('24h 📈 12.00%');
    expect(summary).toContain('7d 📈 40.00%');
    expect(summary).toContain('30d 📈 86.67%');
    expect(summary).toContain('-- 5m - ??');
  });

  it('handles missing historical daily prices with null returns', () => {
    const candles = [
      { o: 1, h: 2, l: 0.5, c: 1.2, v: 100 },
      { o: 1.2, h: 2.1, l: 1.0, c: 1.4, v: 120 }
    ];
    const daily = [
      { t: new Date('2024-02-10T00:00:00Z'), c: 1.4 }
    ];

    const snapshot = buildSnapshotForReport({
      candles,
      daily,
      ma20: [1, 1],
      ma50: [1, 1],
      ma100: [1, 1],
      ma200: [1, 1],
      rsi: [50, 50],
      macdObj: { hist: [0, 0] },
      bb: { upper: [null, 2], lower: [null, 1], mid: [null, 1.5] },
      atr: [0.5, 0.5],
      volSeries: [100, 120]
    });

    expect(snapshot.kpis.var24h).toBeNull();
    expect(snapshot.kpis.var7d).toBeNull();
    expect(snapshot.kpis.var30d).toBeNull();

    const summary = buildSummary({ assetKey: 'BTC', snapshots: { '4h': snapshot } });
    expect(summary).toContain('24h ??');
    expect(summary).toContain('7d ??');
    expect(summary).toContain('30d ??');
  });

  it('formats multi-timeframe summaries with directional indicators', () => {
    const summary = buildSummary({
      assetKey: 'ETH',
      snapshots: {
        '5m': {
          kpis: {
            var: 0.01,
            fearGreed: 'Greedy',
            trend: 'Tendência de alta persistente',
            reco: 'Comprar',
            sem: '🟢',
            score: 5,
            adx14: 30,
            kcState: 'Acima'
          }
        },
        '15m': {
          kpis: {
            var: -0.02,
            fearGreed: 'Neutro',
            trend: -3,
            reco: 'Vender',
            sem: '🔴',
            score: -3,
            adx14: 22,
            kcState: 'Dentro'
          }
        },
        '30m': {
          kpis: {
            var: 0,
            fearGreed: 'N/A',
            trend: 'fase de baixa moderada',
            reco: 'Manter',
            sem: '🟡',
            score: 0,
            adx14: 19,
            kcState: 'Abaixo'
          }
        },
        '1h': {
          kpis: {
            price: 123.4567,
            var: 0.05,
            var24h: 0.1,
            var7d: -0.05,
            var30d: 0.2,
            fearGreed: 42,
            trend: 0,
            reco: 'Comprar',
            sem: '🟢',
            score: 3,
            adx14: 40,
            kcState: 'Acima'
          }
        },
        '4h': {
          kpis: {
            price: 150,
            var: -0.01,
            var24h: -0.02,
            var7d: 0.03,
            var30d: 0.04,
            fearGreed: 'Desconhecido',
            trend: 'Alta forte',
            reco: 'Manter',
            sem: '🟡',
            score: 1,
            adx14: 10,
            kcState: 'Dentro'
          }
        }
      }
    });

    expect(summary).toContain('**Asset name**: **ETH**');
    expect(summary).toContain('**Preço**: 📈 150.0000');
    expect(summary).toContain('-- 5m - 📈 1.00% / 15m - 📉 -2.00% / 30m - 🟡 0.00% / 1h - 📈 5.00% / 4h - 📉 -1.00% / 24h 📉 -2.00% / 7d 📈 3.00% / 30d 📈 4.00%');
    expect(summary).toContain('-- 5m - Greedy / 15m - Neutro / 30m - N/A / 1h - 42 / 4h - Desconhecido');
    expect(summary).toContain('-- 5m - 📈 Tendência de alta persistente / 15m - 📉 Baixa / 30m - 📉 fase de baixa moderada / 1h - 🟡 Neutro / 4h - 📈 Alta forte');
    expect(summary).toContain('-- 5m - Comprar / 15m - Vender / 30m - Manter / 1h - Comprar / 4h - Manter');
    expect(summary).toContain('-- 5m - 🟢 / 15m - 🔴 / 30m - 🟡 / 1h - 🟢 / 4h - 🟡');
    expect(summary).toContain('-- 5m - 📈 5 / 15m - 📉 -3 / 30m - 🟡 0 / 1h - 📈 3 / 4h - 📈 1');
    expect(summary).toContain('-- 5m - 💪 30 / 15m - 📈 22 / 30m - 🟡 19 / 1h - 💪 40 / 4h - 🟡 10');
    expect(summary).toContain('-- 5m - 📈 Acima / 15m - 🟡 Dentro / 30m - 📉 Abaixo / 1h - 📈 Acima / 4h - 🟡 Dentro');
  });

  describe('buildSummaryPdf', () => {
    let processOnceSpy;

    beforeEach(() => {
      launchMock.mockResolvedValue(browserMock);
      browserMock.close.mockResolvedValue();
      browserMock.newPage.mockReset();
      processOnceSpy = vi.spyOn(process, 'once').mockImplementation(() => {});
    });

    afterEach(() => {
      processOnceSpy.mockRestore();
    });

    it('renders a PDF with sanitized HTML and reuses the browser', async () => {
      const pages = [];
      browserMock.newPage.mockImplementation(async () => {
        const page = {
          setContent: vi.fn().mockResolvedValue(),
          pdf: vi.fn().mockResolvedValue(Buffer.from('pdf-data')),
          close: vi.fn().mockResolvedValue()
        };
        pages.push(page);
        return page;
      });

      const pdf1 = await buildSummaryPdf('# Heading', { assetKey: 'BTC', timeframe: '4h' });
      expect(pdf1).toBeInstanceOf(Buffer);
      expect(launchMock).toHaveBeenCalledTimes(1);
      expect(processOnceSpy).toHaveBeenCalledWith('exit', expect.any(Function));
      expect(pages[0].setContent).toHaveBeenCalledWith(expect.stringContaining('<title>BTC • 4h</title>'), { waitUntil: 'domcontentloaded' });
      expect(pages[0].pdf).toHaveBeenCalledWith(expect.objectContaining({ format: 'A4', printBackground: true }));
      expect(pages[0].close).toHaveBeenCalled();

      const pdf2 = await buildSummaryPdf('*Another* summary');
      expect(pdf2).toBeInstanceOf(Buffer);
      expect(launchMock).toHaveBeenCalledTimes(1);
      expect(pages[1].setContent).toHaveBeenCalledWith(expect.stringContaining('<title>Análise</title>'), { waitUntil: 'domcontentloaded' });
      expect(pages[1].close).toHaveBeenCalled();
    });

    it('throws when attempting to render an empty summary', async () => {
      await expect(buildSummaryPdf('')).rejects.toThrow('Cannot build PDF from empty summary');
      expect(launchMock).not.toHaveBeenCalled();
    });
  });

  it('formats numeric helpers consistently', () => {
    expect(pct(null)).toBe('—');
    expect(pct(0.1234)).toBe('12.34%');
    expect(num(undefined)).toBe('—');
    expect(num('12.3456', 2)).toBe('12.35');
    expect(fmt(null)).toBe('—');
    expect(fmt(1234567)).toMatch(/1,234,567|1\.234\.567/);
  });
});
