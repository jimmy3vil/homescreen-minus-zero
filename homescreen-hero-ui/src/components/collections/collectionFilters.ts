// Filter and sort model for the Collections page.
//
// The page works on one library at a time. Everything the user can filter or
// sort on lives in CollectionFilters, which round-trips through the page
// address (so views can be bookmarked) and is remembered per library.

export type CollectionOverview = {
    rating_key: string;
    title: string;
    sort_title: string;
    library: string;
    smart: boolean;
    item_count: number;
    added_at: string | null;
    updated_at: string | null;
    labels: string[];
    has_summary: boolean;
    has_custom_poster: boolean;
    poster_url: string | null;
    on_home: boolean;
    on_recommended: boolean;
    on_shared: boolean;
    in_rotation: boolean;
    pinned: boolean;
    groups: string[];
    times_rotated: number;
    last_rotated_at: string | null;
    total_plays: number | null;
};

export type Scope = "all" | "rotation" | "pinned";
export type TextOp = "contains" | "not_contains" | "is" | "is_not" | "starts" | "ends";
export type NumOp = "eq" | "ne" | "gt" | "gte" | "lt" | "lte";
export type DateOp = "after" | "before" | "last" | "not_last";
export type SortKey = "title" | "sort_title" | "added_at" | "updated_at" | "item_count" | "times_rotated" | "total_plays";

export type TextFilter = { op: TextOp; value: string };
export type NumFilter = { op: NumOp; value: number };
// after/before take a YYYY-MM-DD date; last/not_last take a number of days
export type DateFilter = { op: DateOp; value: string };

export type CollectionFilters = {
    scope: Scope;
    q: string;
    title?: TextFilter;
    sortTitle?: TextFilter;
    kind?: "smart" | "static";
    group?: string; // group name, or NO_GROUP
    label?: string;
    empty?: boolean;
    noSummary?: boolean;
    noPoster?: boolean;
    items?: NumFilter;
    created?: DateFilter;
    modified?: DateFilter;
    movie?: { key: string; title: string };
    plays?: NumFilter;
    timesRotated?: NumFilter;
    lastRotated?: { op: "never" | "older"; days?: number };
    sort: SortKey;
    dir: "asc" | "desc";
};

export const NO_GROUP = "__none__";

export const DEFAULT_FILTERS: CollectionFilters = { scope: "all", q: "", sort: "sort_title", dir: "asc" };

export const TEXT_OPS: { key: TextOp; label: string }[] = [
    { key: "contains", label: "contains" },
    { key: "not_contains", label: "doesn't contain" },
    { key: "is", label: "is exactly" },
    { key: "is_not", label: "is not" },
    { key: "starts", label: "begins with" },
    { key: "ends", label: "ends with" },
];

export const NUM_OPS: { key: NumOp; label: string; symbol: string }[] = [
    { key: "eq", label: "equals", symbol: "=" },
    { key: "ne", label: "doesn't equal", symbol: "≠" },
    { key: "gt", label: "more than", symbol: ">" },
    { key: "gte", label: "at least", symbol: "≥" },
    { key: "lt", label: "fewer than", symbol: "<" },
    { key: "lte", label: "at most", symbol: "≤" },
];

export const DATE_OPS: { key: DateOp; label: string }[] = [
    { key: "last", label: "in the last" },
    { key: "not_last", label: "not in the last" },
    { key: "after", label: "after" },
    { key: "before", label: "before" },
];

export const SORTS: { key: SortKey; label: string }[] = [
    { key: "sort_title", label: "Sort title" },
    { key: "title", label: "Title" },
    { key: "added_at", label: "Date created" },
    { key: "updated_at", label: "Date modified" },
    { key: "item_count", label: "Number of items" },
    { key: "times_rotated", label: "Times rotated" },
    { key: "total_plays", label: "Total Plays" },
];

export const TOTAL_PLAYS_HINT =
    "Total Plays adds up the plays (last 30 days, from Tautulli) of every item in the collection. " +
    "It's only recorded for collections that have been in a rotation.";

// ------------------------------------------------------------------ matching

