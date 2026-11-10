import { useState } from "react";
import { Bookmark, Check, ChevronDown, Loader2, X } from "lucide-react";
import { fetchWithAuth } from "../../utils/api";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

// Named combinations of the Collections page's filters and sort, per library,
// e.g. "Unused director collections". Stored by the app, so they're the same
// on every device.

export type SavedView = { id: number; name: string; params: string };

type Props = {
    library: string;
    views: SavedView[];
    currentParams: string; // the page's filters and sort, in page-address form
    onViewsChange: (views: SavedView[]) => void;
    onApply: (view: SavedView) => void;
    onMessage: (message: string, type?: "success" | "error") => void;
};

export default function SavedViewsMenu({ library, views, currentParams, onViewsChange, onApply, onMessage }: Props) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    const [saving, setSaving] = useState(false);
    const base = `/api/collections/library/${encodeURIComponent(library)}/saved-views`;
    const active = views.find((v) => v.params === currentParams);

    const save = async () => {
        if (!name.trim()) return;
        setSaving(true);
        try {
            const r = await fetchWithAuth(base, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: name.trim(), params: currentParams }),
            });
            const d = await r.json().catch(() => null);
            if (!r.ok) throw new Error(d?.detail ?? "Couldn't save the view");
            onViewsChange(d.saved_views ?? []);
            onMessage(`Saved view "${name.trim()}"`);
            setName("");
        } catch (e) {
            onMessage(e instanceof Error ? e.message : String(e), "error");
        } finally {
            setSaving(false);
        }
    };

    const remove = async (view: SavedView) => {
        const r = await fetchWithAuth(`${base}/${view.id}`, { method: "DELETE" });
        const d = await r.json().catch(() => null);
        if (!r.ok) {
            onMessage(d?.detail ?? "Couldn't delete the view", "error");
            return;
        }
        onViewsChange(d.saved_views ?? []);
        onMessage(`Deleted view "${view.name}"`);
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/70 ${
                        active ? "border-primary bg-primary/15 text-primary hover:bg-primary/25" : "border-slate-700 bg-slate-900 text-white hover:bg-slate-800"
                    }`}
                    title="Saved views: named filters and sort"
                >
                    <Bookmark className="h-4 w-4" />
                    <span className="max-w-[10rem] truncate">{active ? active.name : "Views"}</span>
                    <ChevronDown className="h-4 w-4 text-slate-400" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 space-y-3 border-slate-700 bg-slate-900/95 p-3">
                <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Saved views in {library}</p>
                    {views.length === 0 ? (
                        <p className="py-1 text-xs text-slate-500">No saved views yet.</p>
                    ) : (
                        <div className="max-h-64 overflow-y-auto">
                            {views.map((v) => (
                                <div key={v.id} className="group flex items-center gap-1 rounded-md hover:bg-slate-800">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            onApply(v);
                                            setOpen(false);
                                        }}
                                        className="flex flex-1 items-center gap-2 truncate px-2 py-1.5 text-left text-sm text-white"
                                    >
                                        <span className="w-4 shrink-0">{v.id === active?.id && <Check className="h-4 w-4 text-primary" />}</span>
                                        <span className="truncate">{v.name}</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => remove(v)}
                                        className="p-1.5 text-slate-500 opacity-0 hover:text-red-400 group-hover:opacity-100 focus:opacity-100"
                                        aria-label={`Delete view ${v.name}`}
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        save();
                    }}
                    className="space-y-1.5 border-t border-slate-800 pt-3"
                >
                    <p className="text-xs text-slate-400">Save the current filters and sort as a view</p>
                    <div className="flex gap-2">
                        <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Unused director collections"
                            className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary/70"
                        />
                        <button type="submit" disabled={!name.trim() || saving} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-bold text-white hover:bg-primary-hover disabled:opacity-50">
                            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
                        </button>
                    </div>
                    <p className="text-[11px] text-slate-500">Saving with an existing name replaces that view.</p>
                </form>
            </PopoverContent>
        </Popover>
    );
}
