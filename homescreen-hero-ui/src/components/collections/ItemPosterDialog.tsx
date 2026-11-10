import { useState } from "react";
import { Loader2 } from "lucide-react";
import { fetchWithAuth } from "../../utils/api";
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";

// Change the poster of one movie or show (not the collection's own poster).
type Props = {
    library: string;
    item: { rating_key: string; title: string } | null; // null = closed
    onClose: () => void;
    onSaved: (message: string) => void;
};

const field =
    "w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary/70";

export default function ItemPosterDialog({ library, item, onClose, onSaved }: Props) {
    const [file, setFile] = useState<File | null>(null);
    const [url, setUrl] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const close = () => {
        setFile(null);
        setUrl("");
        setError(null);
        onClose();
    };

    const save = async () => {
        if (!item) return;
        const form = new FormData();
        if (file) form.append("file", file);
        else form.append("url", url.trim());
        setSaving(true);
        setError(null);
        try {
            const r = await fetchWithAuth(`/api/collections/${encodeURIComponent(library)}/items/${encodeURIComponent(item.rating_key)}/upload-poster`, {
                method: "POST",
                body: form,
            });
            if (!r.ok) {
                const data = await r.json().catch(() => null);
                throw new Error(data?.detail ?? "Couldn't change the poster");
            }
            onSaved(`Changed the poster of "${item.title}"`);
            close();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={!!item} onOpenChange={(open) => !open && close()}>
            <DialogContent className="!max-w-md">
                <DialogHeader>
                    <div>
                        <DialogTitle>Change poster</DialogTitle>
                        <DialogDescription>{item?.title}: this changes the movie or show's own poster in Plex.</DialogDescription>
                    </div>
                    <DialogCloseButton />
                </DialogHeader>
                <div className="space-y-4 p-6">
                    <label className="block space-y-1.5">
                        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">Upload a file</span>
                        <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                                setFile(e.target.files?.[0] ?? null);
                                setUrl("");
                            }}
                            className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-white"
                        />
                    </label>
                    <label className="block space-y-1.5">
                        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">Or use an image link</span>
                        <input
                            value={url}
                            onChange={(e) => {
                                setUrl(e.target.value);
                                setFile(null);
                            }}
                            placeholder="https://…"
                            className={field}
                        />
                    </label>
                    {error && <p className="text-sm text-red-400">{error}</p>}
                </div>
                <DialogFooter>
                    <button type="button" onClick={close} className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700">
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={save}
                        disabled={saving || (!file && !url.trim())}
                        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-hover disabled:opacity-50"
                    >
                        {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save poster
                    </button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