function matchText(value: string, f: TextFilter): boolean {
    const v = value.toLowerCase();
    const q = f.value.toLowerCase();
    switch (f.op) {
        case "contains": return v.includes(q);
        case "not_contains": return !v.includes(q);
        case "is": return v === q;
        case "is_not": return v !== q;
        case "starts": return v.startsWith(q);
        case "ends": return v.endsWith(q);
    }
}

function matchNum(value: number, f: NumFilter): boolean {
    switch (f.op) {
        case "eq": return value === f.value;
        case "ne": return value !== f.value;
        case "gt": return value > f.value;
        case "gte": return value >= f.value;
        case "lt": return value < f.value;
        case "lte": return value <= f.value;
    }
}

const DAY_MS = 24 * 60 * 60 * 1000;

function matchDate(iso: string | null, f: DateFilter, now: number): boolean {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    if (f.op === "last" || f.op === "not_last") {
        const days = Number(f.value);
        if (!Number.isFinite(days)) return true;
        const inLast = t >= now - days * DAY_MS;
        return f.op === "last" ? inLast : !inLast;
    }
    const bound = new Date(f.value).getTime();
    if (!Number.isFinite(bound)) return true;
    return f.op === "after" ? t > bound : t < bound;
}

export function applyFilters(
    collections: CollectionOverview[],
    f: CollectionFilters,
    movieCollectionTitles: Set<string> | null,
    now = Date.now()
): CollectionOverview[] {
    const q = f.q.trim().toLowerCase();
    return collections.filter((c) => {
        if (f.scope === "rotation" && !c.in_rotation) return false;
        if (f.scope === "pinned" && !c.pinned) return false;
        if (q && !c.title.toLowerCase().includes(q) && !c.sort_title.toLowerCase().includes(q)) return false;
        if (f.title && f.title.value && !matchText(c.title, f.title)) return false;
        if (f.sortTitle && f.sortTitle.value && !matchText(c.sort_title, f.sortTitle)) return false;
        if (f.kind && (f.kind === "smart") !== c.smart) return false;
        if (f.group === NO_GROUP && c.groups.length > 0) return false;
        if (f.group && f.group !== NO_GROUP && !c.groups.includes(f.group)) return false;
        if (f.label && !c.labels.includes(f.label)) return false;
        if (f.empty && c.item_count !== 0) return false;
        if (f.noSummary && c.has_summary) return false;
        if (f.noPoster && c.has_custom_poster) return false;
        if (f.items && !matchNum(c.item_count, f.items)) return false;
        if (f.created && !matchDate(c.added_at, f.created, now)) return false;
        if (f.modified && !matchDate(c.updated_at, f.modified, now)) return false;
        if (f.movie && movieCollectionTitles && !movieCollectionTitles.has(c.title)) return false;
        if (f.plays && !matchNum(c.total_plays ?? 0, f.plays)) return false;
        if (f.timesRotated && !matchNum(c.times_rotated, f.timesRotated)) return false;
        if (f.lastRotated) {
            if (f.lastRotated.op === "never" && c.times_rotated > 0) return false;
            if (f.lastRotated.op === "older") {
                if (!c.last_rotated_at) return false;
                const days = f.lastRotated.days ?? 0;
                if (new Date(c.last_rotated_at).getTime() > now - days * DAY_MS) return false;
            }
        }
        return true;
    });
}

export function sortCollections(collections: CollectionOverview[], sort: SortKey, dir: "asc" | "desc"): CollectionOverview[] {
    const factor = dir === "asc" ? 1 : -1;
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    const value = (c: CollectionOverview): string | number => {
        switch (sort) {
            case "title": return c.title;
            case "sort_title": return c.sort_title;
            case "added_at": return c.added_at ? new Date(c.added_at).getTime() : 0;
            case "updated_at": return c.updated_at ? new Date(c.updated_at).getTime() : 0;
            case "item_count": return c.item_count;
            case "times_rotated": return c.times_rotated;
            case "total_plays": return c.total_plays ?? -1;
        }
    };
    return [...collections].sort((a, b) => {
        const va = value(a);
        const vb = value(b);
        const primary = typeof va === "string" ? collator.compare(va, vb as string) : (va as number) - (vb as number);
        // Ties fall back to sort title so the order is stable
        return primary * factor || collator.compare(a.sort_title, b.sort_title);
    });
}

