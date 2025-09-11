import { describe, it, expect } from 'vitest';
import { sma, rsi, macd, parabolicSAR, trendFromMAs, bollWidth } from '../src/indicators.js';

describe('sma', () => {
  it('calculates simple moving average', () => {
    const res = sma([1,2,3,4,5], 3);
    expect(res).toEqual([null, null, 2, 3, 4]);
  });
});

describe('rsi', () => {
  it('calculates relative strength index', () => {
    const prices = [44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28,46.00,46.03,46.41,46.22,45.64,46.21];
    const res = rsi(prices);
    expect(res[14]).toBeCloseTo(70.46, 2);
  });
});

describe('macd', () => {
  it('computes MACD line, signal and histogram', () => {
    const closes = [1,2,3,4,5,6,7,8,9,10];
    const res = macd(closes, 3, 6, 3);
    const expectedLine = [0,0.2142857142857144,0.4744897959183674,0.7139212827988342,0.911729487713453,1.0664139197953233,1.1835992284252308,1.270651234589451,1.3345053461353222,1.3809524793823735];
    const expectedSignal = [0,0.1071428571428572,0.2908163265306123,0.5023688046647232,0.7070491461890881,0.8867315329922056,1.0351653807087182,1.1529083076490845,1.2437068268922034,1.3123296531372883];
    const expectedHist = expectedLine.map((v, i) => v - expectedSignal[i]);
    expectedLine.forEach((v, i) => expect(res.line[i]).toBeCloseTo(v, 10));
    expectedSignal.forEach((v, i) => expect(res.signal[i]).toBeCloseTo(v, 10));
    expectedHist.forEach((v, i) => expect(res.hist[i]).toBeCloseTo(v, 10));
  });
});

describe('parabolicSAR', () => {
  it('computes parabolic SAR', () => {
    const ohlc = [
      { h: 1, l: 0, c: 0.5 },
      { h: 2, l: 1, c: 1.5 },
      { h: 3, l: 2, c: 2.5 },
      { h: 4, l: 3, c: 3.5 },
      { h: 5, l: 4, c: 4.5 },
      { h: 6, l: 5, c: 5.5 }
    ];
    const res = parabolicSAR(ohlc);
    const expected = [null, 0, 0, 0.12, 0.3528, 0.724576];
    expect(res).toEqual(expected);
  });
});

describe('trendFromMAs', () => {
  it('detects bullish trend', () => {
    const t = trendFromMAs([1,2,3,5], [1,2,3,4], [1,2,3,3]);
    expect(t).toBe('Alta');
  });

  it('detects bearish trend', () => {
    const t = trendFromMAs([5,4,3,2], [6,5,4,3], [7,6,5,4]);
    expect(t).toBe('Baixa');
  });

  it('detects neutral trend', () => {
    const t = trendFromMAs([1,2,2], [1,2,3], [3,2,1]);
    expect(t).toBe('Neutro');
  });
});

describe('bollWidth', () => {
  it('calculates relative width of bollinger bands', () => {
    const upper = [12,14,16];
    const lower = [8,10,12];
    const mid = [10,12,14];
    const res = bollWidth(upper, lower, mid);
    expect(res[0]).toBeCloseTo(0.4, 5);
    expect(res[1]).toBeCloseTo(0.3333333333, 5);
    expect(res[2]).toBeCloseTo(0.2857142857, 5);
  });

  it('returns null when values missing', () => {
    const res = bollWidth([null, 5], [1,2], [1,0]);
    expect(res).toEqual([null, null]);
  });
});
