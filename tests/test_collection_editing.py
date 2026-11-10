from types import SimpleNamespace as NS

import pytest
import yaml

from homescreen_hero.core import collection_editing as editing
from homescreen_hero.core.smart_collections import parse_smart_content
from homescreen_hero.web.routers.config.groups import set_group_membership


def test_membership_adds_and_removes_from_manual_groups():
    groups = [{"name": "Actors", "collections": ["A"]}, {"name": "Smart", "smart": True, "rules": []}]
    assert set_group_membership(groups, "Actors", "B", True)
    assert groups[0]["collections"] == ["A", "B"]
    assert not set_group_membership(groups, "Actors", "B", True)  # already there
    assert set_group_membership(groups, "Actors", "A", False)
    assert groups[0]["collections"] == ["B"]
    with pytest.raises(ValueError, match="smart group"):
        set_group_membership(groups, "Smart", "A", True)
    with pytest.raises(LookupError):
        set_group_membership(groups, "Nope", "A", True)


def test_rename_updates_groups_in_that_library(monkeypatch, tmp_path):
    config = {
        "groups": [
            {"name": "Films group", "library": "Films", "collections": ["Old", "Other"]},
            {"name": "TV group", "library": "TV", "collections": ["Old"]},
        ]
    }
    saved = {}
    monkeypatch.setattr("homescreen_hero.core.config.loader.load_config_text", lambda: yaml.safe_dump(config))
    monkeypatch.setattr("homescreen_hero.core.config.loader.save_config_text", lambda text: saved.setdefault("text", text))

    class FakeSession:
        def execute(self, *_a, **_k):
            return NS(scalar_one_or_none=lambda: None)

    from contextlib import contextmanager

    @contextmanager
    def fake_scope():
        yield FakeSession()

    monkeypatch.setattr("homescreen_hero.core.db.session_scope", fake_scope)

    changed = editing.propagate_rename("Films", "Old", "New")
    groups = yaml.safe_load(saved["text"])["groups"]
    assert changed["groups"] == 1
    assert groups[0]["collections"] == ["New", "Other"]
    assert groups[1]["collections"] == ["Old"]  # other library untouched


def test_save_advanced_validates_by_collection_type():
    calls = []
    static = NS(smart=False, modeUpdate=lambda mode: calls.append(("mode", mode)), sortUpdate=lambda sort: calls.append(("sort", sort)))
    editing.save_advanced(static, "hideItems", "alpha", None)
    assert calls == [("mode", "hideItems"), ("sort", "alpha")]
    with pytest.raises(ValueError, match="Only smart"):
        editing.save_advanced(static, None, None, "user")
    smart = NS(smart=True)
    with pytest.raises(ValueError, match="smart collection's order"):
        editing.save_advanced(smart, None, "alpha", None)
    with pytest.raises(ValueError, match="Unknown collection mode"):
        editing.save_advanced(static, "sideways", None, None)


def test_nested_rule_groups_are_flagged():
    flat = parse_smart_content("/library/sections/1/all?type=1&push=1&genre=1&or=1&genre=2&pop=1")
    nested = parse_smart_content("/library/sections/1/all?type=1&push=1&push=1&genre=1&or=1&genre=2&pop=1&and=1&year>>=2000&pop=1")
    assert not flat["nested"] and nested["nested"]


def test_artwork_links_must_be_http():
    coll = NS(uploadPoster=lambda **kw: None)
    with pytest.raises(ValueError, match="http"):
        editing.upload_artwork(coll, "poster", url="file:///etc/passwd")
    with pytest.raises(ValueError, match="Unknown artwork"):
        editing.upload_artwork(coll, "banner", url="https://x/y.jpg")


def test_item_edits_only_for_manual_collections():
    smart = NS(smart=True)
    with pytest.raises(ValueError, match="filters"):
        editing.remove_item(smart, "5")
    with pytest.raises(ValueError, match="filters"):
        editing.add_items(None, smart, ["5"])


class _QueryServer:
    # Records Plex requests; answers collection creation with a new rating key
    def __init__(self):
        self.calls = []
        self.fetchItem = lambda k: NS(ratingKey=k, type="movie")

    def _uriRoot(self):
        return "server://abc/com.plexapp.plugins.library"

    _session = NS(put="PUT", post="POST")

    def query(self, key, method=None):
        import xml.etree.ElementTree as ET

        self.calls.append((method, key))
        root = ET.Element("MediaContainer")
        ET.SubElement(root, "Directory", ratingKey="900")
        return root


