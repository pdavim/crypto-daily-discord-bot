// call openrouter ai
import OpenRouter from "openrouter-ai";
import axios from "axios";
import { config } from "./config.js";
import { ASSETS } from "./assets.js";
import { fetchOHLCV } from "./data/binance.js";
import { sma, rsi } from "./indicators.js";

const openrouter = new OpenRouter({ apiKey: config.openrouterApiKey });


// OPnenRouter chat completion
export async function callOpenRouter(messages) {
    try {
        const response = await openrouter.chat.completions.create({
            model: config.openrouterModel,
            messages: messages,
        });
        return response.choices[0].message.content;
    } catch (error) {
        console.error("Error calling OpenRouter:", error);
        throw error;
    }
}