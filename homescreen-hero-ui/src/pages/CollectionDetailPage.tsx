import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchWithAuth } from "../utils/api";

// Old addresses named collections by title (/collections/:library/:title).
// Collection pages are now addressed by Plex ID, so this finds the ID and
// sends you to the collection's page.
export default function CollectionDetailPage() {
    const { library = "", collectionTitle = "" } = useParams<{ library: string; collectionTitle: string }>();
    const navigate = useNavigate();
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchWithAuth(`/api/collections/library/${encodeURIComponent(library)}/overview`)
            .then((r) => r.json())
            .then((data) => {
                const match = (data.collections ?? []).find((c: { title: string }) => c.title === collectionTitle);
                if (match) navigate(`/collections/${encodeURIComponent(library)}/c/${match.rating_key}`, { replace: true });
                else setError(`No collection called "${collectionTitle}" in ${library}`);
            })
            .catch(() => setError("Couldn't find that collection"));
    }, [library, collectionTitle, navigate]);

    return <p className="text-slate-400">{error ?? "Opening collection…"}</p>;
}
