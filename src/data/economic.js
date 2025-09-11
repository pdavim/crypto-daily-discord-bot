import axios from "axios";
import { fetchWithRetry } from "../utils.js";

const BASE = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

export async function fetchEconomicEvents() {
    try {
        const { data } = await fetchWithRetry(() => axios.get(BASE));
        const now = new Date();
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        return data.filter(e => e.impact === "High")
            .filter(e => {
                const dt = new Date(e.date);
                return dt >= now && dt <= tomorrow;
            })
            .map(e => ({
                title: e.title,
                country: e.country,
                date: e.date,
                impact: e.impact
            }));
    } catch (err) {
        console.error("Error fetching economic events:", err.message);
        return [];
    }
}
