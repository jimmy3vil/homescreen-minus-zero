import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Edit, Flame, FolderPlus, Hand, Home, Layers, Loader2, Pin, RefreshCcw, Sparkle, Sparkles, Star, Shapes, Trash2, Users } from "lucide-react";
import { fetchWithAuth } from "../../utils/api";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import PinPopover, { type VisibilityOptions } from "./PinPopover";
import type { CollectionOverview, CollectionTypeRef } from "./collectionFilters";
import { typeColor } from "./typeColors";

const TYPE_SOURCE: Record<CollectionTypeRef["source"], string> = {
    manual: "set by hand",
    label: "from label",
    prefix: "from sort-title prefix",
    group: "from group",
};

// Everything a view needs to act on a collection
export type CollectionActions = {
    open: (c: CollectionOverview) => void;
    edit: (c: CollectionOverview) => void;
    remove: (c: CollectionOverview) => void;
    pin: (c: CollectionOverview, v: VisibilityOptions) => void;
    unpin: (c: CollectionOverview) => void;
    pinning: string | null; // rating key being pinned/unpinned
    showAttention: boolean; // a housekeeping filter is on, so always show "needs attention" badges
    filterType: (type: CollectionTypeRef) => void; // clicking a Type badge filters the page by that type
    groups: { name: string; smart: boolean }[]; // this library's groups
    // Selecting several collections for bulk actions
    selecting: boolean;
    isSelected: (c: CollectionOverview) => boolean;
    toggleSelect: (c: CollectionOverview) => void;
    setGroup: (c: CollectionOverview, group: string, member: boolean) => Promise<void>;
};

