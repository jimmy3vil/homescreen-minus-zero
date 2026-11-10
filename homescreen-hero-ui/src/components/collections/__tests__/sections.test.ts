import { describe, expect, it } from "vitest";
import { OTHER, toSections } from "../sections";
import type { CollectionOverview } from "../collectionFilters";

const c = (sort_title: string) => ({ sort_title, title: sort_title }) as CollectionOverview;

describe("sort-title sections", () => {
    it("groups consecutive collections by prefix, in the order given", () => {
        const sections = toSections([c("!010_Actors Hanks"), c("!010 Pacino"), c("!024 Lists"), c("Trending"), c("Zombies")]);
        expect(sections.map((s) => [s.prefix, s.items.length])).toEqual([
            ["!010", 2],
            ["!024", 1],
            [OTHER, 2],
        ]);
    });

    it("returns nothing for no collections", () => {
        expect(toSections([])).toEqual([]);
    });
});
