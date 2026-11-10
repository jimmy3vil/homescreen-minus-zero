import { useState } from "react";
import { ChevronDown, ChevronRight, Pencil } from "lucide-react";
import type { CollectionOverview } from "./collectionFilters";
import { OTHER, type Section } from "./sections";

// Sections by sort-title prefix (Kometa's "!024", "!010_…"), shown only when
// the page is sorted by sort title. Each heading can be named once per
// library, collapsed, and jumped to.

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const anchorId = (prefix: string) => `section-${prefix.replace(/[^A-Za-z0-9_-]/g, "_")}`;

type Props = {
    sections: Section[];
    names: Record<string, string>;
    collapsed: Set<string>;
    onToggle: (prefix: string) => void;
    onRename: (prefix: string, name: string) => Promise<void>;
    renderItems: (items: CollectionOverview[], prefix: string) => React.ReactNode;
};

function Heading({ section, name, collapsed, onToggle, onRename }: {
    section: Section;
    name?: string;
    collapsed: boolean;
    onToggle: () => void;
    onRename: (name: string) => Promise<void>;
}) {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(name ?? "");
    const isOther = section.prefix === OTHER;
    const save = async () => {
        await onRename(value);
        setEditing(false);
    };
    return (
        <div id={anchorId(section.prefix)} className="flex scroll-mt-24 items-center gap-3 border-b border-slate-800 pb-2">
            <button type="button" onClick={onToggle} className="text-slate-400 hover:text-white" aria-label={collapsed ? "Show section" : "Hide section"} aria-expanded={!collapsed}>
                {collapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </button>
            {editing ? (
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        save();
                    }}
                    className="flex items-center gap-2"
                >
                    <input
                        autoFocus
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
                        placeholder={`Name for ${section.prefix}`}
                        className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary/70"
                    />
                    <button type="submit" className="text-xs font-medium text-primary hover:text-primary/80">Save</button>
                    <button type="button" onClick={() => setEditing(false)} className="text-xs text-slate-400 hover:text-white">Cancel</button>
                </form>
            ) : (
                <>
                    <h3 className="text-xl font-black tracking-tight text-white">{isOther ? "No prefix" : name || section.prefix}</h3>
                    {!isOther && name && <span className="text-xs text-slate-500">{section.prefix}</span>}
                    {!isOther && (
                        <button type="button" onClick={() => { setValue(name ?? ""); setEditing(true); }} className="text-slate-500 hover:text-white" aria-label={`Name the ${section.prefix} section`} title="Name this section">
                            <Pencil className="h-3.5 w-3.5" />
                        </button>
                    )}
                </>
            )}
            <span className="ml-auto text-xs text-slate-400">{plural(section.items.length, "collection")}</span>
        </div>
    );
}

export function SectionJump({ sections, names }: { sections: Section[]; names: Record<string, string> }) {
    return (
        <select
            value=""
            onChange={(e) => {
                if (e.target.value) document.getElementById(anchorId(e.target.value))?.scrollIntoView({ behavior: "smooth" });
            }}
            className="rounded-lg border border-slate-700 bg-slate-900 py-2 pl-3 pr-10 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary/70"
            aria-label="Jump to a section"
        >
            <option value="">Jump to…</option>
            {sections.map((s) => (
                <option key={s.prefix} value={s.prefix}>
                    {s.prefix === OTHER ? "No prefix" : names[s.prefix] ? `${names[s.prefix]} (${s.prefix})` : s.prefix} · {s.items.length}
                </option>
            ))}
        </select>
    );
}

export default function CollectionSections({ sections, names, collapsed, onToggle, onRename, renderItems }: Props) {
    return (
        <div className="space-y-10">
            {sections.map((s) => (
                <section key={s.prefix} className="space-y-4">
                    <Heading
                        section={s}
                        name={names[s.prefix]}
                        collapsed={collapsed.has(s.prefix)}
                        onToggle={() => onToggle(s.prefix)}
                        onRename={(name) => onRename(s.prefix, name)}
                    />
                    {!collapsed.has(s.prefix) && renderItems(s.items, s.prefix)}
                </section>
            ))}
        </div>
    );
}
