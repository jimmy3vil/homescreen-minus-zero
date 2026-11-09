// Colours a collection type can have (matches the server's list)
const TYPE_COLORS: Record<string, string> = {
    sky: "border-sky-400/50 bg-sky-400/20 text-sky-200",
    violet: "border-violet-400/50 bg-violet-400/20 text-violet-200",
    rose: "border-rose-400/50 bg-rose-400/20 text-rose-200",
    amber: "border-amber-400/50 bg-amber-400/20 text-amber-200",
    lime: "border-lime-400/50 bg-lime-400/20 text-lime-200",
    teal: "border-teal-400/50 bg-teal-400/20 text-teal-200",
    orange: "border-orange-400/50 bg-orange-400/20 text-orange-200",
    pink: "border-pink-400/50 bg-pink-400/20 text-pink-200",
    indigo: "border-indigo-400/50 bg-indigo-400/20 text-indigo-200",
    slate: "border-slate-400/50 bg-slate-400/20 text-slate-200",
};
export const typeColor = (color: string) => TYPE_COLORS[color] ?? TYPE_COLORS.sky;
export const TYPE_COLOR_NAMES = Object.keys(TYPE_COLORS);
