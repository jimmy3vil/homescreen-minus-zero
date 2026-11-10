import { describe, expect, it } from "vitest";
import { matchTypeIndex, sortTitlePrefix, typeMatchCounts } from "../collectionTypeMatch";
import type { CollectionOverview, CollectionTypeDef } from "../collectionFilters";

const coll = (over: Partial<CollectionOverview>): CollectionOverview =>
    ({ labels: [], groups: [], sort_title: "", type: null, ...over }) as CollectionOverview;

const types: CollectionTypeDef[] = [
    { id: 1, name: "Director", color: "violet", labels: ["Director"], prefixes: [], groups: ["Directors' Work"] },
    { id: 2, name: "Franchises", color: "sky", labels: [], prefixes: ["!24"], groups: [] },
];

describe("collection type matching (same rules as the server)", () => {
    it("reads sort-title prefixes", () => {
        expect(sortTitlePrefix("!24 Toy Story")).toBe("!24");
        expect(sortTitlePrefix("!010_Actors Hanks")).toBe("!010");
        expect(sortTitlePrefix("Toy Story")).toBeNull();
    });

    it("uses hand-set, then label, then prefix, then group", () => {
        expect(matchTypeIndex(coll({ labels: ["Director"], sort_title: "!24 X", type: { id: 2, name: "Franchises", color: "sky", source: "manual", matched: null } }), types)).toBe(1);
        expect(matchTypeIndex(coll({ labels: ["Director"], sort_title: "!24 X" }), types)).toBe(0);
        expect(matchTypeIndex(coll({ sort_title: "!24 X" }), types)).toBe(1);
        expect(matchTypeIndex(coll({ groups: ["Directors' Work"] }), types)).toBe(0);
        expect(matchTypeIndex(coll({ sort_title: "Trending" }), types)).toBe(-1);
    });

    it("counts matches and collections with no type", () => {
        const all = [coll({ sort_title: "!24 A" }), coll({ sort_title: "!24 B" }), coll({ labels: ["Director"] }), coll({})];
        expect(typeMatchCounts(all, types)).toEqual({ counts: [1, 2], untyped: 1 });
    });
});
