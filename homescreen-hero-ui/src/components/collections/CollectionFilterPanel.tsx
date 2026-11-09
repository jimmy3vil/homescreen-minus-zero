import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { fetchWithAuth } from "../../utils/api";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
    SheetBody,
    SheetFooter,
    SheetCloseButton,
} from "../ui/sheet";
import { InfoTooltip } from "../ui/info-tooltip";
import {
    DATE_OPS,
    NO_GROUP,
    NUM_OPS,
    TEXT_OPS,
    TOTAL_PLAYS_HINT,
    clearAllFilters,
    type CollectionFilters,
    type DateFilter,
    type NumFilter,
    type TextFilter,
} from "./collectionFilters";

const field = "rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary/70";
const sectionTitle = "text-xs font-semibold uppercase tracking-wider text-slate-400";

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
    return (
        <div className="space-y-2">
            <div className="flex items-center gap-1.5">
                <h3 className={sectionTitle}>{title}</h3>
                {hint && <InfoTooltip text={hint} />}
            </div>
            {children}
        </div>
    );
}

function TextRule({ value, onChange, placeholder }: { value?: TextFilter; onChange: (v?: TextFilter) => void; placeholder: string }) {
    const [op, setOp] = useState<TextFilter["op"]>(value?.op ?? "contains");
    return (
        <div className="flex gap-2">
            <select
                value={op}
                onChange={(e) => {
                    const next = e.target.value as TextFilter["op"];
                    setOp(next);
                    if (value?.value) onChange({ op: next, value: value.value });
                }}
                className={field}
            >
                {TEXT_OPS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <input
                value={value?.value ?? ""}
                onChange={(e) => onChange(e.target.value ? { op, value: e.target.value } : undefined)}
                placeholder={placeholder}
                className={`${field} flex-1 min-w-0`}
            />
        </div>
    );
}

function NumRule({ value, onChange, unit }: { value?: NumFilter; onChange: (v?: NumFilter) => void; unit: string }) {
    const [op, setOp] = useState<NumFilter["op"]>(value?.op ?? "gte");
    return (
        <div className="flex items-center gap-2">
            <select
                value={op}
                onChange={(e) => {
                    const next = e.target.value as NumFilter["op"];
                    setOp(next);
                    if (value) onChange({ op: next, value: value.value });
                }}
                className={field}
            >
                {NUM_OPS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <input
                type="number"
                min={0}
                value={value?.value ?? ""}
                onChange={(e) => onChange(e.target.value === "" ? undefined : { op, value: Number(e.target.value) })}
                placeholder="any"
                className={`${field} w-24`}
            />
            <span className="text-sm text-slate-400">{unit}</span>
        </div>
    );
}

function DateRule({ value, onChange }: { value?: DateFilter; onChange: (v?: DateFilter) => void }) {
    const [op, setOp] = useState<DateFilter["op"]>(value?.op ?? "last");
    const relative = op === "last" || op === "not_last";
    return (
        <div className="flex items-center gap-2">
            <select
                value={op}
                onChange={(e) => {
                    const next = e.target.value as DateFilter["op"];
                    const nextRelative = next === "last" || next === "not_last";
                    setOp(next);
                    // Days and dates aren't interchangeable, so switching between them clears the value
                    if (value) onChange(nextRelative === relative ? { op: next, value: value.value } : undefined);
                }}
                className={field}
            >
                {DATE_OPS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            {relative ? (
                <>
                    <input
                        type="number"
                        min={1}
                        value={value?.value ?? ""}
                        onChange={(e) => onChange(e.target.value === "" ? undefined : { op, value: e.target.value })}
                        placeholder="any"
                        className={`${field} w-24`}
                    />
                    <span className="text-sm text-slate-400">days</span>
                </>
            ) : (
                <input
                    type="date"
                    value={value?.value ?? ""}
                    onChange={(e) => onChange(e.target.value ? { op, value: e.target.value } : undefined)}
                    className={field}
                />
            )}
        </div>
    );
}

type SearchItem = { rating_key: string; title: string; year: number | null };

function MoviePicker({ library, value, onChange }: { library: string; value?: { key: string; title: string }; onChange: (v?: { key: string; title: string }) => void }) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<SearchItem[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!query.trim()) return;
        const t = setTimeout(async () => {
            setLoading(true);
            try {
                const r = await fetchWithAuth(`/api/collections/${encodeURIComponent(library)}/search?query=${encodeURIComponent(query.trim())}`);
                const data = r.ok ? await r.json() : { items: [] };
                setResults((data.items ?? []).slice(0, 12));
            } finally {
                setLoading(false);
            }
        }, 300);
        return () => clearTimeout(t);
    }, [query, library]);

    if (value) {
        return (
            <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-white">
                <span className="flex-1 truncate">{value.title}</span>
                <button type="button" onClick={() => onChange(undefined)} className="text-slate-400 hover:text-white" aria-label="Clear movie">
                    <X className="h-4 w-4" />
                </button>
            </div>
        );
    }
    return (
        <div className="space-y-1">
            <div className="relative">
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search this library…" className={`${field} w-full`} />
                {loading && <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-slate-400" />}
            </div>
            {query.trim() && results.length > 0 && (
                <ul className="max-h-48 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800 py-1">
                    {results.map((item) => (
                        <li key={item.rating_key}>
                            <button
                                type="button"
                                onClick={() => {
                                    onChange({ key: item.rating_key, title: item.year ? `${item.title} (${item.year})` : item.title });
                                    setQuery("");
                                    setResults([]);
                                }}
                                className="w-full px-3 py-1.5 text-left text-sm text-white hover:bg-slate-700"
                            >
                                {item.title} {item.year && <span className="text-slate-400">({item.year})</span>}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
    return (
        <label className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
            <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-primary focus:ring-primary/50" />
            {label}
        </label>
    );
}

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    library: string;
    filters: CollectionFilters;
    onChange: (f: CollectionFilters) => void;
    groups: string[];
    labels: string[];
    matchingCount: number;
    totalCount: number;
};

export default function CollectionFilterPanel({ open, onOpenChange, library, filters, onChange, groups, labels, matchingCount, totalCount }: Props) {
    const set = <K extends keyof CollectionFilters>(key: K, value: CollectionFilters[K] | undefined) => {
        const next = { ...filters };
        if (value === undefined || value === false || value === "") delete next[key];
        else next[key] = value as CollectionFilters[K];
        onChange(next);
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent>
                <SheetHeader>
                    <div>
                        <SheetTitle>Filter collections</SheetTitle>
                        <SheetDescription>
                            {matchingCount} of {totalCount} collections in {library} match
                        </SheetDescription>
                    </div>
                    <SheetCloseButton />
                </SheetHeader>
                <SheetBody>
                    <Section title="Title">
                        <TextRule value={filters.title} onChange={(v) => set("title", v)} placeholder="Collection title" />
                    </Section>
                    <Section title="Sort title" hint="Kometa uses sort titles to order and group collections, e.g. '!024 …'">
                        <TextRule value={filters.sortTitle} onChange={(v) => set("sortTitle", v)} placeholder="Sort title" />
                    </Section>

                    <Section title="Type">
                        <select value={filters.kind ?? ""} onChange={(e) => set("kind", (e.target.value || undefined) as CollectionFilters["kind"])} className={`${field} w-full`}>
                            <option value="">Smart and manual collections</option>
                            <option value="smart">Smart collections only</option>
                            <option value="static">Manual collections only</option>
                        </select>
                    </Section>

                    <Section title="Group">
                        <select value={filters.group ?? ""} onChange={(e) => set("group", e.target.value || undefined)} className={`${field} w-full`}>
                            <option value="">Any group, or none</option>
                            <option value={NO_GROUP}>Not in any group</option>
                            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>
                    </Section>

                    <Section title="Label">
                        <select value={filters.label ?? ""} onChange={(e) => set("label", e.target.value || undefined)} className={`${field} w-full`}>
                            <option value="">Any label</option>
                            {labels.map((l) => <option key={l} value={l}>{l}</option>)}
                        </select>
                    </Section>

                    <Section title="Contains movie" hint="Only collections in this library that include the chosen movie or show">
                        <MoviePicker library={library} value={filters.movie} onChange={(v) => set("movie", v)} />
                    </Section>

                    <Section title="Number of items">
                        <NumRule value={filters.items} onChange={(v) => set("items", v)} unit="items" />
                    </Section>

                    <Section title="Date created">
                        <DateRule value={filters.created} onChange={(v) => set("created", v)} />
                    </Section>
                    <Section title="Date modified">
                        <DateRule value={filters.modified} onChange={(v) => set("modified", v)} />
                    </Section>

                    <Section title="Housekeeping">
                        <div className="space-y-2">
                            <Toggle checked={!!filters.empty} onChange={(v) => set("empty", v || undefined)} label="Empty collections (0 items)" />
                            <Toggle checked={!!filters.noSummary} onChange={(v) => set("noSummary", v || undefined)} label="No summary" />
                            <Toggle checked={!!filters.noPoster} onChange={(v) => set("noPoster", v || undefined)} label="No custom poster" />
                        </div>
                    </Section>

                    <Section title="Rotation history">
                        <div className="space-y-2">
                            <NumRule value={filters.timesRotated} onChange={(v) => set("timesRotated", v)} unit="times rotated" />
                            <div className="flex items-center gap-2">
                                <select
                                    value={filters.lastRotated?.op ?? ""}
                                    onChange={(e) =>
                                        set(
                                            "lastRotated",
                                            e.target.value === "never"
                                                ? { op: "never" }
                                                : e.target.value === "older"
                                                  ? { op: "older", days: filters.lastRotated?.days ?? 90 }
                                                  : undefined
                                        )
                                    }
                                    className={field}
                                >
                                    <option value="">Any last rotation</option>
                                    <option value="never">Never rotated</option>
                                    <option value="older">Last rotated more than…</option>
                                </select>
                                {filters.lastRotated?.op === "older" && (
                                    <>
                                        <input
                                            type="number"
                                            min={1}
                                            value={filters.lastRotated.days ?? ""}
                                            onChange={(e) => set("lastRotated", { op: "older", days: Number(e.target.value) || 0 })}
                                            className={`${field} w-20`}
                                        />
                                        <span className="text-sm text-slate-400">days ago</span>
                                    </>
                                )}
                            </div>
                        </div>
                    </Section>

                    <Section title="Total Plays" hint={TOTAL_PLAYS_HINT}>
                        <NumRule value={filters.plays} onChange={(v) => set("plays", v)} unit="plays" />
                    </Section>
                </SheetBody>
                <SheetFooter>
                    <button
                        type="button"
                        onClick={() => onChange(clearAllFilters(filters))}
                        className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700"
                    >
                        Clear all filters
                    </button>
                    <button
                        type="button"
                        onClick={() => onOpenChange(false)}
                        className="ml-auto rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-hover"
                    >
                        Show {matchingCount} collections
                    </button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
}
