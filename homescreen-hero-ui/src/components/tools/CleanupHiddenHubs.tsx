import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { fetchWithAuth } from "../../utils/api";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogFooter,
    DialogTitle,
    DialogDescription,
    DialogCloseButton,
} from "@/components/ui/dialog";

type HiddenHub = { library: string; title: string };

type CleanupHiddenHubsProps = {
    onClose: () => void;
};

async function runCleanup(dryRun: boolean): Promise<HiddenHub[]> {
    const r = await fetchWithAuth(`/api/collections/cleanup-hidden-hubs?dry_run=${dryRun}`, {
        method: "POST",
    });
    if (!r.ok) {
        throw new Error((await r.text()) || "Cleanup request failed");
    }
    const data = await r.json();
    return data.removed as HiddenHub[];
}

export default function CleanupHiddenHubs({ onClose }: CleanupHiddenHubsProps) {
    const [preview, setPreview] = useState<HiddenHub[] | null>(null);
    const [removed, setRemoved] = useState<HiddenHub[] | null>(null);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        runCleanup(true)
            .then(setPreview)
            .catch((e) => setError(String(e)))
            .finally(() => setBusy(false));
    }, []);

    const handleRemove = async () => {
        setBusy(true);
        setError(null);
        try {
            setRemoved(await runCleanup(false));
        } catch (e) {
            setError(String(e));
        } finally {
            setBusy(false);
        }
    };

    const list = removed ?? preview ?? [];

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="!max-w-lg">
                <DialogHeader>
                    <div>
                        <DialogTitle>Clean Up Manage Recommendations</DialogTitle>
                        <DialogDescription>
                            Remove collections that are listed in Plex's Manage Recommendations but hidden
                            everywhere (Recommended, Home and Friends' Home all off).
                        </DialogDescription>
                    </div>
                    <DialogCloseButton />
                </DialogHeader>

                <div className="space-y-4 p-6">
                    {busy && !list.length && (
                        <div className="flex items-center gap-2 text-sm text-slate-400">
                            <Loader2 className="h-4 w-4 animate-spin" /> Checking Plex…
                        </div>
                    )}

                    {error && (
                        <div className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                            {error}
                        </div>
                    )}

                    {removed && (
                        <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
                            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                            <p className="text-sm font-medium text-emerald-300">
                                Removed {removed.length} hidden collection{removed.length !== 1 ? "s" : ""}
                            </p>
                        </div>
                    )}

                    {preview && !removed && (
                        <p className="text-sm text-slate-300">
                            {preview.length
                                ? `${preview.length} hidden collection${preview.length !== 1 ? "s" : ""} will be removed. Nothing visible on any screen is touched.`
                                : "Nothing to clean up. Every collection in Manage Recommendations is visible somewhere."}
                        </p>
                    )}

                    {list.length > 0 && (
                        <ul className="max-h-72 overflow-y-auto rounded-lg border border-slate-800 divide-y divide-slate-800 text-sm">
                            {list.map((h) => (
                                <li key={`${h.library}/${h.title}`} className="flex justify-between gap-3 px-3 py-1.5">
                                    <span className="text-slate-200 truncate">{h.title}</span>
                                    <span className="text-slate-500 shrink-0">{h.library}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <DialogFooter>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 transition-colors"
                    >
                        {removed ? "Done" : "Cancel"}
                    </button>
                    {!removed && !!preview?.length && (
                        <button
                            type="button"
                            onClick={handleRemove}
                            disabled={busy}
                            className="rounded-lg bg-amber-600 hover:bg-amber-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 transition-colors flex items-center gap-2"
                        >
                            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                            Remove {preview.length}
                        </button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
