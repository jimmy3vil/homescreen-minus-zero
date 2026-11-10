import { useState } from "react";
import { FolderMinus, FolderPlus, Loader2, Pin, PinOff, Trash2, X } from "lucide-react";
import { fetchWithAuth } from "../../utils/api";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import type { CollectionOverview } from "./collectionFilters";

// Acting on several selected collections at once: add to or remove from a
// group, pin or unpin, delete.

type Props = {
    library: string;
    selected: CollectionOverview[];
    visibleCount: number; // collections currently shown (after filters)
    groups: { name: string; smart: boolean }[];
    onSelectAllVisible: () => void;
    onClear: () => void;
    onDone: (message: string, type?: "success" | "error") => void;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const btn =
    "inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-40";

async function ok(r: Response, fallback: string) {
    if (r.ok) return r.json().catch(() => ({}));
    const data = await r.json().catch(() => null);
    throw new Error(data?.detail ?? data?.message ?? fallback);
}

export default function BulkActionsBar({ library, selected, visibleCount, groups, onSelectAllVisible, onClear, onDone }: Props) {
    const [busy, setBusy] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [pinVis, setPinVis] = useState({ home: true, shared: false, recommended: true });
    const count = selected.length;
    const manualGroups = groups.filter((g) => !g.smart);
    const inGroups = [...new Set(selected.flatMap((c) => c.groups))].filter((g) => manualGroups.some((m) => m.name === g)).sort();

    // Runs one request per collection, showing progress
    const each = async (label: string, list: CollectionOverview[], run: (c: CollectionOverview) => Promise<unknown>) => {
        let done = 0;
        const failed: string[] = [];
        for (const c of list) {
            setBusy(`${label} ${done + 1} of ${list.length}…`);
            try {
                await run(c);
            } catch {
                failed.push(c.title);
            }
            done += 1;
        }
        return failed;
    };

    const membership = async (group: string, member: boolean) => {
        setBusy(member ? "Adding to group…" : "Removing from group…");
        try {
            const data = await ok(
                await fetchWithAuth("/api/admin/config/groups/membership/bulk", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ group, collections: selected.map((c) => c.title), member }),
                }),
                "Couldn't change the group"
            );
            onDone(data.message ?? "Group updated");
        } catch (e) {
            onDone(e instanceof Error ? e.message : String(e), "error");
        } finally {
            setBusy(null);
        }
    };

    const pin = async (pinning: boolean) => {
        // Pinning applies the chosen screens to every selected collection; unpinning only touches pinned ones
        const list = pinning ? selected : selected.filter((c) => c.pinned);
        const failed = await each(pinning ? "Pinning" : "Unpinning", list, async (c) => {
            const data = await ok(
                await fetchWithAuth("/api/collections/toggle-pin", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ collection_name: c.title, library: c.library, ...(pinning ? pinVis : {}) }),
                }),
                "Pin change failed"
            );
            if (!data.success) throw new Error(data.message);
        });
        setBusy(null);
        const doneCount = list.length - failed.length;
        onDone(
            failed.length
                ? `${pinning ? "Pinned" : "Unpinned"} ${plural(doneCount, "collection")}; ${plural(failed.length, "collection")} failed: ${failed.slice(0, 3).join(", ")}`
                : `${pinning ? "Pinned" : "Unpinned"} ${plural(doneCount, "collection")}`,
            failed.length ? "error" : "success"
        );
    };

    const remove = async () => {
        setConfirmDelete(false);
        const failed = await each("Deleting", selected, async (c) =>
            ok(await fetchWithAuth(`/api/collections/${encodeURIComponent(library)}/${encodeURIComponent(c.title)}`, { method: "DELETE" }), "Delete failed")
        );
        setBusy(null);
        onDone(
            failed.length
                ? `Deleted ${plural(count - failed.length, "collection")}; ${plural(failed.length, "collection")} failed: ${failed.slice(0, 3).join(", ")}`
                : `Deleted ${plural(count, "collection")}`,
            failed.length ? "error" : "success"
        );
    };

    const groupMenu = (title: string, icon: React.ReactNode, options: string[], member: boolean, empty: string) => (
        <Popover>
            <PopoverTrigger asChild>
                <button type="button" className={btn} disabled={!count || !!busy}>
                    {icon} {title}
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 border-slate-700 bg-slate-900/95 p-2">
                {options.length === 0 ? (
                    <p className="px-2 py-1.5 text-xs text-slate-500">{empty}</p>
                ) : (
                    <div className="max-h-64 overflow-y-auto">
                        {options.map((g) => (
                            <button key={g} type="button" onClick={() => membership(g, member)} className="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm text-white hover:bg-slate-800">
                                {g}
                            </button>
                        ))}
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );

    return (
        <div className="sticky bottom-4 z-30 flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-slate-950/95 p-3 shadow-2xl backdrop-blur">
            <span className="text-sm font-semibold text-white">{plural(count, "collection")} selected</span>
            {count < visibleCount && (
                <button type="button" onClick={onSelectAllVisible} className="text-xs font-medium text-primary hover:text-primary/80">
                    Select all {plural(visibleCount, "shown collection")}
                </button>
            )}
            {count > 0 && (
                <button type="button" onClick={onClear} className="text-xs text-slate-400 hover:text-white">
                    Clear
                </button>
            )}
            <span className="mx-1 h-5 w-px bg-slate-700" />
            {groupMenu("Add to group", <FolderPlus className="h-4 w-4" />, manualGroups.map((g) => g.name), true, `${library} has no manual groups yet.`)}
            {groupMenu("Remove from group", <FolderMinus className="h-4 w-4" />, inGroups, false, "None of these collections are in a manual group.")}
            <Popover>
                <PopoverTrigger asChild>
                    <button type="button" className={btn} disabled={!count || !!busy}>
                        <Pin className="h-4 w-4" /> Pin
                    </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-56 border-slate-700 bg-slate-900/95 p-3 space-y-2">
                    <p className="text-xs text-slate-400">Show the pinned collections on:</p>
                    {([
                        ["home", "My Home"],
                        ["recommended", "Recommended"],
                        ["shared", "Friends' Home"],
                    ] as const).map(([k, label]) => (
                        <label key={k} className="flex items-center gap-2 text-sm text-slate-200">
                            <input type="checkbox" checked={pinVis[k]} onChange={(e) => setPinVis((v) => ({ ...v, [k]: e.target.checked }))} />
                            {label}
                        </label>
                    ))}
                    <button
                        type="button"
                        onClick={() => pin(true)}
                        disabled={!pinVis.home && !pinVis.recommended && !pinVis.shared}
                        className="w-full rounded-lg bg-primary px-3 py-1.5 text-sm font-bold text-white hover:bg-primary-hover disabled:opacity-50"
                    >
                        Pin {plural(count, "collection")}
                    </button>
                </PopoverContent>
            </Popover>
            <button type="button" className={btn} disabled={!selected.some((c) => c.pinned) || !!busy} onClick={() => pin(false)}>
                <PinOff className="h-4 w-4" /> Unpin
            </button>
            <button type="button" className={`${btn} hover:border-red-500/60 hover:text-red-300`} disabled={!count || !!busy} onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-4 w-4" /> Delete
            </button>
            {busy && (
                <span className="flex items-center gap-1.5 text-xs text-slate-300">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> {busy}
                </span>
            )}
            <button type="button" onClick={onClear} className="ml-auto p-1 text-slate-400 hover:text-white" aria-label="Stop selecting">
                <X className="h-4 w-4" />
            </button>
            <ConfirmDialog
                open={confirmDelete}
                onOpenChange={setConfirmDelete}
                title={`Delete ${plural(count, "collection")}`}
                description={`Delete ${selected.slice(0, 5).map((c) => `"${c.title}"`).join(", ")}${count > 5 ? ` and ${count - 5} more` : ""} from Plex? Their items stay in your library. This can't be undone.`}
                confirmLabel={`Delete ${plural(count, "collection")}`}
                cancelLabel="Cancel"
                variant="danger"
                onConfirm={remove}
            />
        </div>
    );
}
