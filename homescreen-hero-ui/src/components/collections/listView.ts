// One remembered choice of view for every list of items in the app's
// collection editing: Quick search, Filters results and a collection's items.
import { useEffect, useState } from "react";

export type ItemView = "detailed" | "compact" | "cards" | "rows";
const KEY = "items.view";
const OLD_KEY = "smartPreview.view";
const EVENT = "items-view-change";

function read(): ItemView {
    try {
        const v = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY);
        return v === "compact" || v === "cards" || v === "rows" ? v : "detailed";
    } catch {
        return "detailed";
    }
}

export function useItemView(): [ItemView, (v: ItemView) => void] {
    const [view, setView] = useState<ItemView>(read);
    // Keep every list on screen in step when one changes
    useEffect(() => {
        const sync = () => setView(read());
        window.addEventListener(EVENT, sync);
        return () => window.removeEventListener(EVENT, sync);
    }, []);
    const change = (v: ItemView) => {
        try {
            localStorage.setItem(KEY, v);
        } catch {
            // Storage unavailable; the view just won't be remembered
        }
        setView(v);
        window.dispatchEvent(new Event(EVENT));
    };
    return [view, change];
}
