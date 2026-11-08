"""Rotation must not add hidden collections to Plex's Manage Recommendations list.

The fake below mimics Plex: setting visibility on a collection that isn't in
Manage Recommendations creates a row for it (even with every flag off), and
remove() deletes the row.
"""
from homescreen_hero.core import db as core_db
from homescreen_hero.core.config.schema import (
    AppConfig,
    PlexLibraryConfig,
    PlexSettings,
    RotationSettings,
)
from homescreen_hero.core.db import history as db_history
from homescreen_hero.core.integrations import plex_client

SECTION_ID = 1


class FakeHub:
    def __init__(self, section, coll, promoted, rec=False, home=False, shared=False, deletable=True):
        self.section = section
        self.coll = coll
        self.title = coll.title
        self.identifier = f"custom.collection.{SECTION_ID}.{coll.ratingKey}"
        self._promoted = promoted
        self.deletable = deletable
        self.promotedToRecommended = rec
        self.promotedToOwnHome = home
        self.promotedToSharedHome = shared

    def updateVisibility(self, recommended=None, home=None, shared=None):
        if recommended is not None:
            self.promotedToRecommended = recommended
        if home is not None:
            self.promotedToOwnHome = home
        if shared is not None:
            self.promotedToSharedHome = shared
        if not self._promoted:
            self._promoted = True
            self.section.rows[self.title] = self
        return self

    def remove(self):
        del self.section.rows[self.title]
        self._promoted = False

    def move(self, after=None):
        pass


class FakeCollection:
    def __init__(self, section, title, key):
        self.section = section
        self.title = title
        self.ratingKey = key
        self.librarySectionID = SECTION_ID

    def visibility(self):
        return self.section.rows.get(self.title) or FakeHub(self.section, self, promoted=False)

    def sortUpdate(self, sort):
        pass


class FakeSection:
    def __init__(self, titles):
        self.title = "Films"
        self.collections = {t: FakeCollection(self, t, i + 100) for i, t in enumerate(titles)}
        self.rows: dict[str, FakeHub] = {}

    def promote(self, title, **flags):
        coll = self.collections[title]
        self.rows[title] = FakeHub(self, coll, promoted=True, **flags)

    def managedHubs(self):
        return list(self.rows.values())


class FakeServer:
    def __init__(self, section):
        self._section = section
        self.library = self

    def section(self, name):
        return self._section


def _config():
    return AppConfig(
        plex=PlexSettings(
            base_url="http://localhost:32400",
            token="t",
            libraries=[PlexLibraryConfig(name="Films", enabled=True)],
        ),
        rotation=RotationSettings(enabled=True, max_collections=10),
        groups=[],
    )


def _wire(monkeypatch, section, configured):
    monkeypatch.setattr(plex_client.time, "sleep", lambda _s: None)
    monkeypatch.setattr(plex_client, "get_library_collections", lambda _srv, _lib: dict(section.collections))
    monkeypatch.setattr(plex_client, "get_configured_collection_names", lambda *_a, **_k: set(configured))
    monkeypatch.setattr(db_history, "get_rotation_history_context", lambda: (0, {}))
    monkeypatch.setattr(core_db, "get_pinned_collections", lambda: [])


def test_rotation_only_lists_selected_collections(monkeypatch):
    titles = [f"Spotlight {i}" for i in range(20)]
    section = FakeSection(titles)
    _wire(monkeypatch, section, configured=titles)

    plex_client.apply_home_screen_selection(
        FakeServer(section),
        _config(),
        ["Spotlight 3"],
        {"Spotlight 3": {"home": False, "shared": False, "recommended": True}},
    )

    assert list(section.rows) == ["Spotlight 3"]
    assert section.rows["Spotlight 3"].promotedToRecommended is True


def test_rotated_out_collection_is_removed_not_hidden(monkeypatch):
    titles = ["A", "B", "C"]
    section = FakeSection(titles)
    section.promote("A", rec=True)
    section.promote("B", rec=True)
    _wire(monkeypatch, section, configured=titles)

    plex_client.apply_home_screen_selection(
        FakeServer(section),
        _config(),
        ["C"],
        {"C": {"home": False, "shared": False, "recommended": True}},
    )

    assert set(section.rows) == {"C"}


def test_undeletable_row_is_hidden_instead(monkeypatch):
    section = FakeSection(["A", "B"])
    section.promote("A", rec=True, deletable=False)
    _wire(monkeypatch, section, configured=["A", "B"])

    plex_client.apply_home_screen_selection(
        FakeServer(section), _config(), ["B"], {"B": {"recommended": True, "home": False}},
    )

    assert section.rows["A"].promotedToRecommended is False
    assert "B" in section.rows


def test_cleanup_removes_only_fully_hidden_collection_rows():
    section = FakeSection(["Hidden 1", "Hidden 2", "On Home", "Locked"])
    section.promote("Hidden 1")
    section.promote("Hidden 2")
    section.promote("On Home", home=True)
    section.promote("Locked", deletable=False)
    server = FakeServer(section)

    preview = plex_client.cleanup_hidden_managed_hubs(server, _config(), dry_run=True)
    assert {r["title"] for r in preview} == {"Hidden 1", "Hidden 2"}
    assert len(section.rows) == 4

    removed = plex_client.cleanup_hidden_managed_hubs(server, _config(), dry_run=False)
    assert {r["title"] for r in removed} == {"Hidden 1", "Hidden 2"}
    assert set(section.rows) == {"On Home", "Locked"}
