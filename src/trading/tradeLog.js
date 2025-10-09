import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve(process.cwd(), 'data');
const LOG_FILE = path.join(DATA_DIR, 'trades.json');

function readLog() {
    if (fs.existsSync(LOG_FILE)) {
        try {
            const txt = fs.readFileSync(LOG_FILE, 'utf8');
            return JSON.parse(txt || '[]');
        } catch {
            return [];
        }
    }
    return [];
}

function writeLog(trades) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LOG_FILE, JSON.stringify(trades, null, 2));
}

export function logTrade(trade) {
    const trades = readLog();
    trades.push({ ...trade, timestamp: Date.now() });
    writeLog(trades);
}

export function logOutcome(id, exitPrice, quantity) {
    const trades = readLog();
    const idx = trades.findIndex(t => t.id === id);
    if (idx !== -1) {
        const t = trades[idx];
        const qty = quantity ?? t.quantity;
        const pnl = (exitPrice - t.entry) * (t.side === 'BUY' ? 1 : -1) * qty;
        trades[idx] = { ...t, exit: exitPrice, pnl, closedAt: Date.now() };
        writeLog(trades);
    }
}

export function getTradeHistory() {
    return readLog().map(trade => ({ ...trade }));
}