def _added_keys(calls):
    from urllib.parse import parse_qs, urlparse

    out = []
    for method, key in calls:
        uri = parse_qs(urlparse(key).query)["uri"][0]
        out.append((method, uri.split("/library/metadata/")[1].split(",")))
    return out


def test_add_items_skips_ones_already_in_the_collection_and_batches():
    server = _QueryServer()
    coll = NS(smart=False, ratingKey=55, items=lambda: [NS(ratingKey=1)])
    keys = ["1"] + [str(i) for i in range(2, 252)] + ["2"]
    assert editing.add_items(server, coll, keys) == 250
    batches = _added_keys(server.calls)
    assert [len(b) for _, b in batches] == [100, 100, 50]
    assert batches[0][1][0] == "2" and all(m == "PUT" for m, _ in batches)
    assert all("/library/collections/55/items" in k for _, k in server.calls)


def test_too_many_items_at_once_is_refused():
    with pytest.raises(ValueError, match="at most 2000"):
        editing.add_items(_QueryServer(), NS(smart=False, ratingKey=1, items=lambda: []), [str(i) for i in range(2001)])


def test_create_manual_collection_in_one_go():
    server = _QueryServer()
    section = NS(key=7, title="Films", collections=lambda: [NS(title="Existing", ratingKey=1)])
    rk = editing.create_manual_collection(server, section, " Picks ", [str(i) for i in range(1, 151)])
    assert rk == "900"
    (create_method, create_key), (add_method, add_key) = server.calls
    assert create_method == "POST" and "title=Picks" in create_key and "smart=0" in create_key and "sectionId=7" in create_key
    assert len(_added_keys([(create_method, create_key)])[0][1]) == 100
    assert add_method == "PUT" and "/library/collections/900/items" in add_key
    with pytest.raises(FileExistsError):
        editing.create_manual_collection(server, section, "Existing", ["1"])
    with pytest.raises(ValueError, match="at least one"):
        editing.create_manual_collection(server, section, "New", [])


def test_move_requires_custom_order():
    moves = []
    coll = NS(smart=False, collectionSort=0, moveItem=lambda item, after=None: moves.append((item.ratingKey, after and after.ratingKey)))
    with pytest.raises(ValueError, match="Custom"):
        editing.move_item(coll, "5", "6")
    coll.collectionSort = 2
    editing.move_item(coll, "5", "6")
    editing.move_item(coll, "7", None)
    assert moves == [(5, 6), (7, None)]


def test_shared_traits_need_most_items():
    items = [
        {"genres": ["Animation", "Family"], "studio": "Pixar", "year": 1995, "content_rating": "G"},
        {"genres": ["Animation", "Comedy"], "studio": "Pixar", "year": 1999, "content_rating": "G"},
        {"genres": ["Animation"], "studio": "Disney", "year": 2010, "content_rating": "PG"},
        {"genres": ["Drama"], "studio": "Pixar", "year": 2019, "content_rating": "G"},
    ]
    t = editing.shared_traits(items)
    assert t["genre"] == ["Animation"]
    assert t["studio"] == ["Pixar"]
    assert t["decade"] == []  # 1990s and 2010s are 2 of 4 each: not more than half
    assert t["content_rating"] == ["G"]
    assert editing.shared_traits(items[:1])["genre"] == []


def test_bulk_membership_counts_only_real_changes(monkeypatch):
    from homescreen_hero.web.routers.config import groups as groups_router

    store = {"groups": [{"name": "Actors", "collections": ["A"]}]}
    saved = {}
    monkeypatch.setattr(groups_router, "load_config_mapping", lambda: store)
    monkeypatch.setattr(groups_router, "save_config_mapping", lambda d: saved.setdefault("d", d))
    monkeypatch.setattr(groups_router, "get_config_path", lambda: "/data/config.yaml")
    req = groups_router.BulkGroupMembershipRequest(group="Actors", collections=["A", "B", "C", "B"], member=True)
    out = groups_router.update_group_membership_bulk(req, current_user=None)
    assert out.message == "Added 2 collections to group 'Actors'"
    assert saved["d"]["groups"][0]["collections"] == ["A", "B", "C"]