// Add a collection to, or take it out of, this library's manual groups
function GroupMenu({ collection, actions }: { collection: CollectionOverview; actions: CollectionActions }) {
    const [busy, setBusy] = useState<string | null>(null);
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="p-2 rounded-lg bg-slate-800/70 text-slate-300 hover:bg-slate-700/90 hover:text-white transition-colors"
                    title="Add to group"
                >
                    <FolderPlus size={16} />
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-2 bg-slate-900/95 border-slate-700" onClick={(e) => e.stopPropagation()}>
                <p className="px-2 pb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">Groups in {collection.library}</p>
                {actions.groups.length === 0 ? (
                    <p className="px-2 py-1.5 text-xs text-slate-500">This library has no groups yet.</p>
                ) : (
                    <div className="max-h-64 overflow-y-auto">
                        {actions.groups.map((g) => {
                            const member = collection.groups.includes(g.name);
                            return (
                                <button
                                    key={g.name}
                                    type="button"
                                    disabled={g.smart || busy !== null}
                                    onClick={async () => {
                                        setBusy(g.name);
                                        try {
                                            await actions.setGroup(collection, g.name, !member);
                                        } finally {
                                            setBusy(null);
                                        }
                                    }}
                                    title={g.smart ? "Smart group: its collections come from its rules" : undefined}
                                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:text-slate-500 disabled:hover:bg-transparent"
                                >
                                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${member ? "border-primary bg-primary" : "border-slate-600"}`}>
                                        {busy === g.name ? <Loader2 className="h-3 w-3 animate-spin text-white" /> : member && <Check className="h-3 w-3 text-white" />}
                                    </span>
                                    <span className="flex-1 truncate">{g.name}</span>
                                    {g.smart && <span className="text-[10px] uppercase tracking-wide">smart</span>}
                                </button>
                            );
                        })}
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ------------------------------------------------------------------ lazy loading

function useInView<T extends Element>(rootMargin = "300px") {
    const ref = useRef<T | null>(null);
    const [inView, setInView] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el || inView) return;
        const obs = new IntersectionObserver(([entry]) => entry.isIntersecting && setInView(true), { rootMargin });
        obs.observe(el);
        return () => obs.disconnect();
    }, [inView, rootMargin]);
    return { ref, inView };
}

// Renders a long list a page at a time as you scroll
export function Incremental<T>({ items, pageSize, render }: { items: T[]; pageSize: number; render: (visible: T[]) => React.ReactNode }) {
    const [count, setCount] = useState(pageSize);
    const sentinel = useRef<HTMLDivElement | null>(null);
    const itemsLength = items.length;

    useEffect(() => {
        const el = sentinel.current;
        if (!el) return;
        const obs = new IntersectionObserver(
            ([entry]) => entry.isIntersecting && setCount((c) => Math.min(c + pageSize, itemsLength)),
            { rootMargin: "800px" }
        );
        obs.observe(el);
        return () => obs.disconnect();
    }, [pageSize, itemsLength, count]);

    return (
        <>
            {render(items.slice(0, count))}
            {count < items.length && <div ref={sentinel} className="h-10" />}
        </>
    );
}

// ------------------------------------------------------------------ smart rule summary

type SmartSummary = { match: "all" | "any"; rules: string[]; sort: string | null; limit: number | null };
const summaryCache = new Map<string, Promise<SmartSummary>>();

function loadSummary(library: string, ratingKey: string): Promise<SmartSummary> {
    const key = `${library}/${ratingKey}`;
    if (!summaryCache.has(key)) {
        summaryCache.set(
            key,
            fetchWithAuth(`/api/collections/library/${encodeURIComponent(library)}/collection/${ratingKey}/smart-summary`).then(async (r) => {
                if (!r.ok) throw new Error("Couldn't load the smart filters");
                return r.json();
            })
        );
    }
    return summaryCache.get(key)!;
}

function SmartBadge({ collection }: { collection: CollectionOverview }) {
    const [open, setOpen] = useState(false);
    const [summary, setSummary] = useState<SmartSummary | null>(null);
    const [error, setError] = useState<string | null>(null);

    const show = () => {
        setOpen(true);
        if (!summary && !error) {
            loadSummary(collection.library, collection.rating_key)
                .then(setSummary)
                .catch((e) => setError(String(e.message ?? e)));
        }
    };

    return (
        <span className="relative inline-flex" onMouseEnter={show} onMouseLeave={() => setOpen(false)} onFocus={show} onBlur={() => setOpen(false)} tabIndex={0}>
            <span className="inline-flex items-center gap-1 rounded-md border border-violet-500/30 bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-300">
                <Sparkles className="h-3 w-3" /> Smart
            </span>
            {open && (
                <span className="absolute left-0 top-full z-30 mt-1 w-72 rounded-lg border border-slate-700 bg-slate-900 p-3 text-xs text-slate-200 shadow-xl normal-case tracking-normal font-normal">
                    {error ? (
                        <span className="text-red-400">{error}</span>
                    ) : !summary ? (
                        <span className="flex items-center gap-1.5 text-slate-400"><Loader2 className="h-3 w-3 animate-spin" /> Loading filters…</span>
                    ) : (
                        <span className="block space-y-1">
                            <span className="block text-slate-400">
                                {summary.rules.length ? `Items matching ${summary.match} of:` : "Every item in the library"}
                            </span>
                            {summary.rules.map((r, i) => <span key={i} className="block">• {r}</span>)}
                            {(summary.sort || summary.limit) && (
                                <span className="block pt-1 text-slate-400">
                                    {summary.sort && `Sorted by ${summary.sort}`}
                                    {summary.sort && summary.limit ? " · " : ""}
                                    {summary.limit && `limited to ${plural(summary.limit, "item")}`}
                                </span>
                            )}
                        </span>
                    )}
                </span>
            )}
        </span>
    );
}

// ------------------------------------------------------------------ badges and actions

const DAY_MS = 24 * 60 * 60 * 1000;
const NEW_DAYS = 14;
const UPDATED_DAYS = 7;
const FEW_ITEMS = 5;

const daysSince = (iso: string | null, now: number) => (iso ? (now - new Date(iso).getTime()) / DAY_MS : Infinity);

// Quick-reference badges, in fixed groups and colours:
//   what it is (smart / manual) · where it is now (in rotation, pinned) ·
//   what's happening (trending, new, updated) · groups · needs attention
export function CollectionBadges({
    collection: c,
    compact = false,
    attention: attentionMode = "always",
    onType,
}: {
    collection: CollectionOverview;
    compact?: boolean;
    onType?: (type: CollectionTypeRef) => void;
    // "hover": only while the pointer is over the collection (rows and cards)
    attention?: "always" | "hover";
}) {
    // Fixed when the badge first renders; "new"/"updated" are measured in days, so that's precise enough
    const [now] = useState(() => Date.now());
    const badge = "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide";
    const groups = compact ? c.groups.slice(0, 2) : c.groups;

    const isNew = daysSince(c.added_at, now) <= NEW_DAYS;
    // Updated only once a collection is past its "new" period, so the two never show together
    const isUpdated = !isNew && daysSince(c.latest_item_added_at, now) <= UPDATED_DAYS;

    const screens = [
        c.on_home && { icon: Home, label: "Home" },
        c.on_recommended && { icon: Star, label: "Recommended" },
        c.on_shared && { icon: Users, label: "Friends' Home" },
    ].filter(Boolean) as { icon: typeof Home; label: string }[];

    const attention = [
        c.item_count === 0 && "Empty",
        c.item_count > 0 && c.item_count < FEW_ITEMS && "Few items",
        !c.has_custom_poster && "No poster",
        !c.has_summary && "No summary",
        c.times_rotated === 0 && "Never rotated",
    ].filter(Boolean) as string[];

    return (
        <span className="flex flex-wrap items-center gap-1">
            {/* Collection type: the most prominent badge, in the type's own colour */}
            {c.type && (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onType?.(c.type!);
                    }}
                    title={`Collection type: ${c.type.name} (${TYPE_SOURCE[c.type.source]}${c.type.matched ? `: ${c.type.matched}` : ""}). Click to show this type`}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-bold ${typeColor(c.type.color)} hover:brightness-125`}
                >
                    <Shapes className="h-3 w-3" /> {c.type.name}
                </button>
            )}

            {/* What it is */}
            {c.smart ? (
                <SmartBadge collection={c} />
            ) : (
                <span className={`${badge} border-slate-500/40 bg-slate-700/40 text-slate-300`} title="Items are added by hand">
                    <Hand className="h-3 w-3" /> Manual
                </span>
            )}

            {/* Where it is now */}
            {screens.length > 0 && (
                <span className={`${badge} border-emerald-500/30 bg-emerald-500/15 text-emerald-300`} title={`In rotation now: ${screens.map((x) => x.label).join(", ")}`}>
                    In rotation
                    {screens.map((x) => <x.icon key={x.label} className="h-3 w-3" aria-label={x.label} />)}
                </span>
            )}
            {c.pinned && (
                <span className={`${badge} border-primary/40 bg-primary/15 text-primary`}><Pin className="h-3 w-3" /> Pinned</span>
            )}

            {/* What's happening */}
            {c.trending && (
                <span className={`${badge} border-orange-500/40 bg-orange-500/15 text-orange-300`} title="Among the 10 collections with the most plays per item over the last 30 days">
                    <Flame className="h-3 w-3" /> Trending
                </span>
            )}
            {isNew && (
                <span className={`${badge} border-cyan-500/30 bg-cyan-500/15 text-cyan-300`} title={`Created in the last ${NEW_DAYS} days`}>
                    <Sparkle className="h-3 w-3" /> New
                </span>
            )}
            {isUpdated && (
                <span className={`${badge} border-blue-500/30 bg-blue-500/15 text-blue-300`} title={`Items added in the last ${UPDATED_DAYS} days`}>
                    <RefreshCcw className="h-3 w-3" /> Updated
                </span>
            )}

            {/* Groups: kept together, in a colour used for nothing else */}
            {groups.length > 0 && (
                <span className="inline-flex flex-wrap items-center gap-1">
                    {groups.map((g) => (
                        <span key={g} className={`${badge} border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300 normal-case tracking-normal`} title={`In group: ${g}`}>
                            <Layers className="h-3 w-3" /> {g}
                        </span>
                    ))}
                    {compact && c.groups.length > 2 && (
                        <span className={`${badge} border-fuchsia-500/20 text-fuchsia-300/80 normal-case tracking-normal`} title={c.groups.join(", ")}>
                            +{c.groups.length - 2} groups
                        </span>
                    )}
                </span>
            )}

            {/* Needs attention: outlined */}
            {attention.map((a) => (
                    <span
                        key={a}
                        className={`${badge} border-dashed border-amber-500/50 bg-transparent text-amber-300/90 ${
                            attentionMode === "hover" ? "hidden group-hover/coll:inline-flex group-focus-within/coll:inline-flex" : ""
                        }`}
                    >
                        <AlertTriangle className="h-3 w-3" /> {a}
                    </span>
                ))}
        </span>
    );
}

// While selecting, clicking a collection ticks it instead of opening it
const activate = (c: CollectionOverview, actions: CollectionActions) => (actions.selecting ? actions.toggleSelect(c) : actions.open(c));

function SelectTick({ collection, actions, className = "" }: { collection: CollectionOverview; actions: CollectionActions; className?: string }) {
    if (!actions.selecting) return null;
    const on = actions.isSelected(collection);
    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={on}
            aria-label={`Select ${collection.title}`}
            onClick={(e) => {
                e.stopPropagation();
                actions.toggleSelect(collection);
            }}
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${on ? "border-primary bg-primary" : "border-slate-500 bg-slate-900/80"} ${className}`}
        >
            {on && <Check className="h-3.5 w-3.5 text-white" />}
        </button>
    );
}

function Actions({ collection, actions }: { collection: CollectionOverview; actions: CollectionActions }) {
    if (actions.selecting) return null;
    const btn = "p-2 rounded-lg bg-slate-800/70 text-slate-300 hover:bg-slate-700/90 hover:text-white transition-colors";
    return (
        <span className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <PinPopover
                isPinned={collection.pinned}
                isPinning={actions.pinning === collection.rating_key}
                onPinWithVisibility={(v) => actions.pin(collection, v)}
                onUnpin={() => actions.unpin(collection)}
            />
            <GroupMenu collection={collection} actions={actions} />
            <button type="button" className={btn} title="Edit collection" onClick={() => actions.edit(collection)}>
                <Edit size={16} />
            </button>
            <button type="button" className={`${btn} hover:bg-red-600/80`} title="Delete collection" onClick={() => actions.remove(collection)}>
                <Trash2 size={16} />
            </button>
        </span>
    );
}

// ------------------------------------------------------------------ rows view

type RowItem = { rating_key: string; title: string; year: string | null; poster_url: string | null };
const ROW_PREVIEW = 20;

export function CollectionRow({ collection, actions }: { collection: CollectionOverview; actions: CollectionActions }) {
    const { ref, inView } = useInView<HTMLDivElement>();
    const [items, setItems] = useState<RowItem[] | null>(null);
    const [total, setTotal] = useState<number>(collection.item_count);
    const [error, setError] = useState(false);

    useEffect(() => {
        if (!inView || items) return;
        fetchWithAuth(
            `/api/collections/library/${encodeURIComponent(collection.library)}/collection/${collection.rating_key}/items?limit=${ROW_PREVIEW}`
        )
            .then((r) => (r.ok ? r.json() : Promise.reject()))
            .then((data) => {
                setItems(data.items ?? []);
                setTotal(data.total ?? collection.item_count);
            })
            .catch(() => setError(true));
    }, [inView, items, collection.library, collection.rating_key, collection.item_count]);

    return (
        <div ref={ref} className={`group/coll space-y-2 rounded-xl ${actions.selecting && actions.isSelected(collection) ? "bg-primary/10 ring-1 ring-primary/40 p-2 -m-2" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-3">
                <SelectTick collection={collection} actions={actions} className="mt-1" />
                <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <button type="button" onClick={() => activate(collection, actions)} className="text-lg font-bold text-white hover:text-primary transition-colors text-left">
                            {collection.title}
                        </button>
                        <span className="text-xs text-slate-400">{plural(collection.item_count, "item")}</span>
                    </div>
                    {collection.sort_title !== collection.title && (
                        <p className="text-xs text-slate-500" title="Sort title">{collection.sort_title}</p>
                    )}
                    <CollectionBadges collection={collection} attention={actions.showAttention ? "always" : "hover"} onType={actions.filterType} />
                </div>
                </div>
                <Actions collection={collection} actions={actions} />
            </div>

            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hover-only">
                {error ? (
                    <p className="text-sm text-slate-500 py-6">Couldn't load this collection's items.</p>
                ) : !items ? (
                    Array.from({ length: Math.min(8, Math.max(1, collection.item_count)) }).map((_, i) => (
                        <div key={i} className="w-28 shrink-0 aspect-[2/3] rounded-md bg-slate-800/60 animate-pulse" />
                    ))
                ) : items.length === 0 ? (
                    <p className="text-sm text-slate-500 py-6">This collection has 0 items.</p>
                ) : (
                    <>
                        {items.map((item) => (
                            <div key={item.rating_key} className="w-28 shrink-0">
                                <div className="aspect-[2/3] rounded-md bg-slate-800 overflow-hidden border border-slate-800">
                                    {item.poster_url ? (
                                        <img src={item.poster_url} alt={item.title} className="h-full w-full object-cover" loading="lazy" />
                                    ) : (
                                        <div className="flex h-full items-center justify-center p-2 text-center text-[11px] text-slate-500">{item.title}</div>
                                    )}
                                </div>
                                <p className="mt-1 truncate text-xs text-slate-300" title={item.title}>{item.title}</p>
                                {item.year && <p className="text-[11px] text-slate-500">{item.year}</p>}
                            </div>
                        ))}
                        <button
                            type="button"
                            onClick={() => actions.open(collection)}
                            className="w-28 shrink-0 aspect-[2/3] rounded-md border-2 border-dashed border-slate-700 text-sm font-medium text-slate-400 hover:border-primary/60 hover:text-white transition-colors flex flex-col items-center justify-center gap-1 px-2 text-center"
                        >
                            See all items…
                            <span className="text-xs text-slate-500">{plural(total, "item")}</span>
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

// ------------------------------------------------------------------ cards view

export function CollectionCardView({ collection, actions }: { collection: CollectionOverview; actions: CollectionActions }) {
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => activate(collection, actions)}
            onKeyDown={(e) => { if (e.key === "Enter") activate(collection, actions); }}
            className="group group/coll relative cursor-pointer text-left"
        >
            <div className={`relative aspect-[2/3] overflow-hidden rounded-lg border bg-slate-800 group-hover:border-primary/70 transition-colors ${actions.selecting && actions.isSelected(collection) ? "border-primary ring-2 ring-primary" : "border-slate-700/40"}`}>
                <SelectTick collection={collection} actions={actions} className="absolute left-2 top-2 z-10" />
                {collection.poster_url ? (
                    <img src={collection.poster_url} alt={collection.title} className="h-full w-full object-cover" loading="lazy" />
                ) : (
                    <div className="flex h-full items-center justify-center text-slate-600">No poster</div>
                )}
                <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <Actions collection={collection} actions={actions} />
                </div>
                <span className="absolute bottom-2 right-2 rounded-md bg-slate-900/70 px-2 py-0.5 text-xs text-slate-300">
                    {plural(collection.item_count, "item")}
                </span>
            </div>
            <p className="mt-2 truncate text-sm font-medium text-white" title={collection.title}>{collection.title}</p>
            {collection.sort_title !== collection.title && (
                <p className="truncate text-[11px] text-slate-500" title={`Sort title: ${collection.sort_title}`}>{collection.sort_title}</p>
            )}
            <div className="mt-1"><CollectionBadges collection={collection} compact attention={actions.showAttention ? "always" : "hover"} onType={actions.filterType} /></div>
        </div>
    );
}

// ------------------------------------------------------------------ compact list view

export function CollectionListItem({ collection, actions }: { collection: CollectionOverview; actions: CollectionActions }) {
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => activate(collection, actions)}
            onKeyDown={(e) => { if (e.key === "Enter") activate(collection, actions); }}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2 hover:border-primary/40 cursor-pointer ${actions.selecting && actions.isSelected(collection) ? "border-primary/60 bg-primary/10" : "border-slate-800/60 bg-slate-900/40"}`}
        >
            <SelectTick collection={collection} actions={actions} />
            <div className="h-12 w-8 shrink-0 overflow-hidden rounded bg-slate-800">
                {collection.poster_url && <img src={collection.poster_url} alt="" className="h-full w-full object-cover" loading="lazy" />}
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="truncate text-sm font-semibold text-white">{collection.title}</span>
                    {collection.sort_title !== collection.title && (
                        <span className="truncate text-xs text-slate-500" title="Sort title">{collection.sort_title}</span>
                    )}
                </div>
                <CollectionBadges collection={collection} compact onType={actions.filterType} />
            </div>
            <span className="hidden sm:block shrink-0 text-xs text-slate-400 w-20 text-right">{plural(collection.item_count, "item")}</span>
            <Actions collection={collection} actions={actions} />
        </div>
    );
}
