import { beforeEach, describe, expect, it, vi } from "vitest";


const settingsStore = {};

const getSettingMock = vi.fn((key, fallback) => (key in settingsStore ? settingsStore[key] : fallback));
const setSettingMock = vi.fn((key, value) => {
    settingsStore[key] = value;
    return value;
});
const loadSettingsMock = vi.fn(() => settingsStore);

vi.mock('../../src/settings.js', () => ({
    getSetting: getSettingMock,
    setSetting: setSettingMock,
    loadSettings: loadSettingsMock,
}));

function resetSettingsStore() {
    for (const key of Object.keys(settingsStore)) {
        delete settingsStore[key];
    }
}

describe('tradeLevelsAlert minimum profit integration', () => {
    beforeEach(() => {
        vi.resetModules();
        resetSettingsStore();
        getSettingMock.mockClear();
        setSettingMock.mockClear();
        loadSettingsMock.mockClear();
    });

    it('includes profit details when the ATR target meets the minimum threshold', async () => {
        settingsStore.minimumProfitThreshold = { default: 0.02, users: {} };
        const module = await import("../../src/alerts/tradeLevelsAlert.js");

        const tradeLevelsAlert = module.default;

        const alerts = tradeLevelsAlert({
            lastClose: 100,
            atrSeries: [1],
            equity: 10000,
            riskPct: 0.01,
        });

        expect(alerts).toHaveLength(1);
        expect(alerts[0].msg.startsWith('🎯')).toBe(true);
        expect(alerts[0].msg).toContain('Lucro potencial 2% (mínimo 2%)');
    });

    it('warns when the projected profit is below the configured threshold', async () => {
        settingsStore.minimumProfitThreshold = { default: 0.05, users: {} };
        const module = await import("../../src/alerts/tradeLevelsAlert.js");

        const tradeLevelsAlert = module.default;

        const alerts = tradeLevelsAlert({
            lastClose: 100,
            atrSeries: [1],
            equity: 10000,
            riskPct: 0.01,
        });

        expect(alerts).toHaveLength(1);
        expect(alerts[0].msg.startsWith('⚠️')).toBe(true);
        expect(alerts[0].msg).toContain('Lucro potencial 2% abaixo do mínimo 5%');
    });
});
