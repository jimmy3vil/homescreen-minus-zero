"""Per-library settings for the Collections page, kept in the app database:
names for sort-title sections, and saved views (named filters and sort)."""
from __future__ import annotations

from typing import Dict, List


def section_names(library: str) -> Dict[str, str]:
    from .db import session_scope
    from .db.models import SortTitleSection

    with session_scope() as db:
        return {r.prefix: r.name for r in db.query(SortTitleSection).filter(SortTitleSection.library == library).all()}


def set_section_name(library: str, prefix: str, name: str) -> Dict[str, str]:
    # An empty name removes it, so the heading falls back to the prefix
    from .db import session_scope
    from .db.models import SortTitleSection

    prefix = prefix.strip()
    if not prefix:
        raise ValueError("Missing the prefix to name")
    name = name.strip()
    with session_scope() as db:
        row = db.query(SortTitleSection).filter(SortTitleSection.library == library, SortTitleSection.prefix == prefix).first()
        if not name:
            if row is not None:
                db.delete(row)
        elif row is None:
            db.add(SortTitleSection(library=library, prefix=prefix, name=name))
        else:
            row.name = name
    return section_names(library)


def _view(r) -> Dict[str, object]:
    return {"id": r.id, "name": r.name, "params": r.params}


def saved_views(library: str) -> List[Dict[str, object]]:
    from .db import session_scope
    from .db.models import SavedCollectionView

    with session_scope() as db:
        rows = (
            db.query(SavedCollectionView)
            .filter(SavedCollectionView.library == library)
            .order_by(SavedCollectionView.name)
            .all()
        )
        return [_view(r) for r in rows]


def save_view(library: str, name: str, params: str) -> List[Dict[str, object]]:
    # Saving under an existing name replaces that view
    from .db import session_scope
    from .db.models import SavedCollectionView

    name = name.strip()
    if not name:
        raise ValueError("Give the view a name")
    with session_scope() as db:
        row = db.query(SavedCollectionView).filter(SavedCollectionView.library == library, SavedCollectionView.name == name).first()
        if row is None:
            db.add(SavedCollectionView(library=library, name=name, params=params or ""))
        else:
            row.params = params or ""
    return saved_views(library)


def delete_view(library: str, view_id: int) -> List[Dict[str, object]]:
    from .db import session_scope
    from .db.models import SavedCollectionView

    with session_scope() as db:
        db.query(SavedCollectionView).filter(SavedCollectionView.library == library, SavedCollectionView.id == view_id).delete()
    return saved_views(library)
