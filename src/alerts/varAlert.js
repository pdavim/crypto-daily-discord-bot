export default function varAlert({ var24h }) {
    if (var24h == null) {
        return [];
    }
    const prefix = var24h > 0 ? '+' : '';
    return [`📊 Var24h: ${prefix}${(var24h * 100).toFixed(2)}%`];
}
