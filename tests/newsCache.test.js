import { describe, expect, it, beforeEach, vi } from "vitest";
import { createHash } from "node:crypto";

const DAY_MS = 24 * 60 * 60 * 1000;

vi.mock("node:fs/promises", () => ({
    readFile: vi.fn(),
    writeFile: vi.fn(),
}));

vi.mock("../src/logger.js", () => {
    const log = {
        error: vi.fn(),
        warn: vi.fn(),
    };
    return {
        logger: log,
        withContext: vi.fn(() => log),
    };
});

const hash = (title, url) =>
    createHash("sha256")
        .update(`${(title ?? "").trim().toLowerCase()}||${(url ?? "").trim()}`)
        .digest("hex");

describe("news cache", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    it("filters out recently seen items and prunes stale cache entries", async () => {
        const now = 1_000_000;
        const staleHash = hash("Old headline", "https://old.example.com");
        const recentHash = hash("Recent headline", "https://recent.example.com");

        const fs = await import("node:fs/promises");
        fs.readFile.mockResolvedValueOnce(
            JSON.stringify({
                [staleHash]: now - DAY_MS - 1,
                [recentHash]: now - 1_000,
            }),
        );
        fs.writeFile.mockResolvedValue();

        const loggerModule = await import("../src/logger.js");

        const { filterFreshNewsItems } = await import("../src/newsCache.js");

        const recentItem = { title: "Recent headline", url: "https://recent.example.com" };
        const newItem = { title: "Brand new", url: "https://fresh.example.com" };
        const anonymousItem = { title: "", description: "missing url" };

        const result = await filterFreshNewsItems(
            [recentItem, newItem, anonymousItem],
            now,
            loggerModule.logger,
        );

        expect(result).toEqual([newItem, anonymousItem]);
        expect(fs.writeFile).toHaveBeenCalledTimes(1);
        const [, persisted] = fs.writeFile.mock.calls[0];
        expect(JSON.parse(persisted)).toEqual({
            [recentHash]: now - 1_000,
        });
        expect(loggerModule.logger.warn).not.toHaveBeenCalled();
    });

    it("marks new items as seen and persists the cache", async () => {
        const now = 2_000_000;
        const fs = await import("node:fs/promises");
        fs.readFile.mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ENOENT" }));
        fs.writeFile.mockResolvedValue();

        const loggerModule = await import("../src/logger.js");

        const { markNewsItemsAsSeen } = await import("../src/newsCache.js");

        const seenItem = { title: "Fresh headline", url: "https://news.example.com" };

        await markNewsItemsAsSeen([seenItem, null, { title: "", url: "" }], now, loggerModule.logger);

        expect(fs.writeFile).toHaveBeenCalledTimes(1);
        const [, payload] = fs.writeFile.mock.calls[0];
        expect(JSON.parse(payload)).toEqual({
            [hash(seenItem.title, seenItem.url)]: now,
        });
        expect(loggerModule.logger.warn).not.toHaveBeenCalled();
        expect(loggerModule.logger.error).not.toHaveBeenCalled();
    });
});
