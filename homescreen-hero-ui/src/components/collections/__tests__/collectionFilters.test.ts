import { describe, expect, it } from "vitest";
import {
    DEFAULT_FILTERS,
    NO_GROUP,
    activeFilterChips,
    applyFilters,
    clearAllFilters,
    filtersToParams,
    paramsToFilters,
    sortCollections,
    type CollectionFilters,
    type CollectionOverview,
} from "../collectionFilters";

const NOW = new Date("2026-11-09T00:00:00Z").getTime();
const daysAgo = (n: number) => new Date(NOW - n * 86400000).toISOString();

function coll(over: Partial<CollectionOverview>): CollectionOverview {
    return {
        rating_key: over.title ?? "x",
        title: "x",
        sort_title: over.title ?? "x",
        library: "Films",
        smart: false,
        item_count: 5,
        added_at: daysAgo(100),
        updated_at: daysAgo(10),
        labels: [],
        has_summary: true,
        has_custom_poster: true,
        poster_url: null,
        on_home: false,
        on_recommended: false,
        on_shared: false,
        in_rotation: false,
        pinned: false,
        groups: [],
        times_rotated: 0,
        last_rotated_at: null,
        total_plays: null,
        latest_item_added_at: null,
        trending: false,
        ...over,
    };
}

const A = coll({ title: "Spotlight on Al Pacino", sort_title: "!024 Pacino", groups: ["Actors"], labels: ["Kometa"], times_rotated: 3, last_rotated_at: daysAgo(120), total_plays: 40 });
const B = coll({ title: "Trending Films", in_rotation: true, on_recommended: true, pinned: true, smart: true, item_count: 0, has_summary: false, added_at: daysAgo(5) });
const C = coll({ title: "The Work of Wes Anderson", sort_title: "!015 Anderson", has_custom_poster: false, item_count: 12, total_plays: 3 });
const ALL = [A, B, C];

const run = (f: Partial<CollectionFilters>, movie: Set<string> | null = null) =>
    applyFilters(ALL, { ...DEFAULT_FILTERS, ...f }, movie, NOW).map((c) => c.title);

describe("applyFilters", () => {
    it("scopes to rotation or pinned", () => {
        expect(run({ scope: "rotation" })).toEqual(["Trending Films"]);
        expect(run({ scope: "pinned" })).toEqual(["Trending Films"]);
    });

    it("searches title and sort title", () => {
        expect(run({ q: "pacino" })).toEqual(["Spotlight on Al Pacino"]);
        expect(run({ q: "!015" })).toEqual(["The Work of Wes Anderson"]);
    });

    it("applies title and sort title text operators", () => {
        expect(run({ title: { op: "starts", value: "the " } })).toEqual(["The Work of Wes Anderson"]);
        expect(run({ title: { op: "is", value: "trending films" } })).toEqual(["Trending Films"]);
        expect(run({ sortTitle: { op: "not_contains", value: "!0" } })).toEqual(["Trending Films"]);
        expect(run({ sortTitle: { op: "ends", value: "anderson" } })).toEqual(["The Work of Wes Anderson"]);
    });

    it("filters by type, group, label and housekeeping", () => {
        expect(run({ kind: "smart" })).toEqual(["Trending Films"]);
        expect(run({ group: "Actors" })).toEqual(["Spotlight on Al Pacino"]);
        expect(run({ group: NO_GROUP })).toEqual(["Trending Films", "The Work of Wes Anderson"]);
        expect(run({ label: "Kometa" })).toEqual(["Spotlight on Al Pacino"]);
        expect(run({ empty: true })).toEqual(["Trending Films"]);
        expect(run({ noSummary: true })).toEqual(["Trending Films"]);
        expect(run({ noPoster: true })).toEqual(["The Work of Wes Anderson"]);
    });

    it("filters by numbers and dates", () => {
        expect(run({ items: { op: "gt", value: 5 } })).toEqual(["The Work of Wes Anderson"]);
        expect(run({ items: { op: "eq", value: 5 } })).toEqual(["Spotlight on Al Pacino"]);
        expect(run({ created: { op: "last", value: "30" } })).toEqual(["Trending Films"]);
        expect(run({ created: { op: "not_last", value: "30" } })).toEqual(["Spotlight on Al Pacino", "The Work of Wes Anderson"]);
        expect(run({ plays: { op: "gte", value: 10 } })).toEqual(["Spotlight on Al Pacino"]);
        expect(run({ timesRotated: { op: "gte", value: 1 } })).toEqual(["Spotlight on Al Pacino"]);
        expect(run({ lastRotated: { op: "never" } })).toEqual(["Trending Films", "The Work of Wes Anderson"]);
        expect(run({ lastRotated: { op: "older", days: 90 } })).toEqual(["Spotlight on Al Pacino"]);
    });

    it("filters by the collections containing a movie", () => {
        expect(run({ movie: { key: "1", title: "Rushmore" } }, new Set(["The Work of Wes Anderson"]))).toEqual(["The Work of Wes Anderson"]);
    });
});

describe("sortCollections", () => {
    it("sorts by sort title, title and numbers", () => {
        expect(sortCollections(ALL, "sort_title", "asc").map((c) => c.title)).toEqual(["The Work of Wes Anderson", "Spotlight on Al Pacino", "Trending Films"]);
        expect(sortCollections(ALL, "title", "desc").map((c) => c.title)).toEqual(["Trending Films", "The Work of Wes Anderson", "Spotlight on Al Pacino"]);
        expect(sortCollections(ALL, "item_count", "desc")[0].title).toBe("The Work of Wes Anderson");
        expect(sortCollections(ALL, "total_plays", "desc")[0].title).toBe("Spotlight on Al Pacino");
    });
});

describe("URL round trip and chips", () => {
    it("keeps every filter through the page address", () => {
        const f: CollectionFilters = {
            ...DEFAULT_FILTERS,
            scope: "pinned",
            q: "spot",
            title: { op: "contains", value: "on" },
            sortTitle: { op: "starts", value: "!024" },
            kind: "static",
            group: NO_GROUP,
            label: "Kometa",
            empty: true,
            noSummary: true,
            noPoster: true,
            items: { op: "lte", value: 3 },
            created: { op: "after", value: "2024-01-01" },
            modified: { op: "last", value: "7" },
            movie: { key: "42", title: "Heat (1995)" },
            plays: { op: "gt", value: 0 },
            timesRotated: { op: "gte", value: 2 },
            lastRotated: { op: "older", days: 60 },
            sort: "added_at",
            dir: "desc",
        };
        expect(paramsToFilters(filtersToParams(f))).toEqual(f);
        expect(activeFilterChips(f)).toHaveLength(16);
    });

    it("clear all keeps scope and sort", () => {
        const f: CollectionFilters = { ...DEFAULT_FILTERS, scope: "rotation", q: "x", empty: true, sort: "title", dir: "desc" };
        expect(clearAllFilters(f)).toEqual({ ...DEFAULT_FILTERS, scope: "rotation", sort: "title", dir: "desc" });
    });
});
