import { useEffect, useRef } from "react";

export function usePolling(callback, { interval = 15000, enabled = true } = {}) {
    const savedCallback = useRef(callback);

    useEffect(() => {
        savedCallback.current = callback;
    }, [callback]);

    useEffect(() => {
        if (!enabled) {
            return () => {};
        }
        let cancelled = false;
        let timeoutId;

        const tick = async () => {
            if (cancelled) {
                return;
            }
            try {
                await savedCallback.current?.();
            } catch (error) {
                console.error("Polling error", error); // eslint-disable-line no-console
            }
            if (!cancelled) {
                timeoutId = setTimeout(tick, interval);
            }
        };

        tick();

        return () => {
            cancelled = true;
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        };
    }, [enabled, interval]);
}
