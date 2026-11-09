import { useEffect, useMemo, useRef, useState } from "react";
import { Combobox, ComboboxButton, ComboboxInput, ComboboxOption, ComboboxOptions } from "@headlessui/react";
import { ChevronDown, Loader2, Plus, Trash2 } from "lucide-react";
import { fetchWithAuth } from "../utils/api";

// Mirrors Plex's smart collection editor: pick the item type, match all/any of
// a list of rules (field, operator, value), then an optional sort and limit.
// Fields, operators, sorts and tag values all come from the Plex library.

type SchemaField = { key: string; title: string; type: string; has_choices: boolean };
type Operator = { key: string; title: string };
type Sort = { key: string; title: string; desc_key: string | null };
type Schema = {
    libtype: string;
    libtypes: { key: string; title: string }[];
    fields: SchemaField[];
    operators: Record<string, Operator[]>;
    sorts: Sort[];
};
type Choice = { key: string; title: string };

type Rule = {
    id: number;
    field: string;
    operator: string;
    value: string;
    // For dates: "absolute" (YYYY-MM-DD) or "relative" (N units ago)
    dateMode?: "absolute" | "relative";
    relAmount?: string;
    relUnit?: "d" | "w" | "m" | "y";
};

export type SmartQuery = {
    libtype: string;
    match: "all" | "any";
    rules: { field: string; operator: string; value: string }[];
    sort: string | null;
    limit: number | null;
};

type PreviewItem = { title: string; year: string | null; poster_url: string | null; rating_key: string };

type Props = {
    library: string;
    onChange: (query: SmartQuery | null) => void; // null while the rules are incomplete
};

const inputClass =
    "rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary/70";

let nextRuleId = 1;

function ruleValue(rule: Rule, field: SchemaField | undefined): string {
    if (field?.type === "date" && rule.dateMode === "relative") {
        return rule.relAmount ? `${rule.relAmount}${rule.relUnit ?? "d"}` : "";
    }
    // Plex's true/false fields carry the meaning in the operator ("is true" / "is false")
    if (field?.type === "boolean") return "1";
    return rule.value.trim();
}

function ChoicePicker({
    library,
    libtype,
    field,
    value,
    onChange,
}: {
    library: string;
    libtype: string;
    field: string;
    value: string;
    onChange: (key: string) => void;
}) {
    const [choices, setChoices] = useState<Choice[] | null>(null);
    const [query, setQuery] = useState("");

    // Keyed by field in the parent, so a new field gets a fresh picker
    useEffect(() => {
        let cancelled = false;
        fetchWithAuth(
            `/api/collections/${encodeURIComponent(library)}/smart-filters/choices?field=${encodeURIComponent(field)}&libtype=${encodeURIComponent(libtype)}`
        )
            .then((r) => (r.ok ? r.json() : { choices: [] }))
            .then((data) => !cancelled && setChoices(data.choices ?? []))
            .catch(() => !cancelled && setChoices([]));
        return () => {
            cancelled = true;
        };
    }, [library, libtype, field]);

    const selected = choices?.find((c) => c.key === value) ?? null;
    const filtered = useMemo(() => {
        const q = query.toLowerCase().trim();
        const list = choices ?? [];
        return (q ? list.filter((c) => c.title.toLowerCase().includes(q)) : list).slice(0, 100);
    }, [choices, query]);

    return (
        <Combobox value={selected} onChange={(c: Choice | null) => onChange(c?.key ?? "")} onClose={() => setQuery("")}>
            <div className="relative flex-1 min-w-[10rem]">
                <ComboboxInput
                    className={`${inputClass} w-full pr-8`}
                    displayValue={(c: Choice | null) => c?.title ?? ""}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={choices === null ? "Loading…" : "Type to search…"}
                />
                <ComboboxButton className="absolute inset-y-0 right-0 flex items-center pr-2">
                    <ChevronDown className="h-4 w-4 text-slate-400" />
                </ComboboxButton>
                <ComboboxOptions
                    anchor="bottom start"
                    className="z-50 w-[var(--input-width)] max-h-60 overflow-auto rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-lg empty:invisible"
                >
                    {filtered.map((c) => (
                        <ComboboxOption
                            key={c.key}
                            value={c}
                            className="cursor-pointer px-3 py-1.5 text-sm text-white data-[focus]:bg-slate-700 data-[selected]:font-semibold"
                        >
                            {c.title}
                        </ComboboxOption>
                    ))}
                </ComboboxOptions>
            </div>
        </Combobox>
    );
}

