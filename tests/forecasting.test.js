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

        const firstPersist = persistForecastEntry({
            assetKey: 'BTC',
            timeframe: '1h',
            entry: baseEntry,
            directory: tmpRoot,
            historyLimit: 2,
        });

        expect(firstPersist?.filePath).toBeTruthy();
        expect(fs.existsSync(firstPersist?.filePath ?? '')).toBe(true);
        const firstRead = JSON.parse(fs.readFileSync(firstPersist?.filePath ?? '', 'utf-8'));
        expect(firstRead).toHaveLength(1);

        persistForecastEntry({
            assetKey: 'BTC',
            timeframe: '1h',
            entry: { ...baseEntry, forecastClose: 103, runAt: new Date('2024-01-01T01:05:00Z').toISOString() },
            directory: tmpRoot,
            historyLimit: 2,
        });
        const finalPersist = persistForecastEntry({
            assetKey: 'BTC',
            timeframe: '1h',
            entry: { ...baseEntry, forecastClose: 104, runAt: new Date('2024-01-01T02:05:00Z').toISOString() },
            directory: tmpRoot,
            historyLimit: 2,
        });

        expect(finalPersist?.filePath).toBe(firstPersist?.filePath);
        const finalRead = JSON.parse(fs.readFileSync(finalPersist?.filePath ?? '', 'utf-8'));
        expect(finalRead).toHaveLength(2);
        expect(finalRead[0].forecastClose).toBe(103);
        expect(finalRead[1].forecastClose).toBe(104);
    });

    it('evaluates previous forecast accuracy when persisting a new entry', () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forecast-accuracy-'));
        const baseEntry = {
            runAt: new Date('2024-01-01T00:00:00Z').toISOString(),
            predictedAt: new Date('2024-01-01T01:00:00Z').toISOString(),
            lastCloseAt: new Date('2024-01-01T00:45:00Z').toISOString(),
            lastClose: 100,
            forecastClose: 102,
            delta: 2,
            confidence: 0.9,
            method: 'linear-regression',
            samples: 10,
            mae: 0.5,
            rmse: 0.6,
            slope: 0.01,
            intercept: 100,
            horizonMs: 60_000,
        };

        persistForecastEntry({
            assetKey: 'ETH',
            timeframe: '4h',
            entry: baseEntry,
            directory: tmpRoot,
            historyLimit: 10,
        });

        const nextEntry = {
            ...baseEntry,
            runAt: new Date('2024-01-01T04:00:00Z').toISOString(),
            lastCloseAt: new Date('2024-01-01T03:45:00Z').toISOString(),
            lastClose: 98,
            forecastClose: 101,
        };

        const result = persistForecastEntry({
            assetKey: 'ETH',
            timeframe: '4h',
            entry: nextEntry,
            directory: tmpRoot,
            historyLimit: 10,
        });

        expect(result?.evaluation).toMatchObject({
            actual: 98,
            predicted: 102,
            directionHit: false,
            horizonMs: 60_000,
        });
        expect(result?.evaluation?.absError).toBeCloseTo(4, 6);
        expect(result?.evaluation?.pctError ?? 0).toBeCloseTo(4 / 98, 6);
        expect(result?.evaluation?.predictedAt).toBe(baseEntry.predictedAt);
        expect(result?.evaluation?.actualAt).toBe(nextEntry.lastCloseAt);
    });

    it('ensures forecast artifacts directories are ignored by git', () => {
        const gitignore = fs.readFileSync(path.resolve('.gitignore'), 'utf-8');
        expect(gitignore).toContain('reports/forecasts/');
        expect(gitignore).toContain('charts/');
    });
});

