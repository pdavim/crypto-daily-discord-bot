import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { forecastNextClose, persistForecastEntry } from '../src/forecasting.js';

describe('forecasting', () => {
    it('predicts the next close using linear regression', () => {
        const start = Date.parse('2024-01-01T00:00:00Z');
        const closes = [100, 101, 102, 103, 104, 105];
        const timestamps = closes.map((_, idx) => start + idx * 60_000);

        const result = forecastNextClose({
            closes,
            timestamps,
            lookback: 5,
            minHistory: 5,
        });

        expect(result).not.toBeNull();
        expect(result?.forecast).toBeCloseTo(106, 6);
        expect(result?.samples).toBe(5);
        expect(result?.lastClose).toBeCloseTo(105);
        expect(result?.confidence).toBeGreaterThan(0.99);
        expect(result?.nextTime).toBe(timestamps.at(-1) + 60_000);
    });

    it('returns null when insufficient history is provided', () => {
        const result = forecastNextClose({
            closes: [100, 101],
            timestamps: [Date.now(), Date.now() + 60_000],
            lookback: 5,
            minHistory: 5,
        });

        expect(result).toBeNull();
    });

    it('persists forecast history and enforces the configured limit', () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forecast-history-'));
        const baseEntry = {
            runAt: new Date('2024-01-01T00:00:00Z').toISOString(),
            predictedAt: new Date('2024-01-01T01:00:00Z').toISOString(),
            lastCloseAt: new Date('2024-01-01T00:45:00Z').toISOString(),
            lastClose: 101,
            forecastClose: 102,
            delta: 1,
            confidence: 0.9,
            method: 'linear-regression',
            samples: 10,
            mae: 0.5,
            rmse: 0.6,
            slope: 0.01,
            intercept: 100,
            horizonMs: 60_000,
        };

        const firstPath = persistForecastEntry({
            assetKey: 'BTC',
            timeframe: '1h',
            entry: baseEntry,
            directory: tmpRoot,
            historyLimit: 2,
        });

        expect(firstPath).toBeTruthy();
        expect(fs.existsSync(firstPath ?? '')).toBe(true);
        const firstRead = JSON.parse(fs.readFileSync(firstPath, 'utf-8'));
        expect(firstRead).toHaveLength(1);

        persistForecastEntry({
            assetKey: 'BTC',
            timeframe: '1h',
            entry: { ...baseEntry, forecastClose: 103, runAt: new Date('2024-01-01T01:05:00Z').toISOString() },
            directory: tmpRoot,
            historyLimit: 2,
        });
        persistForecastEntry({
            assetKey: 'BTC',
            timeframe: '1h',
            entry: { ...baseEntry, forecastClose: 104, runAt: new Date('2024-01-01T02:05:00Z').toISOString() },
            directory: tmpRoot,
            historyLimit: 2,
        });

        const finalRead = JSON.parse(fs.readFileSync(firstPath, 'utf-8'));
        expect(finalRead).toHaveLength(2);
        expect(finalRead[0].forecastClose).toBe(103);
        expect(finalRead[1].forecastClose).toBe(104);
    });
});

