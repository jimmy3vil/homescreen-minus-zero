import { useEffect, useRef, useState } from "react";
import { Check, LayoutGrid, List, Loader2, Rows3, TableProperties } from "lucide-react";
import { fetchWithAuth } from "../../utils/api";
import { useItemView, type ItemListKind, type ItemView } from "./listView";
import { details } from "./itemDetails";

// The items a smart collection's rules match, as you build them: a count,
// then pages of items in one of four views.

export type { PreviewItem } from "./itemDetails";
import type { PreviewItem } from "./itemDetails";

type View = ItemView;

// When given, items can be ticked to add to a manual collection
export type ItemSelection = {
    selected: Set<string>;
    existing: Set<string>; // already in the collection: shown ticked, can't be changed
    onChange: (next: Set<string>) => void;
};
const PAGE = 30;

const VIEWS: { key: View; label: string; icon: typeof List }[] = [
    { key: "detailed", label: "Detailed list", icon: TableProperties },
    { key: "compact", label: "Compact list", icon: List },
    { key: "cards", label: "Cards", icon: LayoutGrid },
    { key: "rows", label: "Row", icon: Rows3 },
];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function Poster({ item, className }: { item: PreviewItem; className: string }) {
    return (
        <div className={`overflow-hidden rounded bg-slate-800 ${className}`}>
            {item.poster_url && <img src={item.poster_url} alt="" className="h-full w-full object-cover" loading="lazy" />}
        </div>
    );
}

function Tick({ on, locked }: { on: boolean; locked: boolean }) {
    return (
        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-primary bg-primary" : "border-slate-500 bg-slate-900/70"} ${locked ? "opacity-50" : ""}`}>
            {on && <Check className="h-3 w-3 text-white" />}
        </span>
    );
}

export function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
    return (
        <div className="ml-auto inline-flex rounded-lg border border-slate-700 bg-slate-900 p-0.5">
            {VIEWS.map((v) => (
                <button
                    key={v.key}
                    type="button"
                    onClick={() => onChange(v.key)}
                    title={v.label}
                    aria-pressed={view === v.key}
                    className={`rounded-md p-1.5 transition-colors ${view === v.key ? "bg-primary/20 text-primary" : "text-slate-400 hover:text-slate-200"}`}
                >
                    <v.icon className="h-4 w-4" />
                </button>
            ))}
        </div>
    );
}

