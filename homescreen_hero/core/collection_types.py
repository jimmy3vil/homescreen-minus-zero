"""Collection types: this app's own way of saying what kind of collection
something is (Director, Actor, Era, …), per library.

A collection's type is worked out in this order:
  1. assigned by hand;
  2. a Plex label mapped to a type;
  3. its sort-title prefix (e.g. Kometa's "!024") mapped to a type;
  4. a group it's in, mapped to a type.
Types live in this app's database, keyed by Plex rating key. Nothing is
written to Plex.
"""
from __future__ import annotations

import re
from collections import Counter
from typing import Any, Dict, List, Optional

COLORS = ["sky", "violet", "rose", "amber", "lime", "teal", "orange", "pink", "indigo", "slate"]

# A sort-title prefix: a leading token that starts with a symbol or digit,
# e.g. "!024 Spotlight…", "!010_Actors", "~05 Era". Ends at a space or "_".
_PREFIX = re.compile(r"^([!~#+=^\-]*\d[A-Za-z0-9.\-]*|[!~#+=^]+[^\s_]*)(?=[\s_])")


def sort_title_prefix(sort_title: Optional[str]) -> Optional[str]:
    if not sort_title:
        return None
    m = _PREFIX.match(sort_title)
    return m.group(1) if m else None


def detect_prefixes(collections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    # Prefixes used in a library, most common first, with an example title
    counts: Counter = Counter()
    example: Dict[str, str] = {}
    for c in collections:
        p = sort_title_prefix(c.get("sort_title"))
        if p:
            counts[p] += 1
            example.setdefault(p, c.get("title", ""))
    return [{"prefix": p, "count": n, "example": example[p]} for p, n in counts.most_common()]


def resolve_type(collection: Dict[str, Any], types: List[Dict[str, Any]], assigned_id: Optional[int]) -> Optional[Dict[str, Any]]:
    def pick(t, source, matched):
        return {"id": t["id"], "name": t["name"], "color": t["color"], "source": source, "matched": matched}

    if assigned_id is not None:
        t = next((t for t in types if t["id"] == assigned_id), None)
        if t:
            return pick(t, "manual", None)
    labels = collection.get("labels") or []
    for t in types:
        hit = next((label for label in labels if label in (t.get("labels") or [])), None)
        if hit:
            return pick(t, "label", hit)
    prefix = sort_title_prefix(collection.get("sort_title"))
    if prefix:
        for t in types:
            if prefix in (t.get("prefixes") or []):
                return pick(t, "prefix", prefix)
    groups = collection.get("groups") or []
    for t in types:
        hit = next((g for g in groups if g in (t.get("groups") or [])), None)
        if hit:
            return pick(t, "group", hit)
    return None


# ------------------------------------------------------------------ storage

def _as_dict(t) -> Dict[str, Any]:
    return {
        "id": t.id,
        "name": t.name,
        "color": t.color,
        "position": t.position,
        "labels": list(t.labels or []),
        "prefixes": list(t.prefixes or []),
        "groups": list(t.groups or []),
    }


def list_types(library: str) -> List[Dict[str, Any]]:
    from .db import session_scope
    from .db.models import CollectionType

    with session_scope() as db:
        rows = db.query(CollectionType).filter(CollectionType.library == library).order_by(CollectionType.position, CollectionType.id).all()
        return [_as_dict(t) for t in rows]


def _clean_list(values) -> List[str]:
    return list(dict.fromkeys(str(v).strip() for v in (values or []) if str(v).strip()))


def save_types(library: str, types: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    # Replace the library's types with this list (in this order). Types left
    # out are deleted, along with collections assigned to them by hand.
    from .db import session_scope
    from .db.models import CollectionType, CollectionTypeAssignment

    names = [str(t.get("name", "")).strip() for t in types]
    if any(not n for n in names):
        raise ValueError("Every type needs a name")
    if len({n.lower() for n in names}) != len(names):
        raise ValueError("Two types have the same name")

    with session_scope() as db:
        existing = {t.id: t for t in db.query(CollectionType).filter(CollectionType.library == library).all()}
        keep = set()
        for position, t in enumerate(types):
            row = existing.get(t.get("id")) if t.get("id") is not None else None
            if row is None:
                row = CollectionType(library=library)
                db.add(row)
            row.name = str(t["name"]).strip()
            row.color = t.get("color") if t.get("color") in COLORS else "sky"
            row.position = position
            row.labels = _clean_list(t.get("labels"))
            row.prefixes = _clean_list(t.get("prefixes"))
            row.groups = _clean_list(t.get("groups"))
            db.flush()
            keep.add(row.id)
        for type_id, row in existing.items():
            if type_id not in keep:
                db.query(CollectionTypeAssignment).filter(CollectionTypeAssignment.type_id == type_id).delete()
                db.delete(row)
    return list_types(library)


def assignments(library: str) -> Dict[str, int]:
    from .db import session_scope
    from .db.models import CollectionTypeAssignment

    with session_scope() as db:
        rows = db.query(CollectionTypeAssignment).filter(CollectionTypeAssignment.library == library).all()
        return {r.rating_key: r.type_id for r in rows}


def assign_type(library: str, rating_key: str, type_id: Optional[int]) -> None:
    # type_id None = back to automatic
    from .db import session_scope
    from .db.models import CollectionType, CollectionTypeAssignment

    with session_scope() as db:
        if type_id is not None:
            exists = db.query(CollectionType).filter(CollectionType.id == type_id, CollectionType.library == library).first()
            if exists is None:
                raise LookupError("That type doesn't exist in this library")
        db.query(CollectionTypeAssignment).filter(
            CollectionTypeAssignment.library == library, CollectionTypeAssignment.rating_key == str(rating_key)
        ).delete()
        if type_id is not None:
            db.add(CollectionTypeAssignment(library=library, rating_key=str(rating_key), type_id=type_id))


def with_types(payload: Dict[str, Any]) -> Dict[str, Any]:
    # Add each collection's type to a Collections page overview. Done on every
    # request (not cached with the Plex data), since types change often.
    library = payload["library"]
    types = list_types(library)
    assigned = assignments(library)
    rows = [{**r, "type": resolve_type(r, types, assigned.get(r["rating_key"]))} for r in payload["collections"]]
    return {
        **payload,
        "collections": rows,
        "types": types,
        "prefixes": detect_prefixes(payload["collections"]),
    }
