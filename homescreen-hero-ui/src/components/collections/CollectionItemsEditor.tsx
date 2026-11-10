import { useEffect, useState } from "react";
import {
    DndContext,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Image as ImageIcon, Loader2, Plus, Trash2, X } from "lucide-react";
import { fetchWithAuth } from "../../utils/api";
import ItemFinder from "./ItemFinder";
import { Poster, ViewToggle } from "./MatchPreview";
import { details, type PreviewItem } from "./itemDetails";
import { useItemView } from "./listView";

// The items in a manual collection: add from the library, remove, and (when
// the collection's item order is Custom) drag to arrange.

type Item = PreviewItem;

type Props = {
    base: string; // /api/collections/library/{library}/collection/{id}
    library: string;
    customOrder: boolean;
    onChanged: (message: string) => void;
    readOnly?: boolean; // smart collections: items come from filters, so no adding or removing
    collapsibleFinder?: boolean; // show "Add items" as a button that opens the finder
    onItemPoster?: (item: PreviewItem) => void; // offer "Change poster" on each item
    wide?: boolean; // a full page: more cards per row
};

// Per-item actions: change the item's own poster, and remove it
type ItemActionProps = {
    item: Item;
    busy: boolean;
    onRemove?: () => void;
    onPoster?: () => void;
    overlay?: boolean;
};

function ItemActions({ item, busy, onRemove, onPoster, overlay = false }: ItemActionProps) {
    const cls = `p-1.5 disabled:opacity-50 ${overlay ? "rounded-md bg-slate-900/80 text-slate-300" : "text-slate-500"}`;
    return (
        <span className="flex items-center gap-1">
            {onPoster && (
                <button type="button" onClick={onPoster} className={`${cls} hover:text-white`} aria-label={`Change the poster of ${item.title}`} title="Change poster">
                    <ImageIcon className="h-4 w-4" />
                </button>
            )}
            {onRemove && <RemoveButton item={item} busy={busy} onRemove={onRemove} overlay={overlay} />}
        </span>
    );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

async function readError(r: Response, fallback: string) {
    const data = await r.json().catch(() => null);
    return (data && (data.detail || data.message)) || fallback;
}

function RemoveButton({ item, busy, onRemove, overlay = false }: { item: Item; busy: boolean; onRemove: () => void; overlay?: boolean }) {
    return (
        <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className={`p-1.5 disabled:opacity-50 ${overlay ? "rounded-md bg-slate-900/80 text-slate-300 hover:text-red-400" : "text-slate-500 hover:text-red-400"}`}
            aria-label={`Remove ${item.title} from this collection`}
        >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
    );
}

function ItemRow({
    item,
    draggable,
    busy,
    onRemove,
    onPoster,
    compact,
}: {
    item: Item;
    draggable: boolean;
    busy: boolean;
    onRemove?: () => void;
    onPoster?: () => void;
    compact: boolean;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.rating_key, disabled: !draggable });
    return (
        <div
            ref={setNodeRef}
            style={{ transform: CSS.Transform.toString(transform), transition }}
            className={`flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-2 py-1.5 ${isDragging ? "z-10 shadow-xl ring-1 ring-primary/50" : ""}`}
        >
            {draggable && (
                <button type="button" className="cursor-grab touch-none text-slate-500 hover:text-slate-300" aria-label={`Drag ${item.title}`} {...attributes} {...listeners}>
                    <GripVertical className="h-4 w-4" />
                </button>
            )}
            {compact ? (
                <div className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="truncate text-sm text-white">{item.title}</span>
                    {item.year && <span className="shrink-0 text-xs text-slate-500">{item.year}</span>}
                </div>
            ) : (
                <>
                    <Poster item={item} className="h-16 w-11 shrink-0" />
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">{item.title}</p>
                        <p className="text-xs text-slate-400">{details(item)}</p>
                        {item.genres?.length > 0 && <p className="truncate text-xs text-slate-500">{item.genres.join(", ")}</p>}
                    </div>
                </>
            )}
            <ItemActions item={item} busy={busy} onRemove={onRemove} onPoster={onPoster} />
        </div>
    );
}

