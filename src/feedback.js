import { query } from "./db.js";
import { logger, withContext } from "./logger.js";
import { feedbackInteractionCounter, feedbackRatingCounter } from "./metrics.js";

const normalizeText = (value) => {
    if (typeof value !== "string") {
        return "";
    }
    return value.trim();
};

const normalizeSources = (sources) => {
    if (!Array.isArray(sources)) {
        return [];
    }
    const normalized = [];
    for (const source of sources) {
        if (typeof source !== "string") {
            continue;
        }
        const trimmed = source.trim();
        if (trimmed === "") {
            continue;
        }
        normalized.push(trimmed);
    }
    return normalized;
};

export const recordInteraction = async ({ question, answer, sources } = {}) => {
    const log = withContext(logger, { fn: "recordInteraction" });
    const normalizedQuestion = normalizeText(question);
    const normalizedAnswer = normalizeText(answer);
    const normalizedSources = normalizeSources(sources);
    if (normalizedQuestion === "") {
        throw new Error("Question must be provided to record an interaction.");
    }
    try {
        const result = await query(
            "INSERT INTO feedback (question, answer, sources) VALUES ($1, $2, $3) RETURNING id;",
            [normalizedQuestion, normalizedAnswer, normalizedSources],
        );
        feedbackInteractionCounter.inc();
        const id = result?.rows?.[0]?.id ?? null;
        log.info({ id, question: normalizedQuestion }, 'Stored ask interaction for feedback');
        return id;
    } catch (error) {
        log.error({ err: error }, 'Failed to record ask interaction');
        throw error;
    }
};

export const recordFeedback = async ({ rating, question, answer, sources } = {}) => {
    const log = withContext(logger, { fn: "recordFeedback" });
    const normalizedRating = normalizeText(rating).toLowerCase();
    if (!["up", "down"].includes(normalizedRating)) {
        throw new Error("Rating must be either 'up' or 'down'.");
    }
    const normalizedQuestion = normalizeText(question);
    const normalizedAnswer = normalizeText(answer);
    if (normalizedQuestion === "" || normalizedAnswer === "") {
        throw new Error("Question and answer are required to record feedback.");
    }
    const normalizedSources = normalizeSources(sources);
    try {
        const params = [normalizedRating, normalizedQuestion, normalizedAnswer, normalizedSources];
        const updateResult = await query(
            "UPDATE feedback SET rating = $1 WHERE id = (SELECT id FROM feedback WHERE question = $2 AND answer = $3 AND sources = $4 ORDER BY created_at DESC LIMIT 1) RETURNING id;",
            params,
        );
        if (!updateResult || updateResult.rowCount === 0) {
            await query(
                "INSERT INTO feedback (question, answer, sources, rating) VALUES ($2, $3, $4, $1);",
                params,
            );
        }
        feedbackRatingCounter.labels(normalizedRating).inc();
        log.info({ rating: normalizedRating, question: normalizedQuestion }, 'Recorded feedback rating');
    } catch (error) {
        log.error({ err: error }, 'Failed to persist feedback rating');
        throw error;
    }
};

export const listApprovedExamples = async () => {
    const log = withContext(logger, { fn: "listApprovedExamples" });
    try {
        const result = await query(
            "SELECT question, answer, sources FROM feedback WHERE approved = TRUE ORDER BY created_at ASC;",
        );
        return (result?.rows ?? []).map((row) => ({
            question: normalizeText(row?.question),
            answer: normalizeText(row?.answer),
            sources: normalizeSources(row?.sources),
        })).filter((entry) => entry.question !== "" && entry.answer !== "");
    } catch (error) {
        log.error({ err: error }, 'Failed to list approved feedback examples');
        throw error;
    }
};

export const __private__ = { normalizeSources, normalizeText };
