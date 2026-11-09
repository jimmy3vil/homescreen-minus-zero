"""Editing one Plex collection: details, labels, artwork, advanced settings
and (for smart collections) its filters.

Collections are looked up by Plex rating key, not title, so a rename can't
lose track of them. Groups, pins and rotation history refer to collections
by name, so renames are carried through to those too.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Plex's collection mode values (collectionMode) and our names for them
COLLECTION_MODES = {-1: "default", 0: "hide", 1: "hideItems", 2: "showItems"}
# Item order for static collections (collectionSort)
COLLECTION_SORTS = {0: "release", 1: "alpha", 2: "custom"}

ARTWORK_KINDS = {
    "poster": ("posters", "uploadPoster", "setPoster", "thumb"),
    "background": ("arts", "uploadArt", "setArt", "art"),
    "logo": ("logos", "uploadLogo", "setLogo", None),
    "square_art": ("squareArts", "uploadSquareArt", "setSquareArt", None),
}


def get_collection(server, section, rating_key: str):
    collection = server.fetchItem(int(rating_key))
    if getattr(collection, "librarySectionID", None) != section.key or getattr(collection, "type", "") != "collection":
        raise LookupError("That collection isn't in this library")
    return collection


def _proxy(server, path: Optional[str]) -> Optional[str]:
    from .poster_proxy import create_proxy_url

    return create_proxy_url(server.url(path, includeToken=True)) if path else None


def edit_details(server, collection) -> Dict[str, Any]:
    from .smart_collections import parse_smart_content

    collection.reload()
    smart = bool(getattr(collection, "smart", False))
    smart_query = None
    if smart and getattr(collection, "content", None):
        from plexapi import utils

        from .smart_collections import LIBTYPES, default_libtype

        parsed = parse_smart_content(collection.content)
        section = collection.section()
        by_id = {str(utils.searchType(t["key"])): t["key"] for t in LIBTYPES.get(section.type, [])}
        smart_query = {
            "libtype": by_id.get(str(parsed["type"])) or default_libtype(section),
            "match": parsed["match"],
            "rules": parsed["rules"],
            "sort": parsed["sort"],
            "limit": parsed["limit"],
            "nested": parsed.get("nested", False),
        }
    return {
        "rating_key": str(collection.ratingKey),
        "title": collection.title,
        "sort_title": getattr(collection, "titleSort", None) or collection.title,
        "summary": getattr(collection, "summary", "") or "",
        "labels": [label.tag for label in getattr(collection, "labels", []) or []],
        "smart": smart,
        "item_count": getattr(collection, "childCount", 0) or 0,
        "collection_mode": COLLECTION_MODES.get(getattr(collection, "collectionMode", -1), "default"),
        "collection_sort": None if smart else COLLECTION_SORTS.get(getattr(collection, "collectionSort", 0), "release"),
        "filter_user": ("user" if getattr(collection, "collectionFilterBasedOnUser", 0) else "admin") if smart else None,
        "artwork": {
            "poster": _proxy(server, getattr(collection, "thumb", None)),
            "background": _proxy(server, getattr(collection, "art", None)),
            "logo": _proxy(server, getattr(collection, "logo", None)),
            "square_art": _proxy(server, getattr(collection, "squareArt", None)),
        },
        "smart_query": smart_query,
    }


# ------------------------------------------------------------------ renames

def propagate_rename(library: str, old: str, new: str) -> Dict[str, int]:
    # Collections are referred to by name in groups, pins and rotation history.
    import yaml
    from sqlalchemy import select

    from .config.loader import load_config_text, save_config_text
    from .db import session_scope
    from .db.models import CollectionUsage, PinnedCollection

    changed = {"groups": 0, "pins": 0, "history": 0}
    if old == new:
        return changed

    data = yaml.safe_load(load_config_text()) or {}
    for group in data.get("groups") or []:
        if not isinstance(group, dict) or group.get("library") not in (None, library):
            continue
        names = group.get("collections") or []
        if old in names:
            group["collections"] = [new if n == old else n for n in names]
            changed["groups"] += 1
    if changed["groups"]:
        save_config_text(yaml.safe_dump(data, sort_keys=False))

    with session_scope() as db:
        pin = db.execute(select(PinnedCollection).where(PinnedCollection.collection_name == old)).scalar_one_or_none()
        if pin is not None and pin.library_name in (library, "", None):
            clash = db.execute(select(PinnedCollection).where(PinnedCollection.collection_name == new)).scalar_one_or_none()
            if clash is None:
                pin.collection_name = new
                changed["pins"] = 1
        usage = db.execute(select(CollectionUsage).where(CollectionUsage.collection_name == old)).scalar_one_or_none()
        if usage is not None:
            clash = db.execute(select(CollectionUsage).where(CollectionUsage.collection_name == new)).scalar_one_or_none()
            if clash is None:
                usage.collection_name = new
                changed["history"] = 1

    logger.info("Renamed collection '%s' -> '%s' in %s", old, new, changed)
    return changed


# ------------------------------------------------------------------ edits

def save_details(
    collection,
    library: str,
    title: str,
    sort_title: str,
    summary: str,
    labels: List[str],
) -> Dict[str, Any]:
    title = title.strip()
    if not title:
        raise ValueError("The collection needs a title")
    old_title = collection.title
    labels = sorted({label.strip() for label in labels if label.strip()}, key=str.lower)
    current_labels = [label.tag for label in getattr(collection, "labels", []) or []]

    collection.batchEdits()
    if title != old_title:
        collection.editTitle(title)
    if (sort_title or "").strip() != (getattr(collection, "titleSort", "") or ""):
        collection.editSortTitle((sort_title or "").strip() or title)
    if summary != (getattr(collection, "summary", "") or ""):
        collection.editSummary(summary)
    collection.saveEdits()

    removed = [label for label in current_labels if label not in labels]
    added = [label for label in labels if label not in current_labels]
    if removed:
        collection.removeLabel(removed)
    if added:
        collection.addLabel(added)

    renamed = propagate_rename(library, old_title, title) if title != old_title else None
    return {"title": title, "renamed": renamed}


def save_advanced(collection, collection_mode: Optional[str], collection_sort: Optional[str], filter_user: Optional[str]) -> None:
    if collection_mode is not None:
        if collection_mode not in COLLECTION_MODES.values():
            raise ValueError(f"Unknown collection mode '{collection_mode}'")
        collection.modeUpdate(mode=collection_mode)
    if collection_sort is not None:
        if getattr(collection, "smart", False):
            raise ValueError("A smart collection's order comes from its filters' sort")
        if collection_sort not in COLLECTION_SORTS.values():
            raise ValueError(f"Unknown item order '{collection_sort}'")
        collection.sortUpdate(sort=collection_sort)
    if filter_user is not None:
        if not getattr(collection, "smart", False):
            raise ValueError("Only smart collections can be filtered by the viewing user")
        if filter_user not in ("admin", "user"):
            raise ValueError(f"Unknown filter user '{filter_user}'")
        collection.filterUserUpdate(user=filter_user)


def save_smart_filters(server, section, collection, query) -> None:
    # Replace a smart collection's filters with the same search URL format
    # Plex's editor stores.
    from plexapi import utils

    from .smart_collections import build_search_key

    if not getattr(collection, "smart", False):
        raise ValueError("Only smart collections have filters")
    key = build_search_key(section, query)
    args = {"uri": f"{server._uriRoot()}{key}"}
    server.query(f"/library/collections/{collection.ratingKey}/items{utils.joinArgs(args)}", method=server._session.put)


# ------------------------------------------------------------------ artwork

def artwork_options(server, collection, kind: str) -> List[Dict[str, Any]]:
    # Images Plex already has for this slot (uploaded, from agents, etc.)
    if kind not in ARTWORK_KINDS:
        raise ValueError(f"Unknown artwork '{kind}'")
    list_method = ARTWORK_KINDS[kind][0]
    options = []
    for res in getattr(collection, list_method)():
        thumb = getattr(res, "thumb", None) or getattr(res, "key", None)
        if thumb and thumb.startswith("http"):
            url = thumb
            from .poster_proxy import create_proxy_url

            preview = create_proxy_url(url)
        else:
            preview = _proxy(server, thumb)
        options.append({
            "key": getattr(res, "ratingKey", None) or getattr(res, "key", None),
            "provider": getattr(res, "provider", None),
            "selected": bool(getattr(res, "selected", False)),
            "preview_url": preview,
        })
    return options


def select_artwork(collection, kind: str, key: str) -> None:
    list_method, _, set_method, _ = ARTWORK_KINDS[kind]
    for res in getattr(collection, list_method)():
        if (getattr(res, "ratingKey", None) or getattr(res, "key", None)) == key:
            getattr(collection, set_method)(res)
            return
    raise LookupError("That image isn't available any more")


_URL = re.compile(r"^https?://", re.IGNORECASE)


def upload_artwork(collection, kind: str, url: Optional[str] = None, filepath: Optional[str] = None) -> None:
    if kind not in ARTWORK_KINDS:
        raise ValueError(f"Unknown artwork '{kind}'")
    upload_method = ARTWORK_KINDS[kind][1]
    if url:
        if not _URL.match(url):
            raise ValueError("Image links must start with http:// or https://")
        getattr(collection, upload_method)(url=url)
    elif filepath:
        getattr(collection, upload_method)(filepath=filepath)
    else:
        raise ValueError("Choose a file or paste an image link")
