import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchWithAuth } from "../utils/api";
import SmartCollectionBuilder, { type SmartQuery } from "../components/SmartCollectionBuilder";
import {
    ArrowDownAZ,
    ArrowUpAZ,
    Check,
    ChevronDown,
    Filter,
    LayoutGrid,
    List,
    Plus,
    RefreshCw,
    Rows3,
    Shapes,
    Search,
    X,
} from "lucide-react";
import { Listbox } from "@headlessui/react";
import Toast from "../components/Toast";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogCloseButton,
    DialogFooter,
} from "../components/ui/dialog";
import CollectionFilterPanel from "../components/collections/CollectionFilterPanel";
import EditCollectionPanel from "../components/collections/EditCollectionPanel";
import CollectionTypesPanel from "../components/collections/CollectionTypesPanel";
import ItemFinder from "../components/collections/ItemFinder";
import {
    CollectionCardView,
    CollectionListItem,
    CollectionRow,
    Incremental,
    type CollectionActions,
} from "../components/collections/CollectionViews";
import type { VisibilityOptions } from "../components/collections/PinPopover";
import {
    DEFAULT_FILTERS,
    SORTS,
    TOTAL_PLAYS_HINT,
    activeFilterChips,
    applyFilters,
    clearAllFilters,
    clearFilter,
    filtersToParams,
    loadStoredFilters,
    paramsToFilters,
    sortCollections,
    storeFilters,
    type CollectionFilters,
    type CollectionOverview,
    type CollectionTypeDef,
    type Scope,
} from "../components/collections/collectionFilters";

// The Collections page works on one library at a time.
type Collection = CollectionOverview;

type Library = {
    title: string;
    type: string;
    enabled?: boolean;
};

type Overview = {
    library: string;
    collections: CollectionOverview[];
    groups: string[];
    labels: string[];
    types: CollectionTypeDef[];
    prefixes: { prefix: string; count: number; example: string }[];
};
type ViewMode = "rows" | "cards" | "list";

const LIBRARY_KEY = "collections.library";
const VIEW_KEY = "collections.view";

const SCOPES: { key: Scope; label: string }[] = [
    { key: "all", label: "All Collections" },
    { key: "rotation", label: "Currently In Rotation" },
    { key: "pinned", label: "Pinned Only" },
];

function readStorage(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeStorage(key: string, value: string) {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Storage unavailable; the choice just won't be remembered
    }
}

