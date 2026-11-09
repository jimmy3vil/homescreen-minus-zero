from homescreen_hero.core.collection_types import detect_prefixes, resolve_type, sort_title_prefix

TYPES = [
    {"id": 1, "name": "Director", "color": "violet", "labels": ["Director"], "prefixes": [], "groups": ["Directors' Work"]},
    {"id": 2, "name": "Actor", "color": "rose", "labels": [], "prefixes": ["!010"], "groups": []},
    {"id": 3, "name": "Living Lists", "color": "amber", "labels": [], "prefixes": ["!024"], "groups": []},
]


def test_sort_title_prefixes():
    assert sort_title_prefix("!024 Spotlight on Al Pacino") == "!024"
    assert sort_title_prefix("!010_Actors Tom Hanks") == "!010"
    assert sort_title_prefix("~05 Silent Era") == "~05"
    assert sort_title_prefix("007 The Daniel Craig Era") == "007"
    assert sort_title_prefix("Trending Films") is None
    assert sort_title_prefix("!024") is None  # no title after it
    assert sort_title_prefix(None) is None


def test_detect_prefixes_counts_and_examples():
    rows = [{"title": "A", "sort_title": "!024 A"}, {"title": "B", "sort_title": "!024 B"}, {"title": "C", "sort_title": "!010 C"}, {"title": "D", "sort_title": "D"}]
    assert detect_prefixes(rows) == [{"prefix": "!024", "count": 2, "example": "A"}, {"prefix": "!010", "count": 1, "example": "C"}]


def test_priority_manual_then_label_then_prefix_then_group():
    c = {"labels": ["Director"], "sort_title": "!010 Hanks", "groups": ["Directors' Work"]}
    assert resolve_type(c, TYPES, 3)["name"] == "Living Lists"  # assigned by hand wins
    assert resolve_type(c, TYPES, None) == {"id": 1, "name": "Director", "color": "violet", "source": "label", "matched": "Director"}
    assert resolve_type({**c, "labels": []}, TYPES, None)["source"] == "prefix"
    by_group = resolve_type({"labels": [], "sort_title": "Nolan", "groups": ["Directors' Work"]}, TYPES, None)
    assert by_group["name"] == "Director" and by_group["source"] == "group"
    assert resolve_type({"labels": [], "sort_title": "Trending", "groups": []}, TYPES, None) is None
    # A hand assignment to a deleted type falls back to automatic
    assert resolve_type(c, TYPES, 99)["source"] == "label"


def test_save_assign_and_overview_end_to_end(tmp_path):
    import os
    import subprocess
    import sys
    import textwrap

    script = textwrap.dedent('''
        from homescreen_hero.core.db import init_db
        from homescreen_hero.core import collection_types as ct
        init_db()
        saved = ct.save_types("Films", [
            {"name": "Director", "color": "violet", "labels": ["Director"]},
            {"name": "Actor", "color": "nope", "prefixes": ["!010", "!010", " "]},
        ])
        assert [t["name"] for t in saved] == ["Director", "Actor"]
        assert saved[1]["color"] == "sky" and saved[1]["prefixes"] == ["!010"]
        actor = saved[1]["id"]
        ct.assign_type("Films", "55", actor)
        payload = {"library": "Films", "collections": [
            {"rating_key": "55", "title": "X", "sort_title": "X", "labels": ["Director"], "groups": []},
            {"rating_key": "56", "title": "Y", "sort_title": "!010 Y", "labels": [], "groups": []},
        ]}
        out = ct.with_types(payload)
        assert out["collections"][0]["type"]["name"] == "Actor" and out["collections"][0]["type"]["source"] == "manual"
        assert out["collections"][1]["type"]["source"] == "prefix"
        assert out["prefixes"] == [{"prefix": "!010", "count": 1, "example": "Y"}]
        # Removing a type removes its hand assignments; renaming keeps the id
        kept = ct.save_types("Films", [{"id": saved[0]["id"], "name": "Directors", "labels": ["Director"]}])
        assert kept[0]["id"] == saved[0]["id"] and ct.assignments("Films") == {}
        try:
            ct.save_types("Films", [{"name": "A"}, {"name": "a"}])
            raise SystemExit("duplicate names allowed")
        except ValueError:
            pass
        try:
            ct.assign_type("Films", "55", 999)
            raise SystemExit("unknown type allowed")
        except LookupError:
            pass
        print("ok")
    ''')
    env = {**os.environ, "HOMESCREEN_HERO_DB": f"sqlite:///{tmp_path / 't.sqlite'}", "HOMESCREEN_HERO_LOG_DIR": str(tmp_path)}
    result = subprocess.run([sys.executable, "-c", script], env=env, capture_output=True, text=True, cwd=os.getcwd())
    assert result.returncode == 0, result.stderr[-2000:] + result.stdout[-500:]
    assert result.stdout.strip().endswith("ok")
