import { readFile } from "node:fs/promises";
import { google } from "googleapis";
import { CFG } from "./config.js";
import { fetchWithRetry } from "./utils.js";
import { logger, withContext } from "./logger.js";
import {
    googleSheetsAppendAttemptCounter,
    googleSheetsAppendAttemptDurationHistogram,
    googleSheetsAppendCounter,
    googleSheetsAppendFailureCounter,
    googleSheetsAppendFailureDurationHistogram,
    googleSheetsAppendSuccessCounter,
    googleSheetsAppendSuccessDurationHistogram,
} from "./metrics.js";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
let sheetsClientPromise;

function normalizePrivateKey(key) {
    if (typeof key !== "string") {
        return key;
    }
    return key.includes("\\n") ? key.replace(/\\n/g, "\n") : key;
}

async function loadCredentials(config, log) {
    const { credentialsJson, credentialsFile } = config ?? {};

    if (typeof credentialsJson === "string" && credentialsJson.trim() !== "") {
        try {
            const parsed = JSON.parse(credentialsJson);
            if (parsed && typeof parsed === "object") {
                if (parsed.private_key) {
                    parsed.private_key = normalizePrivateKey(parsed.private_key);
                }
                return parsed;
            }
        } catch (error) {
            log.error({ fn: "loadCredentials", err: error }, 'Failed to parse GOOGLE_SHEETS_CREDENTIALS_JSON');
            throw error;
        }
    }

    if (typeof credentialsFile === "string" && credentialsFile.trim() !== "") {
        try {
            const raw = await readFile(credentialsFile, "utf8");
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") {
                if (parsed.private_key) {
                    parsed.private_key = normalizePrivateKey(parsed.private_key);
                }
                return parsed;
            }
        } catch (error) {
            log.error({ fn: "loadCredentials", err: error, credentialsFile }, 'Failed to load Google Sheets credentials file');
            throw error;
        }
    }

    const error = new Error("Google Sheets credentials are not configured");
    log.error({ fn: "loadCredentials", err: error }, 'Missing Google Sheets credentials');
    throw error;
}

export async function loadSheetsClient({ log: providedLog } = {}) {
    const log = providedLog ?? withContext(logger, { fn: "loadSheetsClient" });

    if (sheetsClientPromise) {
        return sheetsClientPromise;
    }

    sheetsClientPromise = (async () => {
        const config = CFG?.googleSheets;
        if (!config?.enabled) {
            const error = new Error("Google Sheets integration is disabled");
            log.warn({ fn: "loadSheetsClient", err: error }, 'Attempted to load Google Sheets client while disabled');
            throw error;
        }

        const credentials = await loadCredentials(config, log);
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: [SHEETS_SCOPE],
        });
        const client = google.sheets({ version: "v4", auth });
        log.info({ fn: "loadSheetsClient" }, 'Initialized Google Sheets client');
        return client;
    })();

    try {
        return await sheetsClientPromise;
    } catch (error) {
        sheetsClientPromise = undefined;
        throw error;
    }
}

export async function appendRows({
    spreadsheetId = CFG?.googleSheets?.spreadsheetId,
    sheetName,
    rows,
    valueInputOption = "USER_ENTERED",
    insertDataOption = "INSERT_ROWS",
    log: providedLog,
} = {}) {
    const log = providedLog ?? withContext(logger, { fn: "appendRows", sheet: sheetName });

    if (!Array.isArray(rows) || rows.length === 0) {
        const error = new Error("rows must be a non-empty array");
        log.error({ fn: "appendRows", err: error, sheet: sheetName }, 'Invalid payload for Google Sheets append');
        throw error;
    }

    if (typeof sheetName !== "string" || sheetName.trim() === "") {
        const error = new Error("sheetName must be provided");
        log.error({ fn: "appendRows", err: error }, 'Missing Google Sheets sheet name');
        throw error;
    }

    if (typeof spreadsheetId !== "string" || spreadsheetId.trim() === "") {
        const error = new Error("spreadsheetId must be provided");
        log.error({ fn: "appendRows", err: error, sheet: sheetName }, 'Missing Google Sheets spreadsheet id');
        throw error;
    }

    const client = await loadSheetsClient({ log });
    const labels = { sheet: sheetName, source: "googleSheets" };
    googleSheetsAppendAttemptCounter.inc(labels);
    const stopAttemptTimer = googleSheetsAppendAttemptDurationHistogram.startTimer(labels);

    try {
        const response = await fetchWithRetry(async () => client.spreadsheets.values.append({
            spreadsheetId,
            range: sheetName,
            valueInputOption,
            insertDataOption,
            requestBody: { values: rows },
        }));
        const duration = stopAttemptTimer();
        googleSheetsAppendSuccessCounter.inc(labels);
        googleSheetsAppendSuccessDurationHistogram.observe(labels, duration);
        googleSheetsAppendCounter.inc(labels, rows.length);
        log.info({ fn: "appendRows", sheet: sheetName, rows: rows.length, duration }, 'Appended rows to Google Sheets');
        return response;
    } catch (error) {
        const duration = stopAttemptTimer();
        googleSheetsAppendFailureCounter.inc(labels);
        googleSheetsAppendFailureDurationHistogram.observe(labels, duration);
        log.error({
            fn: "appendRows",
            err: error,
            sheet: sheetName,
            spreadsheetId,
            rows: rows.length,
            duration,
            valueInputOption,
            insertDataOption,
        }, 'Failed to append rows to Google Sheets');
        throw error;
    }
}

export function resetSheetsClient() {
    sheetsClientPromise = undefined;
}
