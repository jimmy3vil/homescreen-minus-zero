import { useEffect, useState } from "react";
import { Check, Loader2, Search } from "lucide-react";
import { fetchWithAuth } from "../../utils/api";
import SmartCollectionBuilder from "../SmartCollectionBuilder";
import type { ItemSelection } from "./MatchPreview";

// Choosing items for a manual collection: a quick title search, or the same
// filters as smart collections. Both tabs share one selection, so you can mix
// them. The filters only find items; the collection keeps exactly what's added.

type SearchItem = { rating_key: string; title: string; year: number | null; thumb: string | null };

type Props = {
    library: string;
    selected: Set<string>;
    onSelectedChange: (next: Set<string>) => void;
    existing?: Set<string>; // items already in the collection
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const NONE = new Set<string>();

function QuickSearch({ library, selection }: { library: string; selection: ItemSelection }) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<SearchItem[]>([]);
    const [loading, setLoading] = useState(false);

    // Empty search lists the library's items, as before
    useEffect(() => {
        let cancelled = false;
        const t = setTimeout(async () => {
            setLoading(true);
            try {
                const params = query.trim() ? `?query=${encodeURIComponent(query.trim())}` : "";
                const r = await fetchWithAuth(`/api/collections/${encodeURIComponent(library)}/search${params}`);
                const data = r.ok ? await r.json() : { items: [] };
                if (!cancelled) setResults(data.items ?? []);
            } finally {
                if (!cancelled) setLoading(false);
            }
        }, 300);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [query, library]);

    const existing = (k: string) => selection.existing.has(k);
    const on = (k: string) => existing(k) || selection.selected.has(k);
    const toggle = (k: string) => {
        if (existing(k)) return;
        const next = new Set(selection.selected);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        selection.onChange(next);
    };
    const selectable = results.filter((r) => !existing(r.rating_key));

    return (
        <div className="space-y-2">
            <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={`Search ${library}…`}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800/60 py-2 pl-9 pr-9 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary/70"
                />
                {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />}
            </div>
            {selectable.length > 0 && (
                <button
                    type="button"
                    onClick={() => selection.onChange(new Set([...selection.selected, ...selectable.map((r) => r.rating_key)]))}
                    className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
                >
                    Select the {plural(selectable.length, "shown item")}
                </button>
            )}
            <div className="grid max-h-[40vh] grid-cols-3 gap-3 overflow-y-auto sm:grid-cols-5">
                {results.map((item) => (
                    <button
                        key={item.rating_key}
                        type="button"
                        onClick={() => toggle(item.rating_key)}
                        disabled={existing(item.rating_key)}
                        className="relative text-left disabled:cursor-default"
                        aria-pressed={on(item.rating_key)}
                    >
                        <div className={`aspect-[2/3] overflow-hidden rounded bg-slate-800 ${on(item.rating_key) ? "ring-2 ring-primary" : ""} ${existing(item.rating_key) ? "opacity-50" : ""}`}>
                            {item.thumb ? (
                                <img src={item.thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                            ) : (
                                <div className="flex h-full items-center justify-center p-1 text-center text-[11px] text-slate-500">{item.title}</div>
                            )}
                        </div>
                        <span className={`absolute left-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded border ${on(item.rating_key) ? "border-primary bg-primary" : "border-slate-500 bg-slate-900/70"}`}>
                            {on(item.rating_key) && <Check className="h-3 w-3 text-white" />}
                        </span>
                        <p className="mt-1 truncate text-xs text-slate-300" title={item.title}>{item.title}</p>
                        <p className="text-[11px] text-slate-500">{existing(item.rating_key) ? "In collection" : item.year}</p>
                    </button>
                ))}
            </div>
            {!loading && results.length === 0 && <p className="text-sm text-slate-500">{query ? "No items match that search" : "No items in this library"}</p>}
        </div>
    );
}

export default function ItemFinder({ library, selected, onSelectedChange, existing = NONE }: Props) {
    const [tab, setTab] = useState<"search" | "filters">("search");
    const selection: ItemSelection = { selected, existing, onChange: onSelectedChange };

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex rounded-lg border border-slate-700 bg-slate-900 p-0.5">
                    {([
                        { key: "search", label: "Quick search" },
                        { key: "filters", label: "Filters" },
                    ] as const).map((t) => (
                        <button
                            key={t.key}
                            type="button"
                            onClick={() => setTab(t.key)}
                            className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${tab === t.key ? "bg-primary/20 text-primary" : "text-slate-400 hover:text-slate-200"}`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
                <span className="text-sm text-slate-300">{plural(selected.size, "item")} selected</span>
                {selected.size > 0 && (
                    <button type="button" onClick={() => onSelectedChange(new Set())} className="text-xs text-primary hover:text-primary/80">
                        Clear selection
                    </button>
                )}
            </div>
            {tab === "filters" && (
                <p className="text-xs text-slate-500">
                    Filters here only find items to add. This collection keeps exactly the items you add and won't change as your library does; use a smart collection for that.
                </p>
            )}
            {/* Both tabs stay mounted so switching keeps searches and rules */}
            <div className={tab === "search" ? "" : "hidden"}>
                <QuickSearch library={library} selection={selection} />
            </div>
            <div className={tab === "filters" ? "" : "hidden"}>
                <SmartCollectionBuilder key={library} library={library} selection={selection} />
            </div>
        </div>
    );
}
