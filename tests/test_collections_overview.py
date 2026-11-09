from datetime import datetime
from types import SimpleNamespace as NS

from homescreen_hero.core import collections_overview as overview
from homescreen_hero.core.config.schema import (
    AppConfig,
    CollectionGroupConfig,
    PlexLibraryConfig,
    PlexSettings,
    RotationSettings,
    SmartGroupRule,
)
from homescreen_hero.core.smart_collections import parse_smart_content


def _coll(key, title, **kw):
    return NS(
        ratingKey=key,
        title=title,
        titleSort=kw.get("titleSort", title),
        smart=kw.get("smart", False),
        childCount=kw.get("childCount", 3),
        addedAt=datetime(2024, 1, 1),
        updatedAt=datetime(2024, 6, 1),
        labels=[NS(tag=t) for t in kw.get("labels", [])],
        summary=kw.get("summary", ""),
        thumb=kw.get("thumb", f"/library/collections/{key}/composite/1"),
    )


class FakeSection:
    key = 3

    def __init__(self, colls, hubs):
        self._colls, self._hubs = colls, hubs

    def collections(self):
        return self._colls

    def managedHubs(self):
        return self._hubs


def test_overview_combines_plex_and_app_data(monkeypatch):
    colls = [
        _coll(10, "Spotlight on A", titleSort="!024 A", labels=["Kometa"], summary="hi"),
        _coll(11, "Trending", thumb="/library/metadata/11/thumb/9", childCount=0),
    ]
    hubs = [NS(identifier="custom.collection.3.11", promotedToOwnHome=False, promotedToRecommended=True, promotedToSharedHome=False)]
    server = NS(library=NS(section=lambda name: FakeSection(colls, hubs)))
    config = AppConfig(
        plex=PlexSettings(base_url="x", token="t", libraries=[PlexLibraryConfig(name="Films", enabled=True)]),
        rotation=RotationSettings(),
        groups=[
            CollectionGroupConfig(name="Actors", library="Films", collections=["Spotlight on A"]),
            CollectionGroupConfig(
                name="Kometa smart",
                library="Films",
                smart=True,
                rules=[SmartGroupRule(field="label", operator="includes", values=["Kometa"])],
            ),
            CollectionGroupConfig(name="Elsewhere", library="TV", collections=["Trending"]),
        ],
    )

    from homescreen_hero.core import db as core_db
    from homescreen_hero.core import poster_proxy

    monkeypatch.setattr(core_db, "get_pinned_collections", lambda: [NS(collection_name="Trending", library_name="Films")])
    monkeypatch.setattr(core_db, "get_rotation_history_context", lambda: (5, {"Trending": NS(times_used=4, last_rotated_at=datetime(2024, 7, 1))}))
    from homescreen_hero.core import collection_stats

    monkeypatch.setattr(collection_stats, "latest_stats", lambda lib: {"11": {"plays": 12, "item_count": 0, "latest_item_added_at": datetime(2024, 7, 2), "collected_at": datetime(2024, 7, 3)}})
    monkeypatch.setattr(poster_proxy, "build_collection_poster_url", lambda s, c: f"/p/{c.ratingKey}")

    data = overview.build_overview(server, config, "Films")
    a, t = data["collections"]

    assert a["sort_title"] == "!024 A" and a["labels"] == ["Kometa"] and a["has_summary"]
    assert a["groups"] == ["Actors", "Kometa smart"]
    assert not a["has_custom_poster"] and not a["in_rotation"] and not a["pinned"]
    assert a["times_rotated"] == 0 and a["total_plays"] is None

    assert t["on_recommended"] and t["in_rotation"] and not t["on_home"]
    assert t["pinned"] and t["has_custom_poster"] and t["item_count"] == 0
    assert t["times_rotated"] == 4 and t["total_plays"] == 12 and t["groups"] == []
    assert t["latest_item_added_at"] == "2024-07-02T00:00:00"
    assert not t["trending"]  # 0 items: plays per item can't be worked out
    assert data["stats_collected_at"] == "2024-07-03T00:00:00"

    assert data["groups"] == ["Actors", "Kometa smart"]
    assert data["labels"] == ["Kometa"]


def test_parse_smart_content_reads_operators_and_match():
    content = (
        "/library/sections/3/all?type=1&sort=titleSort%3Adesc&limit=25"
        "&push=1&genre=87&or=1&title==Alien&or=1&year>>=1999&or=1&title!==Bad&pop=1"
    )
    parsed = parse_smart_content(content)
    assert parsed["type"] == "1" and parsed["sort"] == "titleSort:desc" and parsed["limit"] == 25
    assert parsed["match"] == "any"
    assert parsed["rules"] == [
        {"field": "genre", "operator": "=", "value": "87"},
        {"field": "title", "operator": "==", "value": "Alien"},
        {"field": "year", "operator": ">>=", "value": "1999"},
        {"field": "title", "operator": "!==", "value": "Bad"},
    ]


def test_has_custom_poster():
    assert not overview.has_custom_poster("/library/collections/5/composite/123")
    assert overview.has_custom_poster("/library/metadata/5/thumb/123")
    assert not overview.has_custom_poster(None)


def test_limited_smart_collection_count_is_capped():
    smart = NS(childCount=184, smart=True, content="/library/sections/3/all?type=1&limit=50&genre!=7")
    unlimited = NS(childCount=61, smart=True, content="/library/sections/3/all?type=1&studio=Pixar")
    static = NS(childCount=6, smart=False, content=None)
    assert overview.item_count(smart) == 50
    assert overview.item_count(unlimited) == 61
    assert overview.item_count(static) == 6
