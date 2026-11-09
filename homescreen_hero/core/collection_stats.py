"""Daily per-collection statistics for the Collections page.

Once a day, for every enabled library:
  * which items are in each collection, and when the newest was added
    (feeds the "Updated" badge);
  * how many times those items were played in the last 30 days, from
    Tautulli's history (feeds Total Plays and the "Trending" badge).

Tautulli records plays per item, not per collection, so a collection's Total
Plays is the sum of plays of the items in it. Episode plays count towards
collections containing their show (or season).
"""
from __future__ import annotations

import logging
import threading
from collections import Counter
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional

logger = logging.getLogger(__name__)

PLAYS_WINDOW_DAYS = 30
TRENDING_TOP_N = 10
TRENDING_MIN_PLAYS = 3

_lock = threading.Lock()


def collection_members(server, rating_key) -> Dict[str, Any]:
    # Rating keys of a collection's items and the newest item's added date
    data = server.query(
        f"/library/collections/{rating_key}/children"
        "?X-Plex-Container-Start=0&X-Plex-Container-Size=10000&includeGuids=0"
    )
    keys = set()
    latest = None
    for el in data:
        key = el.attrib.get("ratingKey")
        if not key:
            continue
        keys.add(key)
        added = el.attrib.get("addedAt")
        if added and added.isdigit():
            ts = datetime.utcfromtimestamp(int(added))
            if latest is None or ts > latest:
                latest = ts
    return {"keys": keys, "latest_item_added_at": latest}


def plays_by_item(history: Iterable[Dict[str, Any]]) -> Counter:
    # Count each play against the item and its parents, so an episode play
    # also counts for its season and show.
    counts: Counter = Counter()
    for row in history:
        for field in ("rating_key", "parent_rating_key", "grandparent_rating_key"):
            key = row.get(field)
            if key not in (None, ""):
                counts[str(key)] += 1
    return counts


def collection_plays(member_keys: Iterable[str], counts: Counter) -> int:
    return sum(counts.get(k, 0) for k in member_keys)


def trending_keys(rows: List[Dict[str, Any]]) -> set:
    # Top collections by plays per item over the window, with a minimum
    # number of plays. rows: [{rating_key, plays, item_count}]
    eligible = [
        r for r in rows
        if r.get("plays") is not None and r["plays"] >= TRENDING_MIN_PLAYS and r.get("item_count", 0) > 0
    ]
    eligible.sort(key=lambda r: (-(r["plays"] / r["item_count"]), -r["plays"]))
    return {r["rating_key"] for r in eligible[:TRENDING_TOP_N]}


def collect_library_stats(config, server, library: str) -> int:
    from .db import session_scope
    from .db.models import CollectionStats
    from .integrations.tautulli_client import get_tautulli_client

    section = server.library.section(library)
    counts: Optional[Counter] = None
    tautulli = get_tautulli_client(config)
    if tautulli is not None:
        after = (datetime.now() - timedelta(days=PLAYS_WINDOW_DAYS)).strftime("%Y-%m-%d")
        try:
            counts = plays_by_item(tautulli.get_library_history_since(int(section.key), after))
        except Exception as e:
            logger.warning("Couldn't read Tautulli history for '%s': %s", library, e)

    now = datetime.utcnow()
    rows = []
    for c in section.collections():
        try:
            members = collection_members(server, c.ratingKey)
        except Exception as e:
            logger.warning("Couldn't read items of collection '%s': %s", c.title, e)
            continue
        rows.append(CollectionStats(
            library=library,
            rating_key=str(c.ratingKey),
            collection_name=c.title,
            collected_at=now,
            item_count=len(members["keys"]),
            plays_30d=collection_plays(members["keys"], counts) if counts is not None else None,
            latest_item_added_at=members["latest_item_added_at"],
        ))

    with session_scope() as db:
        db.add_all(rows)
        # Keep 60 days of snapshots
        db.query(CollectionStats).filter(
            CollectionStats.library == library,
            CollectionStats.collected_at < now - timedelta(days=60),
        ).delete()
    logger.info("Collected stats for %d collections in '%s'", len(rows), library)
    return len(rows)


def collect_all_stats() -> None:
    from .config.loader import load_config
    from .integrations.plex_client import get_plex_server

    if not _lock.acquire(blocking=False):
        logger.info("Collection stats already being collected")
        return
    try:
        config = load_config()
        server = get_plex_server(config)
        for lib in config.plex.libraries:
            if lib.enabled:
                try:
                    collect_library_stats(config, server, lib.name)
                except Exception:
                    logger.exception("Collecting stats for '%s' failed", lib.name)
    finally:
        _lock.release()


def latest_stats(library: str) -> Dict[str, Dict[str, Any]]:
    # rating key -> latest snapshot for that collection
    from sqlalchemy import func

    from .db import session_scope
    from .db.models import CollectionStats

    with session_scope() as db:
        latest_at = (
            db.query(func.max(CollectionStats.collected_at))
            .filter(CollectionStats.library == library)
            .scalar()
        )
        if latest_at is None:
            return {}
        rows = (
            db.query(CollectionStats)
            .filter(CollectionStats.library == library, CollectionStats.collected_at == latest_at)
            .all()
        )
        return {
            r.rating_key: {
                "plays": r.plays_30d,
                "item_count": r.item_count,
                "latest_item_added_at": r.latest_item_added_at,
                "collected_at": r.collected_at,
            }
            for r in rows
        }


def stats_are_stale(max_age_hours: int = 20) -> bool:
    from sqlalchemy import func

    from .db import session_scope
    from .db.models import CollectionStats

    with session_scope() as db:
        latest = db.query(func.max(CollectionStats.collected_at)).scalar()
    return latest is None or datetime.utcnow() - latest > timedelta(hours=max_age_hours)


# ------------------------------------------------------------------ schedule

_scheduler = None


def start_stats_scheduler() -> None:
    # Daily at 04:00, plus once shortly after start-up if the last run is old.
    global _scheduler
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.cron import CronTrigger

    if _scheduler is not None:
        return
    scheduler = BackgroundScheduler()
    scheduler.add_job(collect_all_stats, CronTrigger(hour=4, minute=0), id="collection-stats", coalesce=True, max_instances=1)
    if stats_are_stale():
        scheduler.add_job(
            collect_all_stats,
            id="collection-stats-startup",
            next_run_time=datetime.now() + timedelta(seconds=30),
            max_instances=1,
        )
    scheduler.start()
    _scheduler = scheduler
    logger.info("Collection stats scheduled daily at 04:00")


def stop_stats_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
