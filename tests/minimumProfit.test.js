import { beforeEach, describe, expect, it, vi } from "vitest";

const CFG = { minimumProfitThreshold: { default: 0.02, users: {} } };
const settingsStore = {};
const getSettingMock = vi.fn((key, fallback) => (key in settingsStore ? settingsStore[key] : fallback));
const setSettingMock = vi.fn((key, value) => {
    settingsStore[key] = value;
    return value;
});

vi.mock("../src/config.js", () => ({ CFG }));
vi.mock("../src/settings.js", () => ({
    getSetting: getSettingMock,
    setSetting: setSettingMock,
}));

describe("minimum profit thresholds", () => {
    beforeEach(() => {
        vi.resetModules();
        Object.keys(settingsStore).forEach(key => { delete settingsStore[key]; });
        CFG.minimumProfitThreshold = { default: 0.02, users: {} };
        getSettingMock.mockClear();
        setSettingMock.mockClear();
    });

    it("evaluates trades against the global threshold", async () => {
        const {
            setDefaultMinimumProfit,
            meetsMinimumProfitThreshold,
        } = await import("../src/minimumProfit.js");

        setDefaultMinimumProfit(0.08);
        expect(meetsMinimumProfitThreshold({ entry: 100, target: 104 })).toBe(false);
        expect(meetsMinimumProfitThreshold({ entry: 100, target: 110 })).toBe(true);
    });

    it("prefers the user-specific threshold when available", async () => {
        const {
            setDefaultMinimumProfit,
            setPersonalMinimumProfit,
            meetsMinimumProfitThreshold,
        } = await import("../src/minimumProfit.js");

        setDefaultMinimumProfit(0.03);
        setPersonalMinimumProfit("user-1", 0.12);

        expect(meetsMinimumProfitThreshold({ entry: 100, target: 107, userId: "user-1" })).toBe(false);
        expect(meetsMinimumProfitThreshold({ entry: 100, target: 115, userId: "user-1" })).toBe(true);
    });

    it("honours ad-hoc thresholds passed to the helper", async () => {
        const { meetsMinimumProfitThreshold } = await import("../src/minimumProfit.js");

        expect(meetsMinimumProfitThreshold({ entry: 100, target: 105, threshold: 0.02 })).toBe(true);
        expect(meetsMinimumProfitThreshold({ entry: 100, target: 101, threshold: 0.02 })).toBe(false);
    });
});