export default function MatchPreview({
    library,
    queryJson,
    selection,
    idleMessage = "Finish the rules to see matching items.",
    viewKind = "filters",
}: {
    library: string;
    queryJson: string | null;
    selection?: ItemSelection;
    idleMessage?: string; // shown while there's nothing to look for yet
    viewKind?: ItemListKind; // which list's remembered view this uses
}) {
    const [selectingAll, setSelectingAll] = useState(false);
    const [selectNote, setSelectNote] = useState<string | null>(null);
    const [view, changeView] = useItemView(viewKind);
    const [count, setCount] = useState<number | null>(null);
    const [items, setItems] = useState<PreviewItem[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
    const requestId = useRef(0);

    const fetchPage = async (start: number) => {
        const r = await fetchWithAuth(`/api/collections/${encodeURIComponent(library)}/smart-preview?start=${start}&size=${PAGE}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: queryJson ?? "{}",
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data?.detail ?? "Preview failed");
        return data as { count: number; items: PreviewItem[] };
    };

    // New rules: start again from the first page, after a short pause
    useEffect(() => {
        clearTimeout(timer.current);
        const id = ++requestId.current;
        if (!queryJson) return;
        timer.current = setTimeout(async () => {
            setLoading(true);
            try {
                const data = await fetchPage(0);
                if (id !== requestId.current) return;
                setCount(data.count);
                setItems(data.items);
                setError(null);
            } catch (e) {
                if (id !== requestId.current) return;
                setCount(null);
                setItems([]);
                setError(e instanceof Error ? e.message : String(e));
            } finally {
                if (id === requestId.current) setLoading(false);
            }
        }, 600);
        return () => clearTimeout(timer.current);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queryJson, library]);

    const showMore = async () => {
        const id = requestId.current;
        setLoadingMore(true);
        try {
            const data = await fetchPage(items.length);
            if (id !== requestId.current) return;
            setItems((prev) => [...prev, ...data.items]);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoadingMore(false);
        }
    };


    const isExisting = (key: string) => !!selection?.existing.has(key);
    const isOn = (key: string) => isExisting(key) || !!selection?.selected.has(key);
    const toggle = (key: string) => {
        if (!selection || isExisting(key)) return;
        const next = new Set(selection.selected);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        selection.onChange(next);
    };
    const addKeys = (keys: string[]) => {
        if (!selection) return;
        const next = new Set(selection.selected);
        keys.forEach((k) => !isExisting(k) && next.add(k));
        selection.onChange(next);
    };
    const selectAllMatching = async () => {
        setSelectingAll(true);
        setSelectNote(null);
        try {
            const r = await fetchWithAuth(`/api/collections/${encodeURIComponent(library)}/smart-preview/keys`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: queryJson ?? "{}",
            });
            const data = await r.json();
            if (!r.ok) throw new Error(data?.detail ?? "Couldn't select the matching items");
            addKeys(data.keys);
            if (data.capped) setSelectNote(`Only the first ${plural(data.keys.length, "item")} of ${data.count} were selected`);
        } catch (e) {
            setSelectNote(e instanceof Error ? e.message : String(e));
        } finally {
            setSelectingAll(false);
        }
    };
    // Clickable item wrapper when selecting
    const pickProps = (key: string) =>
        selection
            ? {
                  role: "checkbox" as const,
                  "aria-checked": isOn(key),
                  tabIndex: 0,
                  onClick: () => toggle(key),
                  onKeyDown: (e: React.KeyboardEvent) => {
                      if (e.key === " " || e.key === "Enter") {
                          e.preventDefault();
                          toggle(key);
                      }
                  },
              }
            : {};
    const pickClass = (key: string) =>
        selection ? `cursor-pointer ${isExisting(key) ? "cursor-default" : "hover:bg-slate-800/60"} ${isOn(key) && !isExisting(key) ? "bg-primary/10" : ""}` : "";

    const showing = queryJson && !error && count !== null;
    const label = !showing
        ? null
        : items.length < count
          ? `Showing ${items.length} of ${plural(count, "item")}`
          : `${plural(count, "item")} match`;

    return (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {!queryJson ? (
                    <span className="text-slate-500">{idleMessage}</span>
                ) : error ? (
                    <span className="text-red-400">{error}</span>
                ) : (
                    <span>{label}</span>
                )}
                <ViewToggle view={view} onChange={changeView} />
            </div>

            {selection && showing && count! > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                    <button
                        type="button"
                        onClick={selectAllMatching}
                        disabled={selectingAll}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary/20 px-2.5 py-1 font-semibold text-primary hover:bg-primary/30 disabled:opacity-50"
                    >
                        {selectingAll && <Loader2 className="h-3 w-3 animate-spin" />}
                        Select all {plural(count!, "matching item")}
                    </button>
                    {items.length < count! && (
                        <button
                            type="button"
                            onClick={() => addKeys(items.map((i) => i.rating_key))}
                            title="Only the items loaded so far; Show more loads the next batch"
                            className="rounded-lg border border-slate-700 px-2.5 py-1 text-slate-300 hover:bg-slate-800"
                        >
                            Select {items.length} of {count}
                        </button>
                    )}
                    {selection.selected.size > 0 && (
                        <button type="button" onClick={() => selection.onChange(new Set())} className="rounded-lg border border-slate-700 px-2.5 py-1 text-slate-300 hover:bg-slate-800">
                            Clear selection
                        </button>
                    )}
                    {selectNote && <span className="text-amber-300">{selectNote}</span>}
                </div>
            )}

            {showing && items.length > 0 && (
                <>
                    {view === "detailed" && (
                        <div className="max-h-96 overflow-y-auto divide-y divide-slate-800 rounded-lg border border-slate-800">
                            {items.map((item) => (
                                <div key={item.rating_key} className={`flex items-center gap-3 px-2 py-2 ${pickClass(item.rating_key)}`} {...pickProps(item.rating_key)}>
                                    {selection && <Tick on={isOn(item.rating_key)} locked={isExisting(item.rating_key)} />}
                                    <Poster item={item} className="h-16 w-11 shrink-0" />
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium text-white">{item.title}</p>
                                        <p className="text-xs text-slate-400">{details(item)}</p>
                                        {item.genres.length > 0 && <p className="truncate text-xs text-slate-500">{item.genres.join(", ")}</p>}
                                    </div>
                                    {isExisting(item.rating_key) && <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-400">in collection</span>}
                                </div>
                            ))}
                        </div>
                    )}
                    {view === "compact" && (
                        <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-800 divide-y divide-slate-800">
                            {items.map((item) => (
                                <div key={item.rating_key} className={`flex items-center gap-2 px-3 py-1.5 text-sm ${pickClass(item.rating_key)}`} {...pickProps(item.rating_key)}>
                                    {selection && <Tick on={isOn(item.rating_key)} locked={isExisting(item.rating_key)} />}
                                    <span className="truncate text-white">{item.title}</span>
                                    {item.year && <span className="shrink-0 text-xs text-slate-500">{item.year}</span>}
                                    {isExisting(item.rating_key) && <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-slate-400">in collection</span>}
                                </div>
                            ))}
                        </div>
                    )}
                    {view === "cards" && (
                        <div className="grid max-h-[28rem] grid-cols-3 gap-3 overflow-y-auto sm:grid-cols-5">
                            {items.map((item) => (
                                <div key={item.rating_key} className={`relative rounded ${pickClass(item.rating_key)}`} {...pickProps(item.rating_key)}>
                                    <Poster item={item} className={`aspect-[2/3] w-full ${selection && isOn(item.rating_key) ? "ring-2 ring-primary" : ""}`} />
                                    {selection && <span className="absolute left-1.5 top-1.5"><Tick on={isOn(item.rating_key)} locked={isExisting(item.rating_key)} /></span>}
                                    <p className="mt-1 truncate text-xs text-slate-300" title={item.title}>{item.title}</p>
                                    {item.year && <p className="text-[11px] text-slate-500">{item.year}</p>}
                                </div>
                            ))}
                        </div>
                    )}
                    {view === "rows" && (
                        <div className="flex gap-2 overflow-x-auto pb-1">
                            {items.map((item) => (
                                <div key={item.rating_key} className={`relative w-24 shrink-0 rounded ${pickClass(item.rating_key)}`} {...pickProps(item.rating_key)}>
                                    <Poster item={item} className={`aspect-[2/3] w-full ${selection && isOn(item.rating_key) ? "ring-2 ring-primary" : ""}`} />
                                    {selection && <span className="absolute left-1.5 top-1.5"><Tick on={isOn(item.rating_key)} locked={isExisting(item.rating_key)} /></span>}
                                    <p className="mt-1 truncate text-[11px] text-slate-400" title={item.title}>{item.title}</p>
                                </div>
                            ))}
                        </div>
                    )}
                    {count !== null && items.length < count && (
                        <button
                            type="button"
                            onClick={showMore}
                            disabled={loadingMore}
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                        >
                            {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                            Show more ({plural(Math.min(PAGE, count - items.length), "item")})
                        </button>
                    )}
                </>
            )}
        </div>
    );
}
