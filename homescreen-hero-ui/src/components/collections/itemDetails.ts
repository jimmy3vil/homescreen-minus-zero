// How an item (film or show) is described in item lists.

export type PreviewItem = {
    rating_key: string;
    title: string;
    year: string | null;
    poster_url: string | null;
    type: string | null;
    content_rating: string | null;
    duration_minutes: number | null;
    rating: number | null;
    genres: string[];
    seasons: number | null;
    episodes: number | null;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function runtime(minutes: number | null) {
    if (!minutes) return null;
    const h = Math.floor(minutes / 60);
    return h ? `${h}h ${minutes % 60}m` : `${minutes}m`;
}

// "1999 · PG · 1h 30m · ★ 7.5" (or seasons/episodes for shows)
export function details(item: PreviewItem): string {
    const parts = [
        item.year,
        item.content_rating,
        item.type === "show"
            ? [item.seasons && plural(item.seasons, "season"), item.episodes && plural(item.episodes, "episode")].filter(Boolean).join(", ")
            : runtime(item.duration_minutes),
        item.rating ? `★ ${item.rating.toFixed(1)}` : null,
    ];
    return parts.filter(Boolean).join(" · ");
}
