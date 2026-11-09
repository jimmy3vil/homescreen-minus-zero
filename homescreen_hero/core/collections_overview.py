"""Everything the Collections page needs about one library's collections.

One request returns every collection in the library with the details used
for sorting and filtering (Plex metadata plus this app's groups, pins and
rotation history), so the page can sort and filter instantly in the browser.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# library -> (cache version, built at, payload)
_cache: Dict[str, Tuple[int, float, Dict[str, Any]]] = {}
CACHE_TTL_SECONDS = 120


def _iso(dt) -> Optional[str]:
    return dt.isoformat() if dt else None


def has_custom_poster(thumb: Optional[str]) -> bool:
    # Plex builds a collection's default poster as a composite of its items;
    # an uploaded or chosen poster is a regular thumb.
    return bool(thumb) and "/composite/" not in thumb


def _group_membership(config, library: str, collections: List[Any]) -> Dict[str, List[str]]:
    # collection title -> names of this library's groups it belongs to
    from .smart_groups import CollectionMetadata, resolve_smart_rules
    from .integrations.plex_client import get_collection_labels

    groups = [g for g in config.groups if g.library == library]
    if not groups:
        return {}

    metadata = None
    if any(g.smart for g in groups):
        metadata = [
            CollectionMetadata(
                name=c.title,
                source="plex",
                library=library,
                labels=get_collection_labels(c),
                item_count=getattr(c, "childCount", 0) or 0,
                sort_title=getattr(c, "titleSort", "") or "",
            )
            for c in collections
        ]

    membership: Dict[str, List[str]] = {}
    for group in groups:
        names = resolve_smart_rules(group.rules, metadata) if group.smart else group.collections
        for name in names:
            membership.setdefault(name, []).append(group.name)
    return membership


def build_overview(server, config, library: str) -> Dict[str, Any]:
    from .db import get_pinned_collections, get_rotation_history_context
    from .db.analytics import get_latest_plays_by_collection
    from .integrations.plex_client import get_collection_labels
    from .poster_proxy import build_collection_poster_url

    section = server.library.section(library)
    collections = section.collections()

    promoted: Dict[str, Any] = {}
    try:
        promoted = {h.identifier: h for h in section.managedHubs() if getattr(h, "identifier", None)}
    except Exception as e:
        logger.warning("Could not read Manage Recommendations for '%s': %s", library, e)

    pinned = {
        p.collection_name
        for p in get_pinned_collections()
        if not getattr(p, "library_name", None) or p.library_name == library
    }
    _, usage = get_rotation_history_context()
    plays = get_latest_plays_by_collection(library)
    groups = _group_membership(config, library, collections)

    rows = []
    for c in collections:
        hub = promoted.get(f"custom.collection.{section.key}.{c.ratingKey}")
        on_home = bool(hub and hub.promotedToOwnHome)
        on_recommended = bool(hub and hub.promotedToRecommended)
        on_shared = bool(hub and hub.promotedToSharedHome)
        use = usage.get(c.title)
        rows.append({
            "rating_key": str(c.ratingKey),
            "title": c.title,
            "sort_title": getattr(c, "titleSort", None) or c.title,
            "library": library,
            "smart": bool(getattr(c, "smart", False)),
            "item_count": getattr(c, "childCount", 0) or 0,
            "added_at": _iso(getattr(c, "addedAt", None)),
            "updated_at": _iso(getattr(c, "updatedAt", None)),
            "labels": get_collection_labels(c),
            "has_summary": bool((getattr(c, "summary", "") or "").strip()),
            "has_custom_poster": has_custom_poster(getattr(c, "thumb", None)),
            "poster_url": build_collection_poster_url(server, c),
            "on_home": on_home,
            "on_recommended": on_recommended,
            "on_shared": on_shared,
            "in_rotation": on_home or on_recommended or on_shared,
            "pinned": c.title in pinned,
            "groups": groups.get(c.title, []),
            "times_rotated": int(use.times_used) if use else 0,
            "last_rotated_at": _iso(use.last_rotated_at) if use else None,
            "total_plays": plays.get(c.title),
        })

    group_names = sorted(g.name for g in config.groups if g.library == library)
    labels = sorted({label for r in rows for label in r["labels"]}, key=str.lower)
    return {"library": library, "collections": rows, "groups": group_names, "labels": labels}


def get_overview(server, config, library: str, cache_version: int, refresh: bool = False) -> Dict[str, Any]:
    cached = _cache.get(library)
    if (
        not refresh
        and cached
        and cached[0] == cache_version
        and time.time() - cached[1] < CACHE_TTL_SECONDS
    ):
        return cached[2]
    payload = build_overview(server, config, library)
    _cache[library] = (cache_version, time.time(), payload)
    return payload


def collection_items(server, rating_key: str, limit: int = 20) -> Dict[str, Any]:
    # The first items of a collection, in the collection's own sort order.
    from .poster_proxy import create_proxy_url

    data = server.query(
        f"/library/collections/{rating_key}/children"
        f"?X-Plex-Container-Start=0&X-Plex-Container-Size={int(limit)}"
    )
    total = int(data.attrib.get("totalSize", data.attrib.get("size", 0)))
    items = []
    for el in data:
        key = el.attrib.get("ratingKey")
        if not key:
            continue
        thumb = el.attrib.get("thumb")
        items.append({
            "rating_key": key,
            "title": el.attrib.get("title"),
            "year": el.attrib.get("year"),
            "poster_url": create_proxy_url(server.url(thumb, includeToken=True)) if thumb else None,
        })
    return {"total": total, "items": items[: int(limit)]}


def collections_containing(server, item_rating_key: str) -> List[str]:
    # Titles of the collections a movie or show belongs to.
    item = server.fetchItem(int(item_rating_key))
    return [tag.tag for tag in getattr(item, "collections", []) or []]
