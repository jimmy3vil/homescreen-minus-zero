import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Edit, Share2, Trash2 } from "lucide-react";
import { fetchWithAuth } from "../utils/api";
import Toast from "../components/Toast";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import ExportCollectionDialog from "../components/ExportCollectionDialog";
import EditCollectionPanel from "../components/collections/EditCollectionPanel";
import CollectionItemsEditor from "../components/collections/CollectionItemsEditor";
import ItemPosterDialog from "../components/collections/ItemPosterDialog";
import { CollectionBadges } from "../components/collections/CollectionViews";
import type { CollectionOverview } from "../components/collections/collectionFilters";

// One collection's own page ("See all items…"): its details and badges, its
// items in any view, adding items with the item finder, and the same Edit
// collection panel as the Collections page. Linked by Plex ID, so renames
// don't break it.

type Details = {
    title: string;
    sort_title: string;
    summary: string;
    collection_sort: "release" | "alpha" | "custom" | null;
    artwork: { poster: string | null; background: string | null };
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function CollectionPage() {
    const { library = "", ratingKey = "" } = useParams<{ library: string; ratingKey: string }>();
    const navigate = useNavigate();
    const base = `/api/collections/library/${encodeURIComponent(library)}/collection/${ratingKey}`;

    const [row, setRow] = useState<CollectionOverview | null>(null);
    const [details, setDetails] = useState<Details | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
    const [editing, setEditing] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [posterItem, setPosterItem] = useState<{ rating_key: string; title: string } | null>(null);
    const [itemsVersion, setItemsVersion] = useState(0);

    const load = useCallback(
        async (refresh = false) => {
            setError(null);
            try {
                const [ov, ed] = await Promise.all([
                    fetchWithAuth(`/api/collections/library/${encodeURIComponent(library)}/overview${refresh ? "?refresh=true" : ""}`).then((r) => r.json()),
                    fetchWithAuth(`${base}/edit`).then(async (r) => {
                        if (!r.ok) throw new Error((await r.json().catch(() => null))?.detail ?? "Collection not found");
                        return r.json();
                    }),
                ]);
                setRow((ov.collections ?? []).find((c: CollectionOverview) => c.rating_key === ratingKey) ?? null);
                setDetails(ed);
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
            }
        },
        [library, ratingKey, base]
    );

    useEffect(() => {
        load();
    }, [load]);

    const saved = (message: string) => {
        setToast({ message, type: "success" });
        load(true);
        setItemsVersion((v) => v + 1);
    };

    const remove = async () => {
        if (!details) return;
        setConfirmDelete(false);
        try {
            const r = await fetchWithAuth(`/api/collections/${encodeURIComponent(library)}/${encodeURIComponent(details.title)}`, { method: "DELETE" });
            if (!r.ok) throw new Error((await r.json().catch(() => null))?.detail ?? "Couldn't delete the collection");
            navigate(`/collections?lib=${encodeURIComponent(library)}`);
        } catch (e) {
            setToast({ message: e instanceof Error ? e.message : String(e), type: "error" });
        }
    };

    const back = (
        <button
            onClick={() => navigate(`/collections?lib=${encodeURIComponent(library)}`)}
            className="flex w-fit items-center gap-2 text-slate-400 transition-colors hover:text-white"
        >
            <ArrowLeft size={20} /> Back to {library || "Collections"}
        </button>
    );

    if (error) {
        return (
            <div className="space-y-4">
                {back}
                <p className="text-red-400">{error}</p>
            </div>
        );
    }
    if (!details) {
        return (
            <div className="space-y-4">
                {back}
                <p className="text-slate-400">Loading collection…</p>
            </div>
        );
    }

    const smart = row?.smart ?? false;
    const btn = "flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800";

    return (
        <div className="space-y-6">
            {back}

            <div className="flex flex-wrap items-start gap-5">
                <div className="aspect-[2/3] w-32 shrink-0 overflow-hidden rounded-lg border border-slate-700/50 bg-slate-800">
                    {details.artwork.poster && <img src={details.artwork.poster} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                    <h1 className="text-3xl font-black tracking-tight text-white">{details.title}</h1>
                    {details.sort_title && details.sort_title !== details.title && (
                        <p className="text-sm text-slate-500" title="Sort title">{details.sort_title}</p>
                    )}
                    {row && <CollectionBadges collection={row} />}
                    <p className="text-sm text-slate-400">
                        {smart ? "Smart" : "Manual"} collection · {plural(row?.item_count ?? 0, "item")} · {library}
                    </p>
                    {details.summary && <p className="max-w-3xl text-sm text-slate-300">{details.summary}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => setEditing(true)} className={btn}>
                        <Edit size={16} /> Edit collection
                    </button>
                    <button onClick={() => setExporting(true)} className={btn}>
                        <Share2 size={16} /> Export
                    </button>
                    <button onClick={() => setConfirmDelete(true)} className={`${btn} hover:border-red-500/60 hover:text-red-300`}>
                        <Trash2 size={16} /> Delete
                    </button>
                </div>
            </div>

            <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
                <CollectionItemsEditor
                    key={`${ratingKey}-${itemsVersion}`}
                    base={base}
                    library={library}
                    customOrder={details.collection_sort === "custom"}
                    readOnly={smart}
                    collapsibleFinder
                    wide
                    onItemPoster={(item) => setPosterItem(item)}
                    onChanged={(message) => {
                        setToast({ message, type: "success" });
                        load(true);
                    }}
                />
            </section>

            <EditCollectionPanel
                library={library}
                ratingKey={editing ? ratingKey : null}
                currentType={row?.type ?? null}
                onClose={() => setEditing(false)}
                onSaved={saved}
            />
            <ItemPosterDialog library={library} item={posterItem} onClose={() => setPosterItem(null)} onSaved={saved} />
            <ExportCollectionDialog open={exporting} onClose={() => setExporting(false)} library={library} collectionTitle={details.title} isSmart={smart} />
            <ConfirmDialog
                open={confirmDelete}
                onOpenChange={setConfirmDelete}
                title="Delete collection"
                description={`Delete "${details.title}" from Plex? Its items stay in your library. This can't be undone.`}
                confirmLabel="Delete collection"
                cancelLabel="Cancel"
                variant="danger"
                onConfirm={remove}
            />
            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
        </div>
    );
}
