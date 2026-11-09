import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Shapes, Trash2, X } from "lucide-react";
import { fetchWithAuth } from "../../utils/api";
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
import { TYPE_COLOR_NAMES, typeColor } from "./typeColors";
import type { CollectionOverview, CollectionTypeDef } from "./collectionFilters";

// The library's collection types: name each one, give it a colour, and choose
// what puts a collection in it (labels, sort-title prefixes, groups).
// Collections can also be given a type by hand in Edit collection.

type Prefix = { prefix: string; count: number; example: string };

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    library: string;
    labels: string[];
    groups: string[];
    prefixes: Prefix[];
    collections: CollectionOverview[];
    onSaved: (message: string) => void;
};

const field =
    "rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary/70";
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function MatchList({
    title,
    hint,
    values,
    options,
    onChange,
    allowCustom,
}: {
    title: string;
    hint: string;
    values: string[];
    options: { value: string; label: string }[];
    onChange: (v: string[]) => void;
    allowCustom?: boolean;
}) {
    const [custom, setCustom] = useState("");
    const available = options.filter((o) => !values.includes(o.value));
    return (
        <div className="space-y-1.5">
            <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</span>
                <span className="text-[11px] text-slate-500">{hint}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
                {values.map((v) => (
                    <span key={v} className="inline-flex items-center gap-1 rounded-full border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs text-slate-200">
                        {v}
                        <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`} className="text-slate-400 hover:text-white">
                            <X className="h-3 w-3" />
                        </button>
                    </span>
                ))}
                {available.length > 0 && (
                    <select
                        value=""
                        onChange={(e) => e.target.value && onChange([...values, e.target.value])}
                        className={`${field} py-1 pr-10 text-xs`}
                    >
                        <option value="">Add…</option>
                        {available.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                    </select>
                )}
                {allowCustom && (
                    <input
                        value={custom}
                        onChange={(e) => setCustom(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && custom.trim()) {
                                e.preventDefault();
                                if (!values.includes(custom.trim())) onChange([...values, custom.trim()]);
                                setCustom("");
                            }
                        }}
                        placeholder="or type one + Enter"
                        className={`${field} w-40 py-1 text-xs`}
                    />
                )}
            </div>
        </div>
    );
}

export default function CollectionTypesPanel({ open, onOpenChange, library, labels, groups, prefixes, collections, onSaved }: Props) {
    const [types, setTypes] = useState<CollectionTypeDef[] | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [dirty, setDirty] = useState(false);

    useEffect(() => {
        if (!open) return;
        setTypes(null);
        setDirty(false);
        setError(null);
        fetchWithAuth(`/api/collections/library/${encodeURIComponent(library)}/types`)
            .then((r) => r.json())
            .then((d) => setTypes(d.types ?? []))
            .catch(() => setError("Couldn't load the collection types"));
    }, [open, library]);

    const update = (i: number, patch: Partial<CollectionTypeDef>) => {
        setTypes((ts) => ts && ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));
        setDirty(true);
    };
    const move = (i: number, by: number) => {
        setTypes((ts) => {
            if (!ts) return ts;
            const next = [...ts];
            const [t] = next.splice(i, 1);
            next.splice(i + by, 0, t);
            return next;
        });
        setDirty(true);
    };

    const save = async () => {
        if (!types) return;
        setSaving(true);
        setError(null);
        try {
            const r = await fetchWithAuth(`/api/collections/library/${encodeURIComponent(library)}/types`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ types }),
            });
            const data = await r.json().catch(() => null);
            if (!r.ok) throw new Error(data?.detail ?? "Couldn't save the collection types");
            setTypes(data.types);
            setDirty(false);
            onSaved(`Saved ${plural(data.types.length, "collection type")} for ${library}`);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setSaving(false);
        }
    };

    const countFor = (id: number | null) => (id === null ? 0 : collections.filter((c) => c.type?.id === id).length);
    const untyped = collections.filter((c) => !c.type).length;

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-[640px]">
                <SheetHeader>
                    <div>
                        <SheetTitle>Collection types</SheetTitle>
                        <SheetDescription>
                            What kind of collection each one is, in {library}. {collections.length > 0 && `${plural(untyped, "collection")} have no type yet.`}
                        </SheetDescription>
                    </div>
                    <SheetCloseButton />
                </SheetHeader>
                <SheetBody>
                    <p className="text-xs text-slate-400">
                        A collection gets the first type that matches, checking in this order: a type set by hand in Edit collection, then labels, then
                        sort-title prefixes, then groups. When two types match the same way, the one higher in this list wins.
                    </p>
                    {error && <p className="text-sm text-red-400">{error}</p>}
                    {!types ? (
                        !error && <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading types…</p>
                    ) : (
                        <div className="space-y-3">
                            {types.length === 0 && <p className="text-sm text-slate-500">No collection types yet.</p>}
                            {types.map((t, i) => (
                                <div key={t.id ?? `new-${i}`} className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-bold ${typeColor(t.color)}`}>
                                            <Shapes className="h-3 w-3" /> {t.name || "New type"}
                                        </span>
                                        <span className="text-xs text-slate-500">{t.id === null ? "not saved yet" : plural(countFor(t.id), "collection")}</span>
                                        <span className="ml-auto flex items-center gap-1">
                                            <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30" aria-label="Move up">
                                                <ArrowUp className="h-4 w-4" />
                                            </button>
                                            <button type="button" disabled={i === types.length - 1} onClick={() => move(i, 1)} className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30" aria-label="Move down">
                                                <ArrowDown className="h-4 w-4" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setTypes((ts) => ts && ts.filter((_, j) => j !== i));
                                                    setDirty(true);
                                                }}
                                                className="p-1.5 text-slate-400 hover:text-red-400"
                                                aria-label={`Delete type ${t.name}`}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-3">
                                        <input value={t.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="Type name, e.g. Director" className={`${field} flex-1 min-w-[12rem]`} />
                                        <div className="flex gap-1">
                                            {TYPE_COLOR_NAMES.map((c) => (
                                                <button
                                                    key={c}
                                                    type="button"
                                                    onClick={() => update(i, { color: c })}
                                                    title={c}
                                                    className={`h-5 w-5 rounded-full border ${typeColor(c)} ${t.color === c ? "ring-2 ring-white" : ""}`}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                    <MatchList
                                        title="Labels"
                                        hint="collections with any of these labels"
                                        values={t.labels}
                                        options={labels.map((l) => ({ value: l, label: l }))}
                                        onChange={(v) => update(i, { labels: v })}
                                        allowCustom
                                    />
                                    <MatchList
                                        title="Sort-title prefixes"
                                        hint="e.g. Kometa's !024"
                                        values={t.prefixes}
                                        options={prefixes.map((p) => ({ value: p.prefix, label: `${p.prefix} · ${plural(p.count, "collection")}, e.g. ${p.example}` }))}
                                        onChange={(v) => update(i, { prefixes: v })}
                                        allowCustom
                                    />
                                    <MatchList
                                        title="Groups"
                                        hint="collections in any of these groups"
                                        values={t.groups}
                                        options={groups.map((g) => ({ value: g, label: g }))}
                                        onChange={(v) => update(i, { groups: v })}
                                    />
                                </div>
                            ))}
                            <button
                                type="button"
                                onClick={() => {
                                    setTypes((ts) => [...(ts ?? []), { id: null, name: "", color: TYPE_COLOR_NAMES[(ts?.length ?? 0) % TYPE_COLOR_NAMES.length], labels: [], prefixes: [], groups: [] }]);
                                    setDirty(true);
                                }}
                                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80"
                            >
                                <Plus className="h-4 w-4" /> Add collection type
                            </button>
                        </div>
                    )}
                </SheetBody>
                <SheetFooter>
                    <button type="button" onClick={() => onOpenChange(false)} className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700">
                        Close
                    </button>
                    <button
                        type="button"
                        onClick={save}
                        disabled={!dirty || saving || !types}
                        className="ml-auto inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-hover disabled:opacity-50"
                    >
                        {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save collection types
                    </button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
}
