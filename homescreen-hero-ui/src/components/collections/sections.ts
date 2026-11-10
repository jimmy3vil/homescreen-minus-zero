// Grouping collections into sections by sort-title prefix
import type { CollectionOverview } from "./collectionFilters";
import { sortTitlePrefix } from "./collectionTypeMatch";

export const OTHER = "__other__";

export type Section = { prefix: string; items: CollectionOverview[] };

// Consecutive runs of the same prefix, in the order given (already sorted)
export function toSections(collections: CollectionOverview[]): Section[] {
    const out: Section[] = [];
    for (const c of collections) {
        const prefix = sortTitlePrefix(c.sort_title) ?? OTHER;
        const last = out[out.length - 1];
        if (last && last.prefix === prefix) last.items.push(c);
        else out.push({ prefix, items: [c] });
    }
    return out;
}
