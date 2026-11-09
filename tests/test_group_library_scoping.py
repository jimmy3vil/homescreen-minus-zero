"""Groups belong to one library; rotation only uses collections from it."""
from homescreen_hero.core import db as core_db
from homescreen_hero.core import service
from homescreen_hero.core.config.schema import (
    AppConfig,
    CollectionGroupConfig,
    PlexLibraryConfig,
    PlexSettings,
    RotationSettings,
    SmartGroupRule,
)
from homescreen_hero.core.db import history as db_history
from homescreen_hero.core.group_libraries import assign_missing_group_libraries, infer_group_library
from homescreen_hero.core.integrations import plex_client
from homescreen_hero.core.smart_groups import CollectionMetadata


# ---------------------------------------------------------------- fakes

class FakeHub:
    def __init__(self, section, coll, promoted=False, rec=False):
        self.section, self.coll, self.title = section, coll, coll.title
        self.identifier = f"custom.collection.{section.key}.{coll.ratingKey}"
        self._promoted = promoted
        self.deletable = True
        self.promotedToRecommended = rec
        self.promotedToOwnHome = False
        self.promotedToSharedHome = False

    def updateVisibility(self, recommended=None, home=None, shared=None):
        if recommended is not None:
            self.promotedToRecommended = recommended
        if home is not None:
            self.promotedToOwnHome = home
        if not self._promoted:
            self._promoted = True
            self.section.rows[self.title] = self
        return self

    def remove(self):
        del self.section.rows[self.title]

    def move(self, after=None):
        pass


class FakeCollection:
    def __init__(self, section, title, key):
        self.section, self.title, self.ratingKey = section, title, key
        self.librarySectionID = section.key

    def visibility(self):
        return self.section.rows.get(self.title) or FakeHub(self.section, self)


class FakeSection:
    _next_key = 1

    def __init__(self, title, names, type_="movie"):
        self.title, self.type = title, type_
        self.key = FakeSection._next_key
        FakeSection._next_key += 1
        self._colls = {n: FakeCollection(self, n, self.key * 1000 + i) for i, n in enumerate(names)}
        self.rows = {}

    def collections(self):
        return list(self._colls.values())

    def managedHubs(self):
        return list(self.rows.values())


class FakeServer:
    def __init__(self, *sections):
        self._sections = {s.title: s for s in sections}
        self.library = self

    def sections(self):
        return list(self._sections.values())

    def section(self, name):
        return self._sections[name]


def _config(groups, enabled=("Films", "movies-test")):
    return AppConfig(
        plex=PlexSettings(
            base_url="http://x",
            token="t",
            libraries=[PlexLibraryConfig(name=n, enabled=n in enabled) for n in ("Films", "movies-test")],
        ),
        rotation=RotationSettings(enabled=True, max_collections=10),
        groups=groups,
    )


# ------------------------------------------------- inferring a group's library

NAMES = {"Films": {"A", "B", "Shared"}, "movies-test": {"Shared", "T1"}}


def test_infer_picks_library_with_most_collections():
    assert infer_group_library({"collections": ["A", "B", "Shared"]}, NAMES, ["Films"]) == "Films"


def test_infer_tie_prefers_enabled_library():
    assert infer_group_library({"collections": ["Shared"]}, NAMES, ["movies-test"]) == "movies-test"


def test_infer_uses_single_library_rule_for_smart_groups():
    group = {"smart": True, "rules": [{"field": "library", "operator": "is", "values": ["movies-test"]}]}
    assert infer_group_library(group, NAMES, []) == "movies-test"


def test_infer_returns_none_when_no_collection_exists():
    assert infer_group_library({"collections": ["Gone"]}, NAMES, ["Films"]) is None


def test_assign_only_fills_missing_libraries():
    server = FakeServer(FakeSection("Films", ["A"]), FakeSection("movies-test", ["T1"]))
    data = {
        "plex": {"libraries": [{"name": "Films", "enabled": True}]},
        "groups": [
            {"name": "Old", "collections": ["A"]},
            {"name": "Set", "library": "movies-test", "collections": ["A"]},
            {"name": "Empty", "collections": []},
        ],
    }
    assert assign_missing_group_libraries(server, data) == {"Old": "Films"}
    assert [g.get("library") for g in data["groups"]] == ["Films", "movies-test", None]


# ------------------------------------------- resolving pools within a library

def test_pools_are_scoped_to_each_groups_library(monkeypatch):
    server = FakeServer(FakeSection("Films", ["A", "Shared"]), FakeSection("movies-test", ["Shared", "T1"]))
    monkeypatch.setattr(
        service,
        "build_collection_metadata",
        lambda _s, _c: [
            CollectionMetadata(name="A", source="plex", library="Films"),
            CollectionMetadata(name="Shared", source="plex", library="Films"),
            CollectionMetadata(name="Shared", source="plex", library="movies-test"),
            CollectionMetadata(name="T1", source="plex", library="movies-test"),
        ],
    )
    config = _config(
        [
            CollectionGroupConfig(name="Manual test", library="movies-test", collections=["A", "Shared", "T1"]),
            CollectionGroupConfig(
                name="Smart test",
                library="movies-test",
                smart=True,
                rules=[SmartGroupRule(field="name", operator="contains", values=["T", "S"])],
            ),
            CollectionGroupConfig(name="Off", library="Films", collections=["A"]),
            CollectionGroupConfig(name="Legacy", collections=["A"]),
        ],
        enabled=("movies-test",),
    )

    pools = service._resolve_smart_groups(server, config)

    assert pools["Manual test"] == ["Shared", "T1"]
    assert pools["Smart test"] == ["Shared", "T1"]
    assert pools["Off"] == []
    assert "Legacy" not in pools  # no library: old behaviour, raw list


# ------------------------------- applying: same name in two libraries

def test_selected_collection_is_shown_from_its_groups_library(monkeypatch):
    films = FakeSection("Films", ["Shared"])
    test = FakeSection("movies-test", ["Shared"])
    films.rows["Shared"] = FakeHub(films, films._colls["Shared"], promoted=True, rec=True)
    server = FakeServer(films, test)

    monkeypatch.setattr(plex_client.time, "sleep", lambda _s: None)
    monkeypatch.setattr(db_history, "get_rotation_history_context", lambda: (0, {}))
    monkeypatch.setattr(core_db, "get_pinned_collections", lambda: [])

    config = _config([CollectionGroupConfig(name="G", library="movies-test", collections=["Shared"])])
    plex_client.apply_home_screen_selection(
        server,
        config,
        ["Shared"],
        {"Shared": {"recommended": True, "home": False, "shared": False}},
        smart_group_collections={"G": ["Shared"]},
    )

    assert "Shared" in test.rows and test.rows["Shared"].promotedToRecommended
    assert "Shared" not in films.rows