export default function SmartCollectionBuilder({ library, onChange }: Props) {
    const [schema, setSchema] = useState<Schema | null>(null);
    const [schemaError, setSchemaError] = useState<string | null>(null);
    const [libtype, setLibtype] = useState<string | null>(null);
    const [match, setMatch] = useState<"all" | "any">("all");
    const [rules, setRules] = useState<Rule[]>([]);
    const [sortKey, setSortKey] = useState<string>("");
    const [sortDesc, setSortDesc] = useState(false);
    const [limit, setLimit] = useState<string>("");

    const [preview, setPreview] = useState<{ count: number; items: PreviewItem[] } | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const previewTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

    // Load fields/operators/sorts for this library and item type
    useEffect(() => {
        let cancelled = false;
        setSchema(null);
        setSchemaError(null);
        const qs = libtype ? `?libtype=${encodeURIComponent(libtype)}` : "";
        fetchWithAuth(`/api/collections/${encodeURIComponent(library)}/smart-filters${qs}`)
            .then(async (r) => {
                if (!r.ok) throw new Error((await r.json().catch(() => null))?.detail ?? "Couldn't load filters");
                return r.json();
            })
            .then((data: Schema) => {
                if (cancelled) return;
                setSchema(data);
                if (!libtype) setLibtype(data.libtype);
            })
            .catch((e) => !cancelled && setSchemaError(String(e.message ?? e)));
        return () => {
            cancelled = true;
        };
    }, [library, libtype]);

    // Changing library or item type invalidates the rules
    useEffect(() => {
        setRules([]);
        setSortKey("");
    }, [library, libtype]);
    useEffect(() => {
        setLibtype(null);
    }, [library]);

    const fieldsByKey = useMemo(
        () => Object.fromEntries((schema?.fields ?? []).map((f) => [f.key, f])),
        [schema]
    );

    const addRule = () => {
        const first = schema?.fields.find((f) => f.key.split(".").pop() === "genre") ?? schema?.fields[0];
        if (!first) return;
        const op = schema?.operators[first.type]?.[0]?.key ?? "=";
        setRules((r) => [...r, { id: nextRuleId++, field: first.key, operator: op, value: "", dateMode: "relative", relUnit: "d" }]);
    };

    const updateRule = (id: number, patch: Partial<Rule>) =>
        setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

    const changeField = (id: number, fieldKey: string) => {
        const f = fieldsByKey[fieldKey];
        const op = schema?.operators[f?.type]?.[0]?.key ?? "=";
        updateRule(id, { field: fieldKey, operator: op, value: f?.type === "boolean" ? "1" : "", relAmount: "" });
    };

    // Build the query the parent will submit; null while anything is incomplete
    const query: SmartQuery | null = useMemo(() => {
        if (!schema || !libtype) return null;
        const built = rules.map((r) => ({ field: r.field, operator: r.operator, value: ruleValue(r, fieldsByKey[r.field]) }));
        if (built.some((r) => !r.value)) return null;
        const limitNum = limit.trim() ? Number(limit) : null;
        if (limitNum !== null && (!Number.isInteger(limitNum) || limitNum < 1)) return null;
        const sort = sortKey
            ? sortDesc
                ? schema.sorts.find((s) => s.key === sortKey)?.desc_key ?? `${sortKey}:desc`
                : sortKey
            : null;
        return { libtype, match, rules: built, sort, limit: limitNum };
    }, [schema, libtype, rules, fieldsByKey, match, sortKey, sortDesc, limit]);

    const queryJson = JSON.stringify(query);
    useEffect(() => {
        onChange(query);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queryJson]);

    // Live preview of matching items
    useEffect(() => {
        clearTimeout(previewTimer.current);
        if (!query) {
            setPreview(null);
            setPreviewError(null);
            return;
        }
        previewTimer.current = setTimeout(async () => {
            setPreviewLoading(true);
            try {
                const r = await fetchWithAuth(`/api/collections/${encodeURIComponent(library)}/smart-preview`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: queryJson,
                });
                const data = await r.json();
                if (!r.ok) throw new Error(data?.detail ?? "Preview failed");
                setPreview(data);
                setPreviewError(null);
            } catch (e) {
                setPreview(null);
                setPreviewError(e instanceof Error ? e.message : String(e));
            } finally {
                setPreviewLoading(false);
            }
        }, 600);
        return () => clearTimeout(previewTimer.current);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queryJson, library]);

    if (schemaError) {
        return <p className="text-sm text-red-400">{schemaError}</p>;
    }
    if (!schema) {
        return (
            <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading filters from Plex…
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
                {schema.libtypes.length > 1 && (
                    <>
                        <span>Collect</span>
                        <select value={libtype ?? ""} onChange={(e) => setLibtype(e.target.value)} className={inputClass}>
                            {schema.libtypes.map((t) => (
                                <option key={t.key} value={t.key}>{t.title}</option>
                            ))}
                        </select>
                        <span>that match</span>
                    </>
                )}
                {schema.libtypes.length <= 1 && <span>Match</span>}
                <select value={match} onChange={(e) => setMatch(e.target.value as "all" | "any")} className={inputClass}>
                    <option value="all">all</option>
                    <option value="any">any</option>
                </select>
                <span>of the following:</span>
            </div>

            <div className="space-y-2">
                {rules.length === 0 && (
                    <p className="text-sm text-slate-500">No rules yet: every item in the library will match.</p>
                )}
                {rules.map((rule) => {
                    const f = fieldsByKey[rule.field];
                    const ops = schema.operators[f?.type] ?? [];
                    return (
                        <div key={rule.id} className="flex flex-wrap items-center gap-2">
                            <select value={rule.field} onChange={(e) => changeField(rule.id, e.target.value)} className={inputClass}>
                                {schema.fields.map((field) => (
                                    <option key={field.key} value={field.key}>{field.title}</option>
                                ))}
                            </select>
                            <select value={rule.operator} onChange={(e) => updateRule(rule.id, { operator: e.target.value })} className={inputClass}>
                                {ops.map((o) => (
                                    <option key={o.key} value={o.key}>{o.title}</option>
                                ))}
                            </select>

                            {f?.has_choices ? (
                                <ChoicePicker
                                    key={`${rule.id}-${rule.field}-${libtype}`}
                                    library={library}
                                    libtype={libtype ?? schema.libtype}
                                    field={rule.field}
                                    value={rule.value}
                                    onChange={(key) => updateRule(rule.id, { value: key })}
                                />
                            ) : f?.type === "boolean" ? null /* "is true" / "is false" is the operator */ : f?.type === "date" ? (
                                <div className="flex flex-1 flex-wrap items-center gap-2">
                                    <select
                                        value={rule.dateMode ?? "relative"}
                                        onChange={(e) => updateRule(rule.id, { dateMode: e.target.value as "absolute" | "relative" })}
                                        className={inputClass}
                                    >
                                        <option value="relative">a time ago</option>
                                        <option value="absolute">a date</option>
                                    </select>
                                    {rule.dateMode === "absolute" ? (
                                        <input type="date" value={rule.value} onChange={(e) => updateRule(rule.id, { value: e.target.value })} className={inputClass} />
                                    ) : (
                                        <>
                                            <input
                                                type="number"
                                                min={1}
                                                value={rule.relAmount ?? ""}
                                                onChange={(e) => updateRule(rule.id, { relAmount: e.target.value })}
                                                className={`${inputClass} w-20`}
                                            />
                                            <select
                                                value={rule.relUnit ?? "d"}
                                                onChange={(e) => updateRule(rule.id, { relUnit: e.target.value as Rule["relUnit"] })}
                                                className={inputClass}
                                            >
                                                <option value="d">days ago</option>
                                                <option value="w">weeks ago</option>
                                                <option value="m">months ago</option>
                                                <option value="y">years ago</option>
                                            </select>
                                        </>
                                    )}
                                </div>
                            ) : (
                                <input
                                    type={f?.type === "integer" ? "number" : "text"}
                                    value={rule.value}
                                    onChange={(e) => updateRule(rule.id, { value: e.target.value })}
                                    className={`${inputClass} flex-1 min-w-[8rem]`}
                                />
                            )}

                            <button
                                type="button"
                                onClick={() => setRules((rs) => rs.filter((r) => r.id !== rule.id))}
                                className="p-2 text-slate-500 hover:text-red-400 transition-colors"
                                aria-label="Remove rule"
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </div>
                    );
                })}
                <button
                    type="button"
                    onClick={addRule}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                >
                    <Plus className="h-4 w-4" /> Add rule
                </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
                <span>Sort by</span>
                <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} className={inputClass}>
                    <option value="">Plex default</option>
                    {schema.sorts.map((s) => (
                        <option key={s.key} value={s.key}>{s.title}</option>
                    ))}
                </select>
                {sortKey && (
                    <select value={sortDesc ? "desc" : "asc"} onChange={(e) => setSortDesc(e.target.value === "desc")} className={inputClass}>
                        <option value="asc">ascending</option>
                        <option value="desc">descending</option>
                    </select>
                )}
                <span className="ml-2">Limit to</span>
                <input
                    type="number"
                    min={1}
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                    placeholder="no limit"
                    className={`${inputClass} w-28`}
                />
                <span>items</span>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                <div className="flex items-center gap-2 text-sm text-slate-300 mb-2">
                    {previewLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                    {previewError ? (
                        <span className="text-red-400">{previewError}</span>
                    ) : !query ? (
                        <span className="text-slate-500">Finish the rules to see matching items.</span>
                    ) : preview ? (
                        <span>
                            {preview.count} item{preview.count !== 1 ? "s" : ""} match
                        </span>
                    ) : null}
                </div>
                {preview && preview.items.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto pb-1">
                        {preview.items.map((item) => (
                            <div key={item.rating_key} className="w-20 shrink-0">
                                <div className="aspect-[2/3] rounded-md bg-slate-800 overflow-hidden">
                                    {item.poster_url && (
                                        <img src={item.poster_url} alt={item.title} className="h-full w-full object-cover" loading="lazy" />
                                    )}
                                </div>
                                <p className="mt-1 text-[11px] text-slate-400 truncate" title={item.title}>{item.title}</p>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
