import { Team } from "kaibanjs";
import { CFG } from "../config.js";

export function createAgentTeam({ name, agents, tasks, inputs, logLevel }) {
    const env = {};
    if (CFG.openrouterApiKey) {
        env.OPENROUTER_API_KEY = CFG.openrouterApiKey;
    }
    const team = new Team({
        name: name ?? "Crypto Intelligence Desk",
        agents,
        tasks,
        inputs: inputs ?? {},
        logLevel,
        env,
        memory: true,
    });
    const store = team.getStore();
    try {
        const state = store.getState();
        if (state && typeof state.setInputs === "function") {
            state.setInputs(inputs ?? {});
        }
    } catch {
        // Swallow store initialisation issues; downstream consumers read lazily.
    }
    return { team, store };
}