export default function CollectionItemsEditor({ base, library, customOrder, onChanged, readOnly = false, collapsibleFinder = false, onItemPoster, wide = false }: Props) {
    const [finderOpen, setFinderOpen] = useState(!collapsibleFinder);
    const [items, setItems] = useState<Item[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [removing, setRemoving] = useState<string | null>(null);

    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [adding, setAdding] = useState(false);
    const [view, setView] = useItemView("collection");
    const listView = view === "detailed" || view === "compact";

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const load = async () => {
        try {
            const r = await fetchWithAuth(`${base}/all-items`);
            if (!r.ok) throw new Error(await readError(r, "Couldn't load this collection's items"));
            setItems((await r.json()).items ?? []);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [base]);

    const inCollection = new Set((items ?? []).map((i) => i.rating_key));

    const remove = async (item: Item) => {
        setRemoving(item.rating_key);
        setError(null);
        try {
            const r = await fetchWithAuth(`${base}/items/${item.rating_key}`, { method: "DELETE" });
            if (!r.ok) throw new Error(await readError(r, "Couldn't remove the item"));
            setItems((list) => (list ?? []).filter((i) => i.rating_key !== item.rating_key));
            onChanged(`Removed "${item.title}" from this collection`);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setRemoving(null);
        }
    };

    const addSelected = async () => {
        setAdding(true);
        setError(null);
        try {
            const r = await fetchWithAuth(`${base}/items`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rating_keys: [...selected] }),
            });
            if (!r.ok) throw new Error(await readError(r, "Couldn't add the items"));
            const { added } = await r.json();
            if (added < selected.size) setError(`${plural(selected.size - added, "item")} were already in this collection`);
            setSelected(new Set());
            onChanged(`Added ${plural(added, "item")} to this collection`);
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setAdding(false);
        }
    };

    const onDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;
        if (!items || !over || active.id === over.id) return;
        const from = items.findIndex((i) => i.rating_key === active.id);
        const to = items.findIndex((i) => i.rating_key === over.id);
        const reordered = arrayMove(items, from, to);
        const previous = items;
        setItems(reordered);
        const after = to === 0 ? null : reordered[to - 1].rating_key;
        try {
            const r = await fetchWithAuth(`${base}/items/${active.id}/move`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ after }),
            });
            if (!r.ok) throw new Error(await readError(r, "Couldn't move the item"));
        } catch (e) {
            setItems(previous);
            setError(e instanceof Error ? e.message : String(e));
        }
    };

    return (
        <div className="space-y-5">
            {!readOnly && collapsibleFinder && !finderOpen && (
                <button
                    type="button"
                    onClick={() => setFinderOpen(true)}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-hover"
                >
                    <Plus className="h-4 w-4" /> Add items
                </button>
            )}
            {!readOnly && finderOpen && (
                <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                    <div className="flex items-center justify-between">
                        <span className="block text-xs font-medium uppercase tracking-wider text-slate-400">Add items from {library}</span>
                        {collapsibleFinder && (
                            <button type="button" onClick={() => setFinderOpen(false)} className="text-slate-400 hover:text-white" aria-label="Close Add items">
                                <X className="h-4 w-4" />
                            </button>
                        )}
                    </div>
                    <ItemFinder library={library} selected={selected} onSelectedChange={setSelected} existing={inCollection} />
                    {selected.size > 0 && (
                        <button
                            type="button"
                            onClick={addSelected}
                            disabled={adding}
                            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-bold text-white hover:bg-primary-hover disabled:opacity-50"
                        >
                            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                            Add {plural(selected.size, "item")} to this collection
                        </button>
                    )}
                </div>
            )}
            {readOnly && (
                <p className="text-xs text-slate-500">This is a smart collection: its items come from its filters. Change them in Edit collection, Filters.</p>
            )}

            <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                    <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                        {items ? `${plural(items.length, "item")} in this collection` : "Items in this collection"}
                    </span>
                    <span className="flex items-center gap-2">
                        {items && items.length > 1 && !customOrder && !readOnly && (
                            <span className="text-xs text-slate-500">To arrange by hand, set item order to Custom in Advanced</span>
                        )}
                        {items && items.length > 1 && customOrder && !listView && !readOnly && (
                            <span className="text-xs text-slate-500">Switch to a list view to drag items into order</span>
                        )}
                        <ViewToggle view={view} onChange={setView} />
                    </span>
                </div>
                {error && <p className="text-sm text-red-400">{error}</p>}
                {!items ? (
                    !error && <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading items…</p>
                ) : items.length === 0 ? (
                    <p className="text-sm text-slate-500">This collection has 0 items.</p>
                ) : listView ? (
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                        <SortableContext items={items.map((i) => i.rating_key)} strategy={verticalListSortingStrategy}>
                            <div className="space-y-1.5">
                                {items.map((item) => (
                                    <ItemRow
                                        key={item.rating_key}
                                        item={item}
                                        draggable={customOrder && !readOnly}
                                        compact={view === "compact"}
                                        busy={removing === item.rating_key}
                                        onRemove={readOnly ? undefined : () => remove(item)}
                                        onPoster={onItemPoster ? () => onItemPoster(item) : undefined}
                                    />
                                ))}
                            </div>
                        </SortableContext>
                    </DndContext>
                ) : (
                    <div className={view === "cards" ? `grid grid-cols-3 gap-3 sm:grid-cols-5 ${wide ? "md:grid-cols-6 lg:grid-cols-8" : ""}` : "flex gap-2 overflow-x-auto pb-1"}>
                        {items.map((item) => (
                            <div key={item.rating_key} className={`group relative ${view === "rows" ? "w-24 shrink-0" : ""}`}>
                                <Poster item={item} className="aspect-[2/3] w-full" />
                                <span className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                                    <ItemActions
                                        item={item}
                                        busy={removing === item.rating_key}
                                        onRemove={readOnly ? undefined : () => remove(item)}
                                        onPoster={onItemPoster ? () => onItemPoster(item) : undefined}
                                        overlay
                                    />
                                </span>
                                <p className="mt-1 truncate text-xs text-slate-300" title={item.title}>{item.title}</p>
                                {view === "cards" && item.year && <p className="text-[11px] text-slate-500">{item.year}</p>}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
