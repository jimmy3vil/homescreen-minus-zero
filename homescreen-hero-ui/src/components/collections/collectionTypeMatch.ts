// The same matching the server does (core/collection_types.py), so the
// Collection types panel can show live "matches N collections" counts while
// types are being edited, before they're saved.
import type { CollectionOverview, CollectionTypeDef } from "./collectionFilters";

const PREFIX = /^([!~#+=^-]*\d[A-Za-z0-9.-]*|[!~#+=^]+[^\s_]*)(?=[\s_])/;

export function sortTitlePrefix(sortTitle: string | null | undefined): string | null {
    if (!sortTitle) return null;
    const m = PREFIX.exec(sortTitle);
    return m ? m[1] : null;
}

// Index of the type a collection would get from these (unsaved) types, or -1.
// A type set by hand stays with that type (matched by id).
export function matchTypeIndex(c: CollectionOverview, types: CollectionTypeDef[]): number {
    if (c.type?.source === "manual") {
        const i = types.findIndex((t) => t.id === c.type!.id);
        if (i >= 0) return i;
    }
    const byLabel = types.findIndex((t) => c.labels.some((l) => t.labels.includes(l)));
    if (byLabel >= 0) return byLabel;
    const prefix = sortTitlePrefix(c.sort_title);
    if (prefix) {
        const byPrefix = types.findIndex((t) => t.prefixes.includes(prefix));
        if (byPrefix >= 0) return byPrefix;
    }
    return types.findIndex((t) => c.groups.some((g) => t.groups.includes(g)));
}

export function typeMatchCounts(collections: CollectionOverview[], types: CollectionTypeDef[]): { counts: number[]; untyped: number } {
    const counts = types.map(() => 0);
    let untyped = 0;
    for (const c of collections) {
        const i = matchTypeIndex(c, types);
        if (i >= 0) counts[i] += 1;
        else untyped += 1;
    }
    return { counts, untyped };
}
