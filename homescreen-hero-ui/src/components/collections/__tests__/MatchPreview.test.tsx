import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { useState } from "react";

vi.mock("../../../utils/api", () => ({
    fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from "../../../utils/api";
import MatchPreview from "../MatchPreview";

const mockFetch = vi.mocked(fetchWithAuth);

const item = (n: number) => ({
    rating_key: String(n),
    title: `Film ${n}`,
    year: "1999",
    poster_url: null,
    type: "movie",
    content_rating: "PG",
    duration_minutes: 95,
    rating: 7.2,
    genres: ["Comedy"],
    seasons: null,
    episodes: null,
});

function respond(body: unknown) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

function Harness({ onSelected }: { onSelected: (s: Set<string>) => void }) {
    const [selected, setSelected] = useState<Set<string>>(new Set());
    return (
        <MatchPreview
            library="Films"
            queryJson='{"libtype":"movie","rules":[]}'
            selection={{
                selected,
                existing: new Set(["2"]),
                onChange: (next) => {
                    setSelected(next);
                    onSelected(next);
                },
            }}
        />
    );
}

describe("MatchPreview selection", () => {
    beforeEach(() => {
        mockFetch.mockReset();
        try {
            localStorage.removeItem("smartPreview.view");
        } catch {
            // ignore
        }
    });

    it("ticks items, keeps ones already in the collection, and selects all matches", async () => {
        mockFetch.mockImplementation((url: string) =>
            url.includes("/smart-preview/keys")
                ? respond({ count: 40, keys: Array.from({ length: 40 }, (_, i) => String(i + 1)), capped: false })
                : respond({ count: 40, start: 0, items: [item(1), item(2), item(3)] })
        );
        const onSelected = vi.fn();
        render(<Harness onSelected={onSelected} />);

        await waitFor(() => expect(screen.getByText("Film 1")).toBeTruthy(), { timeout: 2000 });
        expect(screen.getByText("Showing 3 of 40 items")).toBeTruthy();
        expect(screen.getByText(/in collection/i)).toBeTruthy();

        // Tick one item
        fireEvent.click(screen.getByText("Film 3"));
        expect([...onSelected.mock.calls.at(-1)![0]]).toEqual(["3"]);

        // An item already in the collection can't be ticked
        fireEvent.click(screen.getByText("Film 2"));
        expect([...onSelected.mock.calls.at(-1)![0]]).toEqual(["3"]);

        // Select all matching: every match except the one already in the collection
        fireEvent.click(screen.getByText("Select all 40 matching items"));
        await waitFor(() => expect(onSelected.mock.calls.at(-1)![0].size).toBe(39));
        expect(onSelected.mock.calls.at(-1)![0].has("2")).toBe(false);
    });
});
