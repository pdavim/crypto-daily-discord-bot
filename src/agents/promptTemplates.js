export function buildPromptTemplates({ systemMessage, initialMessage }) {
    const system = systemMessage;
    const initial = initialMessage;
    const ensureString = (value) => (typeof value === "string" && value.trim() !== "" ? value : "");
    return {
        SYSTEM_MESSAGE: () => system,
        INITIAL_MESSAGE: ({ context }) => {
            const ctx = ensureString(context);
            if (ctx) {
                return `${initial}\n\nContext:\n${ctx}`;
            }
            return initial;
        },
        INVALID_JSON_FEEDBACK: ({ llmOutput }) => {
            return `The previous response was not valid JSON. Reformat the answer as JSON only. Raw response: ${llmOutput}`;
        },
        INVALID_OUTPUT_SCHEMA_FEEDBACK: ({ llmOutput, outputSchemaError }) => {
            const schemaError = outputSchemaError?.message ?? "Schema validation failed";
            return `The JSON did not match the required schema (${schemaError}). Fix the structure and resend only JSON. Raw response: ${llmOutput}`;
        },
        THOUGHT_WITH_SELF_QUESTION_FEEDBACK: ({ question, thought }) => {
            return `Re-evaluate your reasoning "${thought}" by answering: ${question}`;
        },
        THOUGHT_FEEDBACK: ({ thought }) => {
            return `Refine this line of thought to stay focused on the task objectives: ${thought}`;
        },
        SELF_QUESTION_FEEDBACK: ({ question }) => {
            return `Consider this checkpoint before proceeding: ${question}`;
        },
        TOOL_RESULT_FEEDBACK: ({ toolResult }) => {
            return `Incorporate this tool output into your updated reasoning: ${JSON.stringify(toolResult)}`;
        },
        TOOL_ERROR_FEEDBACK: ({ toolName, error }) => {
            return `Tool ${toolName} failed with ${error.message}. Continue without it and document assumptions.`;
        },
        TOOL_NOT_EXIST_FEEDBACK: ({ toolName }) => {
            return `Tool ${toolName} is unavailable. Proceed using the provided context.`;
        },
        OBSERVATION_FEEDBACK: ({ parsedLLMOutput }) => {
            return `Observation noted: ${parsedLLMOutput.observation ?? "(none)"}. Use it to improve your final answer.`;
        },
        WEIRD_OUTPUT_FEEDBACK: () => {
            return "Your response was unexpected. Produce a concise JSON answer that satisfies the schema.";
        },
        FORCE_FINAL_ANSWER_FEEDBACK: ({ iterations, maxAgentIterations }) => {
            return `You have reached iteration ${iterations} of ${maxAgentIterations}. Deliver the final JSON output now.`;
        },
        WORK_ON_FEEDBACK_FEEDBACK: ({ feedback }) => {
            return `Apply this feedback before responding: ${feedback}`;
        },
    };
}
