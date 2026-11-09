import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Upload, X } from "lucide-react";
import { fetchWithAuth } from "../../utils/api";
import SmartCollectionBuilder, { type InitialSmartQuery, type SmartQuery } from "../SmartCollectionBuilder";
import CollectionItemsEditor from "./CollectionItemsEditor";
import type { CollectionTypeDef, CollectionTypeRef } from "./collectionFilters";
import {
    Sheet,
    SheetBody,
    SheetCloseButton,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "../ui/sheet";

// One panel for editing a collection, static or smart: details and labels,
// artwork, Plex's advanced settings, and a smart collection's filters.

type ArtworkKind = "poster" | "background" | "logo" | "square_art";

type EditData = {
    rating_key: string;
    title: string;
    sort_title: string;
    summary: string;
    labels: string[];
    smart: boolean;
    item_count: number;
    collection_mode: "default" | "hide" | "hideItems" | "showItems";
    collection_sort: "release" | "alpha" | "custom" | null;
    filter_user: "admin" | "user" | null;
    artwork: Record<ArtworkKind, string | null>;
    smart_query: (InitialSmartQuery & { nested: boolean }) | null;
};

type Tab = "details" | "items" | "artwork" | "advanced" | "filters";

type Props = {
    library: string;
    ratingKey: string | null; // null = closed
    currentType: CollectionTypeRef | null; // the collection's type as worked out now
    onClose: () => void;
    onSaved: (message: string) => void;
};

const field =
    "w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary/70";
const label = "block text-xs font-medium uppercase tracking-wider text-slate-400 mb-1.5";
const primaryBtn =
    "inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed";

const ARTWORK: { kind: ArtworkKind; title: string; aspect: string; hint: string }[] = [
    { kind: "poster", title: "Poster", aspect: "aspect-[2/3] w-28", hint: "Portrait, shown in rows and grids" },
    { kind: "background", title: "Background", aspect: "aspect-video w-48", hint: "Wide image behind the collection page" },
    { kind: "logo", title: "Logo", aspect: "aspect-[3/1] w-48", hint: "Title logo, usually a transparent PNG" },
    { kind: "square_art", title: "Square art", aspect: "aspect-square w-28", hint: "Square image used by some Plex apps" },
];

const MODES: { value: EditData["collection_mode"]; label: string; hint: string }[] = [
    { value: "default", label: "Library default", hint: "Follow the library's own setting" },
    { value: "hide", label: "Hide collection", hint: "Show the items in the library, but not the collection" },
    { value: "hideItems", label: "Hide items in this collection", hint: "Show the collection instead of its items" },
    { value: "showItems", label: "Show this collection and its items", hint: "Show both in the library" },
];

async function readError(r: Response, fallback: string) {
    const data = await r.json().catch(() => null);
    return (data && (data.detail || data.message)) || fallback;
}

// ------------------------------------------------------------------ details

type LabelSuggestions = {
    genre: string[];
    studio: string[];
    decade: string[];
    content_rating: string[];
    groups: string[];
    library: string[];
};

const SUGGESTION_ROWS: { key: keyof LabelSuggestions; title: string }[] = [
    { key: "genre", title: "Genre shared by most items" },
    { key: "studio", title: "Studio shared by most items" },
    { key: "decade", title: "Decade shared by most items" },
    { key: "content_rating", title: "Content rating shared by most items" },
    { key: "groups", title: "Groups it's in" },
    { key: "library", title: "Used in this library" },
];

function LabelEditor({
    labels,
    onChange,
    suggestionsUrl,
    types,
    onUseAsType,
}: {
    labels: string[];
    onChange: (l: string[]) => void;
    suggestionsUrl: string;
    types: CollectionTypeDef[];
    // Make collections with this label belong to a type (an existing one by id, or a new one by name)
    onUseAsType: (label: string, target: { id: number } | { name: string }) => void;
}) {
    const [input, setInput] = useState("");
    const [suggestions, setSuggestions] = useState<LabelSuggestions | null>(null);
    const [loadingSuggestions, setLoadingSuggestions] = useState(true);

    useEffect(() => {
        let cancelled = false;
        fetchWithAuth(suggestionsUrl)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => !cancelled && setSuggestions(d))
            .catch(() => !cancelled && setSuggestions(null))
            .finally(() => !cancelled && setLoadingSuggestions(false));
        return () => {
            cancelled = true;
        };
    }, [suggestionsUrl]);

    const has = (v: string) => labels.some((l) => l.toLowerCase() === v.toLowerCase());
    const add = (value: string) => {
        const v = value.trim();
        if (v && !has(v)) onChange([...labels, v]);
        setInput("");
    };

    // Each suggestion appears once, in the first row it belongs to
    const seen = new Set<string>();
    const rows = SUGGESTION_ROWS.map((row) => {
        const values = (suggestions?.[row.key] ?? []).filter((v) => {
            const k = v.toLowerCase();
            if (has(v) || seen.has(k) || (input && !k.includes(input.toLowerCase()))) return false;
            seen.add(k);
            return true;
        });
        return { ...row, values: row.key === "library" ? values.slice(0, 10) : values };
    }).filter((row) => row.values.length > 0);

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
                {labels.length === 0 && <span className="text-sm text-slate-500">No labels</span>}
                {labels.map((l) => (
                    <span key={l} className="inline-flex items-center gap-1 rounded-full border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs text-slate-200">
                        {l}
                        {types.some((t) => t.labels.includes(l)) ? (
                            <span className="text-[10px] text-slate-500" title="Collections with this label get this type">
                                → {types.find((t) => t.labels.includes(l))!.name}
                            </span>
                        ) : (
                            <select
                                value=""
                                onChange={(e) => {
                                    const v = e.target.value;
                                    if (!v) return;
                                    onUseAsType(l, v === "__new__" ? { name: l } : { id: Number(v) });
                                }}
                                className="max-w-[7rem] rounded border-0 bg-transparent py-0 pl-1 pr-6 text-[10px] text-slate-400 focus:ring-0"
                                title="Use this label to give collections a type"
                                aria-label={`Use label ${l} as a collection type`}
                            >
                                <option value="">Use as type…</option>
                                {types.filter((t) => t.id !== null).map((t) => (
                                    <option key={t.id} value={String(t.id)}>{t.name}</option>
                                ))}
                                <option value="__new__">New type "{l}"</option>
                            </select>
                        )}
                        <button type="button" onClick={() => onChange(labels.filter((x) => x !== l))} aria-label={`Remove label ${l}`} className="text-slate-400 hover:text-white">
                            <X className="h-3 w-3" />
                        </button>
                    </span>
                ))}
            </div>
            <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        add(input);
                    }
                }}
                placeholder="Add a label and press Enter"
                className={field}
            />
            <div className="space-y-2">
                <span className="block text-xs text-slate-500">Suggestions: click to add</span>
                {loadingSuggestions ? (
                    <p className="flex items-center gap-1.5 text-xs text-slate-500"><Loader2 className="h-3 w-3 animate-spin" /> Looking at this collection's items…</p>
                ) : rows.length === 0 ? (
                    <p className="text-xs text-slate-500">{input ? "No suggestions match" : "No suggestions for this collection"}</p>
                ) : (
                    rows.map((row) => (
                        <div key={row.key} className="space-y-1">
                            <span className="block text-[11px] text-slate-500">{row.title}</span>
                            <div className="flex flex-wrap gap-1.5">
                                {row.values.map((v) => (
                                    <button key={v} type="button" onClick={() => add(v)} className="rounded-full border border-dashed border-slate-600 px-2.5 py-1 text-xs text-slate-300 hover:border-primary/60 hover:text-white">
                                        + {v}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

// ------------------------------------------------------------------ artwork

type ArtworkOption = { key: string; provider: string | null; selected: boolean; preview_url: string | null };

function ArtworkSlot({
    base,
    kind,
    title,
    hint,
    aspect,
    current,
    onSaved,
}: {
    base: string;
    kind: ArtworkKind;
    title: string;
    hint: string;
    aspect: string;
    current: string | null;
    onSaved: (message: string) => void;
}) {
    const [options, setOptions] = useState<ArtworkOption[] | null>(null);
    const [browsing, setBrowsing] = useState(false);
    const [url, setUrl] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement | null>(null);

    const browse = async () => {
        setBrowsing((b) => !b);
        if (options) return;
        try {
            const r = await fetchWithAuth(`${base}/artwork/${kind}`);
            if (!r.ok) throw new Error(await readError(r, "Couldn't load images from Plex"));
            setOptions((await r.json()).options ?? []);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };

    const send = async (form: FormData, done: string) => {
        setBusy(true);
        setError(null);
        try {
            const r = await fetchWithAuth(`${base}/artwork/${kind}`, { method: "POST", body: form });
            if (!r.ok) throw new Error(await readError(r, `Couldn't set the ${title.toLowerCase()}`));
            setOptions(null);
            setBrowsing(false);
            setUrl("");
            onSaved(done);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="flex items-start gap-4">
                <div className={`${aspect} shrink-0 overflow-hidden rounded-md border border-slate-700 bg-slate-800`}>
                    {current ? (
                        <img src={current} alt={`Current ${title.toLowerCase()}`} className="h-full w-full object-contain" />
                    ) : (
                        <div className="flex h-full items-center justify-center text-[11px] text-slate-500">None</div>
                    )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                    <div>
                        <h4 className="text-sm font-semibold text-white">{title}</h4>
                        <p className="text-xs text-slate-500">{hint}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={browse} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700">
                            {browsing ? "Hide Plex images" : "Choose from Plex"}
                        </button>
                        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50">
                            <Upload className="h-3.5 w-3.5" /> Upload file
                        </button>
                        <input
                            ref={fileRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                e.target.value = "";
                                if (!file) return;
                                const form = new FormData();
                                form.append("file", file);
                                send(form, `${title} uploaded`);
                            }}
                        />
                    </div>
                    <div className="flex gap-2">
                        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="…or paste an image link (https://…)" className={`${field} py-1.5 text-xs`} />
                        <button
                            type="button"
                            disabled={!url.trim() || busy}
                            onClick={() => {
                                const form = new FormData();
                                form.append("url", url.trim());
                                send(form, `${title} set from link`);
                            }}
                            className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover disabled:opacity-50"
                        >
                            Use link
                        </button>
                    </div>
                    {busy && <p className="flex items-center gap-1.5 text-xs text-slate-400"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</p>}
                    {error && <p className="text-xs text-red-400">{error}</p>}
                </div>
            </div>
            {browsing && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                    {options === null ? (
                        <p className="flex items-center gap-1.5 text-xs text-slate-400"><Loader2 className="h-3 w-3 animate-spin" /> Loading images…</p>
                    ) : options.length === 0 ? (
                        <p className="text-xs text-slate-500">Plex has no other {title.toLowerCase()} images for this collection.</p>
                    ) : (
                        options.map((o) => (
                            <button
                                key={o.key}
                                type="button"
                                disabled={busy || o.selected}
                                onClick={() => {
                                    const form = new FormData();
                                    form.append("select", o.key);
                                    send(form, `${title} changed`);
                                }}
                                title={o.provider ? `From ${o.provider}` : undefined}
                                className={`relative ${aspect} shrink-0 overflow-hidden rounded-md border-2 ${o.selected ? "border-primary" : "border-transparent hover:border-slate-500"} bg-slate-800`}
                            >
                                {o.preview_url && <img src={o.preview_url} alt="" className="h-full w-full object-contain" loading="lazy" />}
                                {o.selected && (
                                    <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5"><Check className="h-3 w-3 text-white" /></span>
                                )}
                            </button>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}

// ------------------------------------------------------------------ panel

export default function EditCollectionPanel({ library, ratingKey, currentType, onClose, onSaved }: Props) {
    const [data, setData] = useState<EditData | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [tab, setTab] = useState<Tab>("details");
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    // Editable copies
    const [title, setTitle] = useState("");
    const [sortTitle, setSortTitle] = useState("");
    const [summary, setSummary] = useState("");
    const [labels, setLabels] = useState<string[]>([]);
    const [mode, setMode] = useState<EditData["collection_mode"]>("default");
    const [itemOrder, setItemOrder] = useState<EditData["collection_sort"]>(null);
    const [filterUser, setFilterUser] = useState<EditData["filter_user"]>(null);
    const [smartQuery, setSmartQuery] = useState<SmartQuery | null>(null);
    const [types, setTypes] = useState<CollectionTypeDef[]>([]);
    const [typeSaving, setTypeSaving] = useState(false);
    const typesUrl = `/api/collections/library/${encodeURIComponent(library)}/types`;

    useEffect(() => {
        if (!ratingKey) return;
        fetchWithAuth(typesUrl)
            .then((r) => (r.ok ? r.json() : { types: [] }))
            .then((d) => setTypes(d.types ?? []))
            .catch(() => setTypes([]));
    }, [ratingKey, typesUrl]);

    // Give this collection a type by hand (null = back to automatic)
    const setType = async (typeId: number | null) => {
        setTypeSaving(true);
        setSaveError(null);
        try {
            const r = await fetchWithAuth(`${base}/type`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type_id: typeId }),
            });
            if (!r.ok) throw new Error(await readError(r, "Couldn't set the collection type"));
            const name = types.find((t) => t.id === typeId)?.name;
            onSaved(typeId === null ? "Collection type set back to automatic" : `Collection type set to ${name}`);
        } catch (e) {
            setSaveError(e instanceof Error ? e.message : String(e));
        } finally {
            setTypeSaving(false);
        }
    };

    // Make a label mean a type, for every collection in the library with it
    const useLabelAsType = async (labelName: string, target: { id: number } | { name: string }) => {
        const next: CollectionTypeDef[] =
            "id" in target
                ? types.map((t) => (t.id === target.id ? { ...t, labels: [...t.labels, labelName] } : t))
                : [...types, { id: null, name: target.name, color: "sky", labels: [labelName], prefixes: [], groups: [] }];
        setSaveError(null);
        try {
            const r = await fetchWithAuth(typesUrl, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ types: next }),
            });
            const d = await r.json().catch(() => null);
            if (!r.ok) throw new Error(d?.detail ?? "Couldn't update the collection types");
            setTypes(d.types);
            const typeName = "id" in target ? types.find((t) => t.id === target.id)?.name : target.name;
            onSaved(`Collections labelled "${labelName}" now get the type ${typeName}${labels.includes(labelName) && !(data?.labels ?? []).includes(labelName) ? " (save details to add the label to this collection)" : ""}`);
        } catch (e) {
            setSaveError(e instanceof Error ? e.message : String(e));
        }
    };

    const base = ratingKey ? `/api/collections/library/${encodeURIComponent(library)}/collection/${ratingKey}` : "";

    const load = async () => {
        if (!ratingKey) return;
        setLoadError(null);
        try {
            const r = await fetchWithAuth(`${base}/edit`);
            if (!r.ok) throw new Error(await readError(r, "Couldn't load this collection"));
            const d: EditData = await r.json();
            setData(d);
            setTitle(d.title);
            setSortTitle(d.sort_title);
            setSummary(d.summary);
            setLabels(d.labels);
            setMode(d.collection_mode);
            setItemOrder(d.collection_sort);
            setFilterUser(d.filter_user);
        } catch (e) {
            setLoadError(e instanceof Error ? e.message : String(e));
        }
    };

    useEffect(() => {
        setData(null);
        setTab("details");
        setSaveError(null);
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ratingKey, library]);

    const save = async (path: string, body: unknown, message: string) => {
        setSaving(true);
        setSaveError(null);
        try {
            const r = await fetchWithAuth(`${base}/${path}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!r.ok) throw new Error(await readError(r, "Couldn't save"));
            onSaved(message);
            await load();
        } catch (e) {
            setSaveError(e instanceof Error ? e.message : String(e));
        } finally {
            setSaving(false);
        }
    };

    const detailsChanged =
        !!data && (title !== data.title || sortTitle !== data.sort_title || summary !== data.summary || labels.join("\u0000") !== data.labels.join("\u0000"));
    const advancedChanged = !!data && (mode !== data.collection_mode || itemOrder !== data.collection_sort || filterUser !== data.filter_user);

    const tabs: { key: Tab; label: string }[] = [
        { key: "details", label: "Details" },
        ...(data && !data.smart ? [{ key: "items" as Tab, label: "Items" }] : []),
        ...(data?.smart ? [{ key: "filters" as Tab, label: "Filters" }] : []),
        { key: "artwork", label: "Artwork" },
        { key: "advanced", label: "Advanced" },
    ];

    return (
        <Sheet open={!!ratingKey} onOpenChange={(open) => !open && onClose()}>
            <SheetContent className="w-[720px]">
                <SheetHeader>
                    <div className="min-w-0">
                        <SheetTitle>Edit collection</SheetTitle>
                        <SheetDescription>
                            {data ? `${data.title} · ${data.smart ? "Smart" : "Manual"} collection · ${library}` : "Loading…"}
                        </SheetDescription>
                    </div>
                    <SheetCloseButton />
                </SheetHeader>

                <div className="flex gap-1 border-b border-slate-800 px-5">
                    {tabs.map((t) => (
                        <button
                            key={t.key}
                            type="button"
                            onClick={() => {
                                setTab(t.key);
                                setSaveError(null);
                            }}
                            className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                                tab === t.key ? "border-primary text-white" : "border-transparent text-slate-400 hover:text-slate-200"
                            }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                <SheetBody>
                    {loadError ? (
                        <p className="text-sm text-red-400">{loadError}</p>
                    ) : !data ? (
                        <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading collection…</p>
                    ) : tab === "details" ? (
                        <div className="space-y-5">
                            <div>
                                <label className={label} htmlFor="edit-type">Collection type</label>
                                <div className="flex flex-wrap items-center gap-2">
                                    <select
                                        id="edit-type"
                                        value={currentType?.source === "manual" ? String(currentType.id) : ""}
                                        disabled={typeSaving}
                                        onChange={(e) => setType(e.target.value ? Number(e.target.value) : null)}
                                        className={`${field} pr-10 sm:w-auto`}
                                    >
                                        <option value="">
                                            Automatic{currentType && currentType.source !== "manual" ? `: ${currentType.name}` : ": none matches"}
                                        </option>
                                        {types.filter((t) => t.id !== null).map((t) => (
                                            <option key={t.id} value={String(t.id)}>{t.name}</option>
                                        ))}
                                    </select>
                                    {typeSaving && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                                </div>
                                <p className="mt-1.5 text-xs text-slate-500">
                                    {currentType && currentType.source !== "manual"
                                        ? `Worked out from its ${currentType.source === "prefix" ? "sort-title prefix" : currentType.source} "${currentType.matched}". Choose a type to set it by hand.`
                                        : "Choose a type to set it by hand, or leave on Automatic to use labels, prefixes and groups. Set types up with Collection types on the Collections page."}
                                </p>
                            </div>
                            <div>
                                <label className={label} htmlFor="edit-title">Title</label>
                                <input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
                                {title.trim() !== data.title && (
                                    <p className="mt-1.5 text-xs text-slate-500">Groups and pins that use "{data.title}" will be updated to the new title.</p>
                                )}
                            </div>
                            <div>
                                <label className={label} htmlFor="edit-sort-title">Sort title</label>
                                <input id="edit-sort-title" value={sortTitle} onChange={(e) => setSortTitle(e.target.value)} className={field} />
                                <p className="mt-1.5 text-xs text-slate-500">Plex orders collections by this. Kometa uses prefixes like "!024" here.</p>
                            </div>
                            <div>
                                <label className={label} htmlFor="edit-summary">Summary</label>
                                <textarea id="edit-summary" value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} className={`${field} resize-y`} />
                            </div>
                            <div>
                                <span className={label}>Labels</span>
                                <LabelEditor
                                    labels={labels}
                                    onChange={setLabels}
                                    suggestionsUrl={`${base}/label-suggestions`}
                                    types={types}
                                    onUseAsType={useLabelAsType}
                                />
                            </div>
                        </div>
                    ) : tab === "items" ? (
                        <CollectionItemsEditor
                            base={base}
                            library={library}
                            customOrder={data.collection_sort === "custom"}
                            onChanged={onSaved}
                        />
                    ) : tab === "artwork" ? (
                        <div className="space-y-3">
                            {ARTWORK.map((a) => (
                                <ArtworkSlot
                                    key={`${a.kind}-${data.artwork[a.kind] ?? ""}`}
                                    base={base}
                                    kind={a.kind}
                                    title={a.title}
                                    hint={a.hint}
                                    aspect={a.aspect}
                                    current={data.artwork[a.kind]}
                                    onSaved={(m) => {
                                        onSaved(m);
                                        load();
                                    }}
                                />
                            ))}
                        </div>
                    ) : tab === "advanced" ? (
                        <div className="space-y-6">
                            <div>
                                <span className={label}>Collection mode</span>
                                <div className="space-y-2">
                                    {MODES.map((m) => (
                                        <label key={m.value} className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-800 p-3 hover:border-slate-700">
                                            <input type="radio" name="collection-mode" checked={mode === m.value} onChange={() => setMode(m.value)} className="mt-0.5" />
                                            <span>
                                                <span className="block text-sm text-white">{m.label}</span>
                                                <span className="block text-xs text-slate-500">{m.hint}</span>
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                            {data.smart ? (
                                <div>
                                    <label className={label} htmlFor="edit-filter-user">Filter items using</label>
                                    <select id="edit-filter-user" value={filterUser ?? "admin"} onChange={(e) => setFilterUser(e.target.value as "admin" | "user")} className={`${field} pr-10`}>
                                        <option value="admin">The server admin's access</option>
                                        <option value="user">The viewing user's restrictions</option>
                                    </select>
                                    <p className="mt-1.5 text-xs text-slate-500">With the viewing user's restrictions, each person only sees items their account is allowed to see.</p>
                                </div>
                            ) : (
                                <div>
                                    <label className={label} htmlFor="edit-item-order">Order of items in the collection</label>
                                    <select id="edit-item-order" value={itemOrder ?? "release"} onChange={(e) => setItemOrder(e.target.value as EditData["collection_sort"])} className={`${field} pr-10`}>
                                        <option value="release">Release date</option>
                                        <option value="alpha">Alphabetical</option>
                                        <option value="custom">Custom (as arranged in Plex)</option>
                                    </select>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {data.smart_query && (
                                <SmartCollectionBuilder
                                    key={`${data.rating_key}-${data.smart_query.libtype}`}
                                    library={library}
                                    initial={data.smart_query}
                                    onChange={setSmartQuery}
                                />
                            )}
                        </div>
                    )}
                    {saveError && <p className="text-sm text-red-400">{saveError}</p>}
                </SheetBody>

                {data && tab !== "artwork" && tab !== "items" && (
                    <SheetFooter>
                        <button type="button" onClick={onClose} className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700">
                            Close
                        </button>
                        {tab === "details" && (
                            <button
                                type="button"
                                disabled={saving || !detailsChanged || !title.trim()}
                                onClick={() => save("details", { title, sort_title: sortTitle, summary, labels }, `Saved details for "${title.trim()}"`)}
                                className={`${primaryBtn} ml-auto`}
                            >
                                {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save details
                            </button>
                        )}
                        {tab === "advanced" && (
                            <button
                                type="button"
                                disabled={saving || !advancedChanged}
                                onClick={() =>
                                    save(
                                        "advanced",
                                        {
                                            collection_mode: mode !== data.collection_mode ? mode : null,
                                            collection_sort: !data.smart && itemOrder !== data.collection_sort ? itemOrder : null,
                                            filter_user: data.smart && filterUser !== data.filter_user ? filterUser : null,
                                        },
                                        `Saved advanced settings for "${data.title}"`
                                    )
                                }
                                className={`${primaryBtn} ml-auto`}
                            >
                                {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save settings
                            </button>
                        )}
                        {tab === "filters" && (
                            <button
                                type="button"
                                disabled={saving || !smartQuery}
                                onClick={() => save("smart", smartQuery, `Saved filters for "${data.title}"`)}
                                className={`${primaryBtn} ml-auto`}
                            >
                                {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save filters
                            </button>
                        )}
                    </SheetFooter>
                )}
            </SheetContent>
        </Sheet>
    );
}
