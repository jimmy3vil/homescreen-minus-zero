import { useEffect, useState } from "react";
import { RotateCcw, Search } from "lucide-react";
import SmartCollectionBuilder, { type InitialSmartQuery, type SmartQuery } from "../SmartCollectionBuilder";
import MatchPreview, { type ItemSelection } from "./MatchPreview";

// Choosing items for a manual collection: a quick title search, or the same
// filters as smart collections. Both tabs share one selection, so you can mix
// them. The filters only find items; the collection keeps exactly what's added.
//
// The tab, and the last complete set of filter rules (with sort and limit),
// are remembered per library in the browser.

type Props = {
    library: string;
    selected: Set<string>;
    onSelectedChange: (next: Set<string>) => void;
    existing?: Set<string>; // items already in the collection
};

type Tab = "search" | "filters";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const NONE = new Set<string>();
const TAB_KEY = "finder.tab";
const rulesKey = (library: string) => `finder.rules.${library}`;

function readStorage<T>(key: string): T | null {
    try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : null;
    } catch {
        return null;
    }
}

function writeStorage(key: string, value: unknown) {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Storage unavailable; the finder just won't remember
    }
}

export default function ItemFinder({ library, selected, onSelectedChange, existing = NONE }: Props) {
    const [tab, setTabState] = useState<Tab>(() => (readStorage<Tab>(TAB_KEY) === "filters" ? "filters" : "search"));
    const setTab = (t: Tab) => {
        setTabState(t);
        writeStorage(TAB_KEY, t);
    };
    const selection: ItemSelection = { selected, existing, onChange: onSelectedChange };

    // Quick search: the same list as Filters, with one "title contains" rule
    const [query, setQuery] = useState("");
    const [debounced, setDebounced] = useState("");
    useEffect(() => {
        const t = setTimeout(() => setDebounced(query.trim()), 300);
        return () => clearTimeout(t);
    }, [query]);
    const searchJson = debounced ? JSON.stringify({ match: "all", rules: [{ field: "title", operator: "=", value: debounced }] }) : null;

    // Filters: start from what was last used in this library; "Reset" starts over
    const [savedRules] = useState<InitialSmartQuery | null>(() => readStorage<InitialSmartQuery>(rulesKey(library)));
    const [builderKey, setBuilderKey] = useState(0);
    const [initialRules, setInitialRules] = useState<InitialSmartQuery | undefined>(savedRules ?? undefined);
    const rememberRules = (q: SmartQuery | null) => {
        if (q) writeStorage(rulesKey(library), q);
    };
    const resetRules = () => {
        writeStorage(rulesKey(library), null);
        setInitialRules(undefined);
        setBuilderKey((k) => k + 1);
    };

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex rounded-lg border border-slate-700 bg-slate-900 p-0.5">
                    {([
                        { key: "search", label: "Quick search" },
                        { key: "filters", label: "Filters" },
                    ] as const).map((t) => (
                        <button
                            key={t.key}
                            type="button"
                            onClick={() => setTab(t.key)}
                            className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${tab === t.key ? "bg-primary/20 text-primary" : "text-slate-400 hover:text-slate-200"}`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
                <span className="text-sm text-slate-300">{plural(selected.size, "item")} selected</span>
                {selected.size > 0 && (
                    <button type="button" onClick={() => onSelectedChange(new Set())} className="text-xs text-primary hover:text-primary/80">
                        Clear selection
                    </button>
                )}
                {tab === "filters" && (
                    <button type="button" onClick={resetRules} className="ml-auto inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white" title="Clear the rules, sort and limit">
                        <RotateCcw className="h-3.5 w-3.5" /> Reset filters
                    </button>
                )}
            </div>

            {/* Both tabs stay mounted so switching keeps the search and the rules */}
            <div className={tab === "search" ? "space-y-3" : "hidden"}>
                <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={`Search ${library} by title…`}
                        className="w-full rounded-lg border border-slate-700 bg-slate-800/60 py-2 pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary/70"
                    />
                </div>
                <MatchPreview
                    library={library}
                    queryJson={searchJson}
                    selection={selection}
                    idleMessage="Type a title, or use Filters to find items."
                    viewKind="search"
                />
            </div>
            <div className={tab === "filters" ? "space-y-2" : "hidden"}>
                <p className="text-xs text-slate-500">
                    Filters here only find items to add. This collection keeps exactly the items you add and won't change as your library does; use a smart collection for that.
                </p>
                <SmartCollectionBuilder
                    key={`${library}-${builderKey}`}
                    library={library}
                    initial={initialRules}
                    onChange={rememberRules}
                    selection={selection}
                />
            </div>
        </div>
    );
}