// ------------------------------------------------------------------ chips

export type FilterKey = Exclude<keyof CollectionFilters, "scope" | "sort" | "dir">;

const textOpLabel = (op: TextOp) => TEXT_OPS.find((o) => o.key === op)?.label ?? op;
const numSymbol = (op: NumOp) => NUM_OPS.find((o) => o.key === op)?.symbol ?? op;
const dateText = (f: DateFilter) =>
    f.op === "last" || f.op === "not_last"
        ? `${f.op === "last" ? "in the last" : "not in the last"} ${f.value} days`
        : `${f.op} ${f.value}`;

// One removable chip per active filter (scope and sort have their own controls)
export function activeFilterChips(f: CollectionFilters): { key: FilterKey; label: string }[] {
    const chips: { key: FilterKey; label: string }[] = [];
    if (f.q.trim()) chips.push({ key: "q", label: `Search: "${f.q.trim()}"` });
    if (f.title?.value) chips.push({ key: "title", label: `Title ${textOpLabel(f.title.op)} "${f.title.value}"` });
    if (f.sortTitle?.value) chips.push({ key: "sortTitle", label: `Sort title ${textOpLabel(f.sortTitle.op)} "${f.sortTitle.value}"` });
    if (f.kind) chips.push({ key: "kind", label: f.kind === "smart" ? "Smart collections" : "Static collections" });
    if (f.group) chips.push({ key: "group", label: f.group === NO_GROUP ? "Not in any group" : `In group: ${f.group}` });
    if (f.label) chips.push({ key: "label", label: `Label: ${f.label}` });
    if (f.empty) chips.push({ key: "empty", label: "Empty (0 items)" });
    if (f.noSummary) chips.push({ key: "noSummary", label: "No summary" });
    if (f.noPoster) chips.push({ key: "noPoster", label: "No custom poster" });
    if (f.items) chips.push({ key: "items", label: `Items ${numSymbol(f.items.op)} ${f.items.value}` });
    if (f.created) chips.push({ key: "created", label: `Created ${dateText(f.created)}` });
    if (f.modified) chips.push({ key: "modified", label: `Modified ${dateText(f.modified)}` });
    if (f.movie) chips.push({ key: "movie", label: `Contains: ${f.movie.title}` });
    if (f.plays) chips.push({ key: "plays", label: `Total Plays ${numSymbol(f.plays.op)} ${f.plays.value}` });
    if (f.timesRotated) chips.push({ key: "timesRotated", label: `Times rotated ${numSymbol(f.timesRotated.op)} ${f.timesRotated.value}` });
    if (f.lastRotated)
        chips.push({
            key: "lastRotated",
            label: f.lastRotated.op === "never" ? "Never rotated" : `Last rotated over ${f.lastRotated.days ?? 0} days ago`,
        });
    return chips;
}

export function clearFilter(f: CollectionFilters, key: FilterKey): CollectionFilters {
    const next = { ...f };
    if (key === "q") next.q = "";
    else delete next[key];
    return next;
}

export function clearAllFilters(f: CollectionFilters): CollectionFilters {
    return { ...DEFAULT_FILTERS, scope: f.scope, sort: f.sort, dir: f.dir };
}

// ------------------------------------------------------------------ URL / storage

const enc = (op: string, value: string | number) => `${op}:${value}`;
const dec = (raw: string | null): [string, string] | null => {
    if (!raw) return null;
    const i = raw.indexOf(":");
    return i < 0 ? null : [raw.slice(0, i), raw.slice(i + 1)];
};

