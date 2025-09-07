// call openrouter ai
import OpenRouter from "openrouter-ai";
import { config } from "./config.js";
const openrouter = new OpenRouter({ apiKey: config.openrouterApiKey });

// OPnenRouter chat completion
export async function callOpenRouter(messages) {
    try {
        const response = await openrouter.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: messages,
        });
        return response.choices[0].message.content;
    } catch (error) {
        console.error("Error calling OpenRouter:", error);
        throw error;
    }
}

// add langchain agent logic here if needed (using openrouter as llm)
// Get context
// do llm analysis and use tolls - search
// return result
export async function runAgent(input) {
    // implement agent logic here
    const context = await getContext(input);
    const analysis = await doLLMAnalysis(context);
    const tooling = await useTools(analysis);
    const result = await doLLMAnalysis(tooling);
    return result;
}

// helper functions
async function getContext(input) {
    // fetch relevant data based on input
    return input;
}

async function doLLMAnalysis(context) {
    // call openrouter with context
    const response = await callOpenRouter([{ role: "user", content: context }]);
    return response;
}

async function useTools(analysis) {
    // implement tool usage logic here
    return "tool usage result";
}  