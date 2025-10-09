import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import React from "react";
import AlertFeed from "../src/components/AlertFeed.jsx";

describe("AlertFeed", () => {
    it("prioritizes news alerts before other message types", () => {
        const alerts = [
            { id: "1", message: "Trading alert", messageType: "trading", timestamp: "2024-05-01T10:00:00Z" },
            { id: "2", message: "News digest", messageType: "news_digest", timestamp: "2024-05-02T09:00:00Z" },
            { id: "3", message: "Execution alert", messageType: "trading_execution", timestamp: "2024-05-03T08:00:00Z" },
        ];

        render(<AlertFeed alerts={alerts} />);

        const items = screen.getAllByRole("listitem");
        expect(items[0]).toHaveTextContent("News digest");
    });

    it("paginates alerts with ten entries per page", () => {
        const alerts = Array.from({ length: 12 }, (_, index) => ({
            id: `${index + 1}`,
            message: `Alert ${index + 1}`,
            messageType: index === 5 ? "news_digest" : "trading_decision",
            timestamp: new Date(2024, 0, index + 1).toISOString(),
        }));

        render(<AlertFeed alerts={alerts} />);

        expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument();
        const list = screen.getByRole("list");
        expect(within(list).getAllByRole("listitem")).toHaveLength(10);
        expect(screen.queryByText("Alert 2")).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: /Next/ }));

        expect(screen.getByText(/Page 2 of 2/)).toBeInTheDocument();
        const pageTwoList = screen.getByRole("list");
        expect(within(pageTwoList).getAllByRole("listitem")).toHaveLength(2);
        expect(screen.getByText("Alert 2")).toBeInTheDocument();
    });
});
