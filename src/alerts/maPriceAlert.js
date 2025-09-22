export default function maPriceAlert({ ma20, ma50, ma200, lastClose, closes }) {
    const alerts = [];
    const price = lastClose;
    const prevPrice = closes?.at(-2);
    const ma20Val = ma20?.at(-1);
    const ma50Val = ma50?.at(-1);
    const ma200Val = ma200?.at(-1);

    if (price != null && prevPrice != null && ma20Val != null) {
        if (price > ma20Val && prevPrice <= ma20Val) {
            alerts.push("📈 Price crossed above MA20");
        }
        if (price < ma20Val && prevPrice >= ma20Val) {
            alerts.push("📉 Price crossed below MA20");
        }
    }
    if (price != null && prevPrice != null && ma50Val != null) {
        if (price > ma50Val && prevPrice <= ma50Val) {
            alerts.push("📈 Price crossed above MA50");
        }
        if (price < ma50Val && prevPrice >= ma50Val) {
            alerts.push("📉 Price crossed below MA50");
        }
    }
    if (price != null && prevPrice != null && ma200Val != null) {
        if (price > ma200Val && prevPrice <= ma200Val) {
            alerts.push("📈 Price crossed above MA200");
        }
        if (price < ma200Val && prevPrice >= ma200Val) {
            alerts.push("📉 Price crossed below MA200");
        }
    }

    return alerts;
}
