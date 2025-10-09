import { vi } from "vitest";

class MockTeam {
    constructor(config = {}) {
        this.config = config;
        this.state = {
            inputs: config.inputs ?? {},
            workflowLogs: [],
            getTaskResults: () => ({}),
            setInputs: (inputs) => {
                this.state.inputs = inputs;
            },
        };
    }

    async start() {
        return { status: "COMPLETED", result: null, stats: {} };
    }

    getStore() {
        return { getState: () => this.state };
    }

    useStore() {
        return this.getStore();
    }
}

class MockAgent {
    constructor(config = {}) {
        this.config = config;
    }
}

class MockTask {
    constructor(config = {}) {
        this.config = config;
        this.id = config.id ?? "mock-task";
    }
}

vi.mock("kaibanjs", () => ({
    Agent: MockAgent,
    Task: MockTask,
    Team: MockTeam,
}));
