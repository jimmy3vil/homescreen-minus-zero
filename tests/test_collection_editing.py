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