export default function CollectionsPage() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    // ---------------------------------------------------------------- libraries
    const [availableLibraries, setAvailableLibraries] = useState<Library[]>([]);
    const [loadingLibraries, setLoadingLibraries] = useState(true);
    const enabledLibraries = useMemo(
        () => availableLibraries.filter((l) => l.enabled).map((l) => l.title),
        [availableLibraries]
    );
    const isLibraryEnabled = (library: string) => enabledLibraries.includes(library);

    const [library, setLibrary] = useState<string>(() => searchParams.get("lib") ?? readStorage(LIBRARY_KEY) ?? "");
    const [filters, setFilters] = useState<CollectionFilters>(() => {
        // The page address wins (bookmarks, back button); otherwise this library's remembered filters
        const lib = searchParams.get("lib") ?? readStorage(LIBRARY_KEY) ?? "";
        const fromUrl = paramsToFilters(searchParams);
        const urlHasFilters = [...searchParams.keys()].some((k) => k !== "lib");
        return urlHasFilters ? fromUrl : (lib && loadStoredFilters(lib)) || DEFAULT_FILTERS;
    });

    const [view, setView] = useState<ViewMode>(() => (readStorage(VIEW_KEY) as ViewMode) || "rows");
    const changeView = (v: ViewMode) => {
        setView(v);
        writeStorage(VIEW_KEY, v);
    };

    // ---------------------------------------------------------------- collections
    const [overview, setOverview] = useState<Overview | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filterPanelOpen, setFilterPanelOpen] = useState(false);
    const [movieTitles, setMovieTitles] = useState<Set<string> | null>(null);
    const [pinningKey, setPinningKey] = useState<string | null>(null);
    const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
    const searchRef = useRef<HTMLInputElement | null>(null);

    // Create collection modal
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newCollectionTitle, setNewCollectionTitle] = useState("");
    const [newCollectionLibrary, setNewCollectionLibrary] = useState("");
    const [newCollectionSummary, setNewCollectionSummary] = useState("");
    const [newCollectionKind, setNewCollectionKind] = useState<"static" | "smart">("static");
    const [smartQuery, setSmartQuery] = useState<SmartQuery | null>(null);
    const [creating, setCreating] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<{ library: string; title: string } | null>(null);

    // Movie search for create modal
    const [selectedMovies, setSelectedMovies] = useState<Set<string>>(new Set());

    // Edit panel and this library's groups
    const [editingKey, setEditingKey] = useState<string | null>(null);
    const [typesOpen, setTypesOpen] = useState(false);
    const [libraryGroups, setLibraryGroups] = useState<{ name: string; smart: boolean }[]>([]);

    // Load libraries once; pick a library if none is chosen or it's no longer enabled
    useEffect(() => {
        fetchWithAuth("/api/collections/libraries")
            .then((r) => r.json())
            .then((data) => setAvailableLibraries(data.libraries ?? []))
            .catch(() => setToast({ message: "Failed to load libraries", type: "error" }))
            .finally(() => setLoadingLibraries(false));
    }, []);

    useEffect(() => {
        if (loadingLibraries) return;
        if (!library || !enabledLibraries.includes(library)) {
            const first = enabledLibraries[0] ?? "";
            if (first !== library) {
                setLibrary(first);
                setFilters((first && loadStoredFilters(first)) || DEFAULT_FILTERS);
            }
        }
    }, [loadingLibraries, enabledLibraries, library]);

    const switchLibrary = (next: string) => {
        if (next === library) return;
        setLibrary(next);
        setOverview(null);
        setFilters(loadStoredFilters(next) || DEFAULT_FILTERS);
    };

    // Keep the page address and this library's memory in step with the filters
    useEffect(() => {
        if (!library) return;
        writeStorage(LIBRARY_KEY, library);
        storeFilters(library, filters);
        const params = filtersToParams(filters);
        params.set("lib", library);
        setSearchParams(params, { replace: true });
    }, [library, filters, setSearchParams]);

    const loadOverview = useCallback(
        async (refresh = false) => {
            if (!library) return;
            setLoading(true);
            setError(null);
            try {
                const r = await fetchWithAuth(
                    `/api/collections/library/${encodeURIComponent(library)}/overview${refresh ? "?refresh=true" : ""}`
                );
                const data = await r.json();
                if (!r.ok) throw new Error(data?.detail ?? "Failed to load collections");
                setOverview(data);
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
            } finally {
                setLoading(false);
            }
        },
        [library]
    );

    useEffect(() => {
        loadOverview();
    }, [loadOverview]);

    // Kept for the create/edit/delete handlers below
    const loadCollections = (refresh = false) => loadOverview(refresh);

    // "Contains movie" needs the titles of that movie's collections
    const movieKey = filters.movie?.key;
    useEffect(() => {
        if (!movieKey || !library) {
            setMovieTitles(null);
            return;
        }
        let cancelled = false;
        fetchWithAuth(`/api/collections/library/${encodeURIComponent(library)}/containing/${encodeURIComponent(movieKey)}`)
            .then((r) => (r.ok ? r.json() : { collections: [] }))
            .then((data) => !cancelled && setMovieTitles(new Set<string>(data.collections ?? [])))
            .catch(() => !cancelled && setMovieTitles(new Set()));
        return () => {
            cancelled = true;
        };
    }, [movieKey, library]);

    // "/" jumps to search
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
            if (e.key === "/" && !typing) {
                e.preventDefault();
                searchRef.current?.focus();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    // ---------------------------------------------------------------- derived
    const all = useMemo(() => overview?.collections ?? [], [overview]);
    const visible = useMemo(
        () => sortCollections(applyFilters(all, filters, filters.movie ? movieTitles : null), filters.sort, filters.dir),
        [all, filters, movieTitles]
    );
    const chips = activeFilterChips(filters);
    const filtering = chips.length > 0 || filters.scope !== "all";
    const panelFilterCount = chips.filter((c) => c.key !== "q").length;
    const listKey = `${library}|${filtersToParams(filters).toString()}`;

    // ---------------------------------------------------------------- pins
    const updateCollection = (ratingKey: string, patch: Partial<CollectionOverview>) =>
        setOverview((o) => o && { ...o, collections: o.collections.map((c) => (c.rating_key === ratingKey ? { ...c, ...patch } : c)) });

    const togglePin = async (collection: Collection, visibility?: VisibilityOptions) => {
        setPinningKey(collection.rating_key);
        const pinning = !!visibility;
        updateCollection(collection.rating_key, { pinned: pinning });
        try {
            const r = await fetchWithAuth("/api/collections/toggle-pin", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    collection_name: collection.title,
                    library: collection.library,
                    ...(visibility ?? {}),
                }),
            });
            const data = await r.json();
            if (!data.success) throw new Error(data.message || "Pin change failed");
            setToast({ message: pinning ? `Pinned "${collection.title}"` : `Unpinned "${collection.title}"`, type: "success" });
            // Pinning changes what's on Home/Recommended right away
            loadOverview(true);
        } catch (e) {
            updateCollection(collection.rating_key, { pinned: !pinning });
            setToast({ message: e instanceof Error ? e.message : "Pin change failed", type: "error" });
        } finally {
            setPinningKey(null);
        }
    };

    const actions: CollectionActions = {
        open: (c) => navigate(`/collections/${encodeURIComponent(c.library)}/${encodeURIComponent(c.title)}`),
        edit: (c) => setEditingKey(c.rating_key),
        remove: (c) => setPendingDelete({ library: c.library, title: c.title }),
        pin: (c, v) => togglePin(c, v),
        unpin: (c) => togglePin(c),
        pinning: pinningKey,
        filterType: (t) => setFilters({ ...filters, type: { id: String(t.id), name: t.name } }),
        showAttention: !!(filters.empty || filters.noSummary || filters.noPoster || filters.lastRotated?.op === "never"),
        groups: libraryGroups,
        setGroup: async (c, group, member) => {
            try {
                const r = await fetchWithAuth("/api/admin/config/groups/membership", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ group, collection: c.title, member }),
                });
                const data = await r.json().catch(() => null);
                if (!r.ok) throw new Error(data?.detail ?? "Couldn't change the group");
                updateCollection(c.rating_key, {
                    groups: member ? [...c.groups, group].sort() : c.groups.filter((g) => g !== group),
                });
                setToast({ message: member ? `Added "${c.title}" to group "${group}"` : `Removed "${c.title}" from group "${group}"`, type: "success" });
            } catch (e) {
                setToast({ message: e instanceof Error ? e.message : "Couldn't change the group", type: "error" });
            }
        },
    };

    // Groups that belong to this library, for "Add to group"
    useEffect(() => {
        if (!library) return;
        fetchWithAuth("/api/admin/config/groups")
            .then((r) => r.json())
            .then((groups: { name: string; library?: string | null; smart?: boolean }[]) =>
                setLibraryGroups(
                    groups
                        .filter((g) => g.library === library)
                        .map((g) => ({ name: g.name, smart: !!g.smart }))
                        .sort((a, b) => a.name.localeCompare(b.name))
                )
            )
            .catch(() => setLibraryGroups([]));
    }, [library]);

    // New collections go into the library being worked on
    const openCreateModal = () => {
        setNewCollectionLibrary(library);
        setShowCreateModal(true);
    };

    const resetCreateForm = () => {
        setNewCollectionTitle("");
        setNewCollectionLibrary("");
        setNewCollectionSummary("");
        setNewCollectionKind("static");
        setSmartQuery(null);
        setSelectedMovies(new Set());
    };

    const saveNewCollectionSummary = async () => {
        if (!newCollectionSummary.trim()) return;
        await fetchWithAuth(
            `/api/collections/${encodeURIComponent(newCollectionLibrary)}/${encodeURIComponent(newCollectionTitle.trim())}`,
            {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ summary: newCollectionSummary.trim() }),
            }
        );
    };

    const handleCreateSmartCollection = async () => {
        if (!smartQuery) return;
        try {
            setCreating(true);
            const r = await fetchWithAuth(`/api/collections/${encodeURIComponent(newCollectionLibrary)}/smart`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: newCollectionTitle.trim(), ...smartQuery }),
            });
            if (!r.ok) {
                const data = await r.json().catch(() => null);
                throw new Error(data?.detail ?? "Failed to create smart collection");
            }
            await saveNewCollectionSummary();
            setToast({ message: `Created smart collection '${newCollectionTitle.trim()}'`, type: "success" });
            resetCreateForm();
            setShowCreateModal(false);
            await loadCollections(true);
        } catch (err) {
            setToast({ message: err instanceof Error ? err.message : "Failed to create smart collection", type: "error" });
        } finally {
            setCreating(false);
        }
    };

    const handleCreateCollection = async () => {
        if (!newCollectionTitle.trim() || !newCollectionLibrary.trim()) {
            setToast({ message: "Title and Library are required", type: "error" });
            return;
        }

        if (newCollectionKind === "smart") {
            await handleCreateSmartCollection();
            return;
        }

        if (selectedMovies.size === 0) {
            setToast({ message: "Select at least one item for the collection", type: "error" });
            return;
        }

        try {
            setCreating(true);
            const title = newCollectionTitle.trim();
            const r = await fetchWithAuth(`/api/collections/${encodeURIComponent(newCollectionLibrary)}/manual`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title, rating_keys: [...selectedMovies] }),
            });
            const data = await r.json().catch(() => null);
            if (!r.ok) throw new Error(data?.detail ?? "Failed to create collection");
            await saveNewCollectionSummary();
            setToast({ message: `Created collection "${title}" with ${data.added} item${data.added === 1 ? "" : "s"}`, type: "success" });
            resetCreateForm();
            setShowCreateModal(false);
            await loadCollections(true);
        } catch (err) {
            setToast({
                message: err instanceof Error ? err.message : "Failed to create collection",
                type: "error",
            });
        } finally {
            setCreating(false);
        }
    };

    const confirmDeleteCollection = async () => {
        if (!pendingDelete) return;
        const { library, title } = pendingDelete;
        setPendingDelete(null);

        try {
            const response = await fetchWithAuth(
                `/api/collections/${encodeURIComponent(library)}/${encodeURIComponent(title)}`,
                {
                    method: "DELETE",
                }
            );

            const data = await response.json();

            setToast({ message: data.message || `Deleted collection "${title}"`, type: "success" });

            await loadCollections(true);
        } catch (err) {
            setToast({
                message: err instanceof Error ? err.message : "Failed to delete collection",
                type: "error"
            });
        }
    };


    // ---------------------------------------------------------------- render
    const control = "flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/70 transition-colors";

    const body = () => {
        if (!loadingLibraries && enabledLibraries.length === 0) {
            return (
                <div className="rounded-2xl border border-dashed border-slate-700/60 bg-slate-900/50 p-8 text-center text-slate-400">
                    No libraries are enabled. Turn one on in Settings to work with its collections.
                </div>
            );
        }
        if (error) {
            return (
                <div className="rounded-xl border border-red-900/60 bg-red-900/30 p-4 text-sm text-red-200">
                    {error}
                    <button onClick={() => loadOverview(true)} className="ml-3 underline">Try again</button>
                </div>
            );
        }
        if (!overview) {
            return (
                <div className="space-y-6">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="space-y-2 animate-pulse">
                            <div className="h-5 w-64 rounded bg-slate-800/60" />
                            <div className="flex gap-3">
                                {Array.from({ length: 8 }).map((__, j) => <div key={j} className="w-28 aspect-[2/3] rounded-md bg-slate-800/60" />)}
                            </div>
                        </div>
                    ))}
                </div>
            );
        }
        if (visible.length === 0) {
            return (
                <div className="rounded-2xl border border-dashed border-slate-700/60 bg-slate-900/50 p-8 text-center">
                    <p className="text-slate-400">
                        {all.length === 0
                            ? `${library} has no collections yet`
                            : filters.movie && movieTitles === null
                              ? "Checking which collections contain that movie…"
                              : `None of the ${all.length} collections in ${library} match these filters`}
                    </p>
                    {filtering && all.length > 0 ? (
                        <button onClick={() => setFilters({ ...clearAllFilters(filters), scope: "all" })} className="mt-4 font-medium text-primary hover:text-primary/80">
                            Clear all filters
                        </button>
                    ) : all.length === 0 ? (
                        <button onClick={openCreateModal} className="mt-4 font-medium text-primary hover:text-primary/80">
                            Create a collection
                        </button>
                    ) : null}
                </div>
            );
        }
        if (view === "rows") {
            return (
                <Incremental
                    key={listKey}
                    items={visible}
                    pageSize={15}
                    render={(items) => (
                        <div className="space-y-8">
                            {items.map((c) => <CollectionRow key={c.rating_key} collection={c} actions={actions} />)}
                        </div>
                    )}
                />
            );
        }
        if (view === "cards") {
            return (
                <Incremental
                    key={listKey}
                    items={visible}
                    pageSize={60}
                    render={(items) => (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                            {items.map((c) => <CollectionCardView key={c.rating_key} collection={c} actions={actions} />)}
                        </div>
                    )}
                />
            );
        }
        return (
            <Incremental
                key={listKey}
                items={visible}
                pageSize={100}
                render={(items) => (
                    <div className="flex flex-col gap-1.5">
                        {items.map((c) => <CollectionListItem key={c.rating_key} collection={c} actions={actions} />)}
                    </div>
                )}
            />
        );
    };

    return (
        <div className="space-y-5">
            {/* Header: which library you're working in */}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-3xl font-black tracking-tight text-white">Collections</h1>
                    <Listbox value={library} onChange={switchLibrary} disabled={loadingLibraries}>
                        <div className="relative">
                            <Listbox.Button className={`${control} min-w-[12rem] text-base font-semibold`}>
                                <span className="flex-1 text-left truncate">{loadingLibraries ? "Loading libraries…" : library || "Choose a library"}</span>
                                <ChevronDown className="h-4 w-4 text-slate-400" />
                            </Listbox.Button>
                            <Listbox.Options className="absolute left-0 z-30 mt-1 w-64 max-h-80 overflow-auto rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-lg focus:outline-none">
                                {availableLibraries.map((lib) => (
                                    <Listbox.Option
                                        key={lib.title}
                                        value={lib.title}
                                        disabled={!lib.enabled}
                                        className={`flex items-center justify-between gap-2 px-3 py-2 text-sm ${
                                            lib.enabled
                                                ? "cursor-pointer text-white hover:bg-slate-700 data-[selected]:bg-primary data-[selected]:font-semibold"
                                                : "cursor-not-allowed text-slate-500"
                                        }`}
                                    >
                                        {({ selected }) => (
                                            <>
                                                <span className="truncate">{lib.title}</span>
                                                {lib.enabled ? (
                                                    selected && <Check className="h-4 w-4" />
                                                ) : (
                                                    <span className="text-[10px] uppercase tracking-wide">not enabled</span>
                                                )}
                                            </>
                                        )}
                                    </Listbox.Option>
                                ))}
                            </Listbox.Options>
                        </div>
                    </Listbox>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => setTypesOpen(true)} disabled={!overview} className={`${control} disabled:opacity-50`} title="Name and set up the kinds of collection in this library">
                        <Shapes className="h-4 w-4" />
                        <span className="hidden sm:inline">Collection types</span>
                    </button>
                    <button onClick={() => loadOverview(true)} disabled={loading || !library} className={`${control} disabled:opacity-50`} title="Reload collections from Plex">
                        <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                        <span className="hidden sm:inline">Refresh</span>
                    </button>
                    <button
                        onClick={openCreateModal}
                        disabled={!library}
                        className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white shadow-lg shadow-primary/30 hover:bg-primary-hover disabled:opacity-50"
                    >
                        <Plus size={18} /> Create Collection
                    </button>
                </div>
            </div>

            {/* All / In Rotation / Pinned */}
            <div className="inline-flex rounded-lg border border-slate-700 bg-slate-900 p-0.5">
                {SCOPES.map((s) => (
                    <button
                        key={s.key}
                        type="button"
                        onClick={() => setFilters({ ...filters, scope: s.key })}
                        className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                            filters.scope === s.key ? "bg-primary text-white" : "text-slate-400 hover:text-slate-200"
                        }`}
                    >
                        {s.label}
                    </button>
                ))}
            </div>

            {/* Search, sort, filters, view */}
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[14rem] max-w-md">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                        ref={searchRef}
                        type="search"
                        value={filters.q}
                        onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                        placeholder="Search title or sort title  ( / )"
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2 pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary/70"
                    />
                </div>

                <label className="flex items-center gap-2 text-sm text-slate-400">
                    Sort by
                    <select
                        value={filters.sort}
                        onChange={(e) => setFilters({ ...filters, sort: e.target.value as CollectionFilters["sort"] })}
                        className="rounded-lg border border-slate-700 bg-slate-900 pl-3 pr-10 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary/70"
                        title={filters.sort === "total_plays" ? TOTAL_PLAYS_HINT : undefined}
                    >
                        {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                </label>
                <button
                    type="button"
                    onClick={() => setFilters({ ...filters, dir: filters.dir === "asc" ? "desc" : "asc" })}
                    className={control}
                    title={filters.dir === "asc" ? "Ascending: click for descending" : "Descending: click for ascending"}
                >
                    {filters.dir === "asc" ? <ArrowUpAZ className="h-5 w-5" /> : <ArrowDownAZ className="h-5 w-5" />}
                </button>

                <button
                    type="button"
                    onClick={() => setFilterPanelOpen(true)}
                    disabled={!overview}
                    className={`${control} ${panelFilterCount ? "border-primary bg-primary/15 text-primary hover:bg-primary/25" : ""}`}
                >
                    <Filter className="h-4 w-4" />
                    Filters
                    {panelFilterCount > 0 && (
                        <span className="rounded-full bg-primary px-1.5 text-xs font-bold text-white">{panelFilterCount}</span>
                    )}
                </button>

                <div className="ml-auto inline-flex rounded-lg border border-slate-700 bg-slate-900 p-0.5">
                    {([
                        { key: "rows", icon: Rows3, label: "Rows" },
                        { key: "cards", icon: LayoutGrid, label: "Cards" },
                        { key: "list", icon: List, label: "Compact list" },
                    ] as const).map((v) => (
                        <button
                            key={v.key}
                            type="button"
                            onClick={() => changeView(v.key)}
                            title={`${v.label} view`}
                            className={`rounded-md p-1.5 transition-colors ${view === v.key ? "bg-primary/20 text-primary" : "text-slate-400 hover:text-slate-200"}`}
                        >
                            <v.icon className="h-4 w-4" />
                        </button>
                    ))}
                </div>
            </div>

            {/* Count, and which filters are on */}
            <div className={`flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 ${filtering ? "border border-primary/40 bg-primary/10" : ""}`}>
                <span className="text-sm font-semibold text-white">
                    {overview ? `${visible.length} of ${all.length} collections` : "Loading collections…"}
                </span>
                {filtering && (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Filtered</span>
                )}
                {filters.scope !== "all" && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs text-slate-200">
                        {SCOPES.find((s) => s.key === filters.scope)?.label}
                        <button onClick={() => setFilters({ ...filters, scope: "all" })} aria-label="Show all collections" className="text-slate-400 hover:text-white">
                            <X className="h-3 w-3" />
                        </button>
                    </span>
                )}
                {chips.map((chip) => (
                    <span key={chip.key} className="inline-flex items-center gap-1 rounded-full border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs text-slate-200">
                        {chip.label}
                        <button onClick={() => setFilters(clearFilter(filters, chip.key))} aria-label={`Remove filter: ${chip.label}`} className="text-slate-400 hover:text-white">
                            <X className="h-3 w-3" />
                        </button>
                    </span>
                ))}
                {filtering && (
                    <button onClick={() => setFilters({ ...clearAllFilters(filters), scope: "all" })} className="ml-auto text-xs font-medium text-primary hover:text-primary/80">
                        Clear all
                    </button>
                )}
            </div>

            {body()}

            {overview && (
                <CollectionTypesPanel
                    open={typesOpen}
                    onOpenChange={setTypesOpen}
                    library={library}
                    labels={overview.labels}
                    groups={overview.groups}
                    prefixes={overview.prefixes}
                    collections={overview.collections}
                    onSaved={(message) => {
                        setToast({ message, type: "success" });
                        // Straight from Plex, so recent sort-title or label changes are matched
                        loadOverview(true);
                    }}
                />
            )}

            <EditCollectionPanel
                library={library}
                ratingKey={editingKey}
                currentType={overview?.collections.find((c) => c.rating_key === editingKey)?.type ?? null}
                onClose={() => setEditingKey(null)}
                onSaved={(message) => {
                    setToast({ message, type: "success" });
                    loadOverview(true);
                }}
            />

            {overview && (
                <CollectionFilterPanel
                    open={filterPanelOpen}
                    onOpenChange={setFilterPanelOpen}
                    library={library}
                    filters={filters}
                    onChange={setFilters}
                    groups={overview.groups}
                    labels={overview.labels}
                    types={overview.types}
                    matchingCount={visible.length}
                    totalCount={all.length}
                />
            )}

            {/* Create Collection Modal */}
            <Dialog
                open={showCreateModal}
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        setShowCreateModal(false);
                        resetCreateForm();
                    }
                }}
            >
                <DialogContent className="max-w-4xl">
                    <DialogHeader>
                        <div className="flex flex-col gap-1">
                            <DialogTitle>Create Collection</DialogTitle>
                            <DialogDescription>
                                {newCollectionKind === "smart"
                                    ? "Build a collection that updates itself from filters, like Plex's smart collections"
                                    : "Create a new collection by selecting items from your library"}
                            </DialogDescription>
                        </div>
                        <DialogCloseButton />
                    </DialogHeader>

                    {/* Form */}
                    <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                        <div className="inline-flex rounded-lg border border-slate-700 bg-slate-900 p-0.5">
                            {([
                                { key: "static", label: "Manual", hint: "Pick items by hand" },
                                { key: "smart", label: "Smart", hint: "Built from filters" },
                            ] as const).map((opt) => (
                                <button
                                    key={opt.key}
                                    type="button"
                                    onClick={() => setNewCollectionKind(opt.key)}
                                    title={opt.hint}
                                    className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                                        newCollectionKind === opt.key ? "bg-primary/20 text-primary" : "text-slate-400 hover:text-slate-200"
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
                                    Collection Title *
                                </label>
                                <input
                                    type="text"
                                    value={newCollectionTitle}
                                    onChange={(e) => setNewCollectionTitle(e.target.value)}
                                    placeholder="e.g., Best of 2024"
                                    className="w-full px-4 py-2.5 bg-slate-800/60 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary/70"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
                                    Library Name *
                                </label>
                                <Listbox
                                    value={newCollectionLibrary}
                                    onChange={(newLibrary) => {
                                        setNewCollectionLibrary(newLibrary);
                                        // Items belong to one library, so a new library starts a new selection
                                        setSelectedMovies(new Set());
                                    }}
                                    disabled={loadingLibraries}
                                >
                                    <div className="relative">
                                        <Listbox.Button className="w-full px-4 py-2.5 bg-slate-800/60 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary/70 disabled:opacity-50 text-left flex items-center justify-between data-[disabled]:opacity-50">
                                            <span className={newCollectionLibrary ? "" : "text-slate-500"}>
                                                {loadingLibraries
                                                    ? "Loading libraries..."
                                                    : newCollectionLibrary || "Select a library..."}
                                            </span>
                                            <ChevronDown size={16} className="text-slate-400" />
                                        </Listbox.Button>

                                        <Listbox.Options className="absolute z-10 mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg shadow-lg max-h-60 overflow-auto focus:outline-none">
                                            {availableLibraries.map((library) => (
                                                <Listbox.Option
                                                    key={library.title}
                                                    value={library.title}
                                                    disabled={!isLibraryEnabled(library.title)}
                                                    className="px-4 py-2 cursor-pointer transition-colors data-[focus]:bg-slate-700 data-[disabled]:cursor-not-allowed"
                                                >
                                                    <div className={`flex items-center justify-between ${isLibraryEnabled(library.title) ? "text-white" : "text-slate-500"}`}>
                                                        <span className="data-[selected]:font-medium">{library.title}</span>
                                                        {isLibraryEnabled(library.title) ? (
                                                            <Check size={16} className="text-primary invisible data-[selected]:visible" />
                                                        ) : (
                                                            <span className="text-[10px] uppercase tracking-wide">not enabled</span>
                                                        )}
                                                    </div>
                                                </Listbox.Option>
                                            ))}
                                        </Listbox.Options>
                                    </div>
                                </Listbox>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
                                Summary (Optional)
                            </label>
                            <textarea
                                value={newCollectionSummary}
                                onChange={(e) => setNewCollectionSummary(e.target.value)}
                                placeholder="Add a description for this collection..."
                                rows={2}
                                className="w-full px-4 py-2.5 bg-slate-800/60 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary/70 resize-none"
                            />
                        </div>

                        {newCollectionKind === "smart" && (
                            <div>
                                <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
                                    Filters
                                </label>
                                {newCollectionLibrary ? (
                                    <SmartCollectionBuilder key={newCollectionLibrary} library={newCollectionLibrary} onChange={setSmartQuery} />
                                ) : (
                                    <p className="text-sm text-slate-500">Choose a library first.</p>
                                )}
                            </div>
                        )}

                        {newCollectionKind === "static" && (
                            <div>
                                <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
                                    Items (choose at least one)
                                </label>
                                {newCollectionLibrary ? (
                                    <ItemFinder key={newCollectionLibrary} library={newCollectionLibrary} selected={selectedMovies} onSelectedChange={setSelectedMovies} />
                                ) : (
                                    <p className="text-sm text-slate-500">Choose a library first.</p>
                                )}
                            </div>
                        )}
                    </div>

                    <DialogFooter className="bg-slate-950/50">
                        <p className="text-sm text-slate-400">
                            {newCollectionKind === "smart"
                                ? smartQuery
                                    ? "Plex keeps this collection up to date as your library changes"
                                    : "Finish the filters to create the collection"
                                : selectedMovies.size === 0
                                  ? "Select at least one item to create the collection"
                                  : `${selectedMovies.size} item${selectedMovies.size === 1 ? "" : "s"} selected`}
                        </p>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => {
                                    setShowCreateModal(false);
                                    resetCreateForm();
                                }}
                                disabled={creating}
                                className="px-4 py-2 rounded-lg border border-slate-700 bg-slate-800/60 text-slate-300 text-sm font-medium hover:bg-slate-700 hover:border-slate-600 transition-all duration-200 active:scale-95 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCreateCollection}
                                disabled={
                                    creating ||
                                    !newCollectionTitle.trim() ||
                                    !newCollectionLibrary.trim() ||
                                    (newCollectionKind === "smart" ? !smartQuery : selectedMovies.size === 0)
                                }
                                className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-bold shadow-lg shadow-primary/30 hover:shadow-primary/40 transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {creating
                                    ? "Creating..."
                                    : newCollectionKind === "smart"
                                      ? "Create Smart Collection"
                                      : `Create Collection with ${selectedMovies.size} item${selectedMovies.size === 1 ? "" : "s"}`}
                            </button>
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ConfirmDialog
                open={pendingDelete !== null}
                onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
                title="Delete Collection"
                description={`Are you sure you want to delete "${pendingDelete?.title ?? ""}"? This action cannot be undone.`}
                confirmLabel="Delete"
                cancelLabel="Cancel"
                variant="danger"
                onConfirm={confirmDeleteCollection}
            />

            {/* Toast Notification */}
            {toast && (
                <Toast
                    message={toast.message}
                    type={toast.type}
                    onClose={() => setToast(null)}
                />
            )}
        </div>
    );
}
