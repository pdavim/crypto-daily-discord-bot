export default function priceInfoAlert({ lastClose }) {
    if (lastClose == null) {
        return [];
    }
    return [`💰 Preço: ${lastClose.toFixed(4)}`];
}
