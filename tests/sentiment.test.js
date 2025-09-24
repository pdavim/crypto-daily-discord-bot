import { describe, it, expect } from "vitest";
import { classifySentimentsLocal, normalizeSentiment, clampSentiment } from "../src/sentiment.js";
import { computeWeightedSentiment } from "../src/news.js";

function closeTo(value, expected) {
    expect(Math.abs(value - expected)).toBeLessThan(1e-6);
}

describe("sentiment analysis", () => {
  it("uses the local TensorFlow model to classify polarity", async () => {
    const [positive] = await classifySentimentsLocal(["Bitcoin rally hits new record high"]);
    const [negative] = await classifySentimentsLocal(["Ethereum plunges amid market crash"]);
    expect(positive).toBeGreaterThan(0);
    expect(negative).toBeLessThan(0);
    expect(Math.abs(positive)).toBeLessThanOrEqual(1);
    expect(Math.abs(negative)).toBeLessThanOrEqual(1);
  });

  it("gracefully handles unsupported or empty inputs", async () => {
    await expect(classifySentimentsLocal()).resolves.toEqual([]);
    await expect(classifySentimentsLocal("not an array")).resolves.toEqual([]);
    await expect(classifySentimentsLocal([])).resolves.toEqual([]);
  });

  it("normalizes heterogeneous sentiment payloads", () => {
    closeTo(normalizeSentiment({ label: "POSITIVE", score: 0.75 }), 0.75);
    const weighted = normalizeSentiment({ positive: 0.7, negative: 0.2, neutral: 0.1 });
    expect(weighted).toBeGreaterThan(0);
    expect(weighted).toBeLessThanOrEqual(1);
    closeTo(normalizeSentiment({ negative: 0.9, positive: 0.1 }), -0.8);
    expect(normalizeSentiment("0.5")).toBeCloseTo(0.5, 10);
    expect(normalizeSentiment([-0.3, 0.8])).toBeCloseTo(-0.3, 10);
    expect(normalizeSentiment({ score: 0.6 })).toBeCloseTo(0.2, 10);
    expect(normalizeSentiment({ positive: 0, negative: 0, neutral: 1 })).toBe(0);
    expect(normalizeSentiment({ good: 0.1, bad: 0.4 })).toBeCloseTo(-0.6, 10);
    expect(normalizeSentiment({})).toBe(0);
  });

  it("computes a recency-weighted average sentiment", () => {
    const now = Date.now();
    const weighted = computeWeightedSentiment([
            { sentiment: 1, publishedAt: new Date(now - 30 * 60 * 1000), url: "https://coindesk.com/article" },
            { sentiment: -1, publishedAt: new Date(now - 36 * 60 * 60 * 1000), url: "https://unknown.com/post" },
        ], now);
        expect(weighted).toBeGreaterThan(0);
        expect(weighted).toBeLessThanOrEqual(1);

        const clamped = computeWeightedSentiment([
        { sentiment: 5, publishedAt: new Date(now), url: "https://cointelegraph.com/article" },
      ], now);
      expect(clamped).toBeLessThanOrEqual(1);
  });

  it("clamps sentiment scores to a safe range", () => {
    expect(clampSentiment(5)).toBe(1);
    expect(clampSentiment(-5)).toBe(-1);
    expect(clampSentiment(0.25)).toBe(0.25);
    expect(clampSentiment(Number.NaN)).toBe(0);
  });
});