export function filtersToParams(f: CollectionFilters): URLSearchParams {
    const p = new URLSearchParams();
    if (f.scope !== "all") p.set("scope", f.scope);
    if (f.q.trim()) p.set("q", f.q);
    if (f.title?.value) p.set("title", enc(f.title.op, f.title.value));
    if (f.sortTitle?.value) p.set("stitle", enc(f.sortTitle.op, f.sortTitle.value));
    if (f.kind) p.set("kind", f.kind);
    if (f.group) p.set("group", f.group);
    if (f.label) p.set("label", f.label);
    if (f.empty) p.set("empty", "1");
    if (f.noSummary) p.set("nosummary", "1");
    if (f.noPoster) p.set("noposter", "1");
    if (f.items) p.set("items", enc(f.items.op, f.items.value));
    if (f.created) p.set("created", enc(f.created.op, f.created.value));
    if (f.modified) p.set("modified", enc(f.modified.op, f.modified.value));
    if (f.movie) p.set("movie", enc(f.movie.key, f.movie.title));
    if (f.plays) p.set("plays", enc(f.plays.op, f.plays.value));
    if (f.timesRotated) p.set("times", enc(f.timesRotated.op, f.timesRotated.value));
    if (f.lastRotated) p.set("last", f.lastRotated.op === "never" ? "never" : enc("older", f.lastRotated.days ?? 0));
    if (f.sort !== DEFAULT_FILTERS.sort) p.set("sort", f.sort);
    if (f.dir !== DEFAULT_FILTERS.dir) p.set("dir", f.dir);
    return p;
}

const isIn = <T extends string>(v: string, list: readonly { key: T }[]): v is T => list.some((o) => o.key === v);

export function paramsToFilters(p: URLSearchParams): CollectionFilters {
    const f: CollectionFilters = { ...DEFAULT_FILTERS };
    const scope = p.get("scope");
    if (scope === "rotation" || scope === "pinned") f.scope = scope;
    f.q = p.get("q") ?? "";
    const text = (raw: string | null): TextFilter | undefined => {
        const d = dec(raw);
        return d && isIn(d[0], TEXT_OPS) ? { op: d[0], value: d[1] } : undefined;
    };
    const num = (raw: string | null): NumFilter | undefined => {
        const d = dec(raw);
        return d && isIn(d[0], NUM_OPS) && Number.isFinite(Number(d[1])) ? { op: d[0], value: Number(d[1]) } : undefined;
    };
    const date = (raw: string | null): DateFilter | undefined => {
        const d = dec(raw);
        return d && isIn(d[0], DATE_OPS) ? { op: d[0], value: d[1] } : undefined;
    };
    f.title = text(p.get("title"));
    f.sortTitle = text(p.get("stitle"));
    const kind = p.get("kind");
    if (kind === "smart" || kind === "static") f.kind = kind;
    f.group = p.get("group") ?? undefined;
    f.label = p.get("label") ?? undefined;
    if (p.get("empty") === "1") f.empty = true;
    if (p.get("nosummary") === "1") f.noSummary = true;
    if (p.get("noposter") === "1") f.noPoster = true;
    f.items = num(p.get("items"));
    f.created = date(p.get("created"));
    f.modified = date(p.get("modified"));
    const movie = dec(p.get("movie"));
    if (movie) f.movie = { key: movie[0], title: movie[1] };
    f.plays = num(p.get("plays"));
    f.timesRotated = num(p.get("times"));
    const last = p.get("last");
    if (last === "never") f.lastRotated = { op: "never" };
    else {
        const d = dec(last);
        if (d && d[0] === "older") f.lastRotated = { op: "older", days: Number(d[1]) || 0 };
    }
    const sort = p.get("sort");
    if (sort && isIn(sort, SORTS)) f.sort = sort;
    if (p.get("dir") === "desc") f.dir = "desc";
    // Drop undefined keys so chip and equality checks stay simple
    (Object.keys(f) as (keyof CollectionFilters)[]).forEach((k) => f[k] === undefined && delete f[k]);
    return f;
}

const storageKey = (library: string) => `collections.filters.${library}`;

export function loadStoredFilters(library: string): CollectionFilters | null {
    try {
        const raw = localStorage.getItem(storageKey(library));
        return raw === null ? null : paramsToFilters(new URLSearchParams(raw));
    } catch {
        return null;
    }
}

export function storeFilters(library: string, f: CollectionFilters) {
    try {
        localStorage.setItem(storageKey(library), filtersToParams(f).toString());
    } catch {
        // Storage unavailable; filters just won't be remembered
    }
}
