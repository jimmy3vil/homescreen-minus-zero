// Remembered choice of view for lists of items. Each list has its own:
// "search" (Quick search results), "filters" (Filters results) and
// "collection" (a collection's own items).
import { useEffect, useState } from "react";

export type ItemView = "detailed" | "compact" | "cards" | "rows";
export type ItemListKind = "search" | "filters" | "collection";
const storageKey = (kind: ItemListKind) => `items.view.${kind}`;
const EVENT = "items-view-change";

function read(kind: ItemListKind): ItemView {
    try {
        const v = localStorage.getItem(storageKey(kind)) ?? localStorage.getItem("items.view");
        return v === "compact" || v === "cards" || v === "rows" ? v : "detailed";
    } catch {
        return "detailed";
    }
}

export function useItemView(kind: ItemListKind): [ItemView, (v: ItemView) => void] {
    const [view, setView] = useState<ItemView>(() => read(kind));
    // Keep lists of the same kind on screen in step when one changes
    useEffect(() => {
        const sync = (e: Event) => {
            if ((e as CustomEvent<ItemListKind>).detail === kind) setView(read(kind));
        };
        window.addEventListener(EVENT, sync);
        return () => window.removeEventListener(EVENT, sync);
    }, [kind]);
    const change = (v: ItemView) => {
        try {
            localStorage.setItem(storageKey(kind), v);
        } catch {
            // Storage unavailable; the view just won't be remembered
        }
        setView(v);
        window.dispatchEvent(new CustomEvent<ItemListKind>(EVENT, { detail: kind }));
    };
    return [view, change];
}
