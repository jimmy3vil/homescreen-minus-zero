from collections import Counter

from homescreen_hero.core.collection_stats import collection_plays, plays_by_item, trending_keys


def test_episode_plays_count_for_season_and_show():
    history = [
        {"rating_key": 101, "parent_rating_key": 10, "grandparent_rating_key": 1},  # episode
        {"rating_key": 102, "parent_rating_key": 10, "grandparent_rating_key": 1},
        {"rating_key": 500, "parent_rating_key": "", "grandparent_rating_key": ""},  # movie
    ]
    counts = plays_by_item(history)
    assert counts["1"] == 2 and counts["10"] == 2 and counts["101"] == 1 and counts["500"] == 1
    assert collection_plays({"1", "500"}, counts) == 3
    assert collection_plays({"999"}, counts) == 0


def test_trending_is_top_ten_by_plays_per_item_with_at_least_three_plays():
    rows = [{"rating_key": f"c{i}", "plays": 3 + i, "item_count": 10} for i in range(12)]
    rows += [
        {"rating_key": "small-hot", "plays": 6, "item_count": 2},   # 3.0 per item: top
        {"rating_key": "two-plays", "plays": 2, "item_count": 1},   # below 3 plays
        {"rating_key": "empty", "plays": 9, "item_count": 0},       # no items
        {"rating_key": "no-data", "plays": None, "item_count": 5},  # no Tautulli
    ]
    top = trending_keys(rows)
    assert len(top) == 10
    assert "small-hot" in top
    assert not {"two-plays", "empty", "no-data", "c0", "c1"} & top
    assert {"c11", "c10", "c3"} <= top


def test_fewer_than_ten_eligible_collections():
    assert trending_keys([{"rating_key": "a", "plays": 3, "item_count": 3}]) == {"a"}
    assert trending_keys([]) == set()


def test_collect_and_read_back_stats_end_to_end(tmp_path):
    # Runs in a fresh process with its own SQLite file, since the app picks
    # its database when first imported.
    import os
    import subprocess
    import sys
    import textwrap

    script = textwrap.dedent('''
        from datetime import datetime
        from types import SimpleNamespace as NS
        import xml.etree.ElementTree as ET
        from homescreen_hero.core import collection_stats as cs
        from homescreen_hero.core.db import init_db
        init_db()

        class Server:
            def __init__(self):
                self.library = NS(section=lambda name: NS(key=7, collections=lambda: [NS(ratingKey=1, title="A"), NS(ratingKey=2, title="B")]))
            def query(self, key):
                root = ET.Element("MediaContainer")
                kids = {"1": [("11", "1700000000"), ("12", "1710000000")], "2": [("21", "1600000000")]}
                cid = key.split("/")[3]
                for rk, added in kids[cid]:
                    ET.SubElement(root, "Video", ratingKey=rk, addedAt=added)
                return root

        class Tautulli:
            def get_library_history_since(self, section_id, after):
                assert section_id == 7
                return [{"rating_key": 11}, {"rating_key": 11}, {"rating_key": 12}, {"rating_key": 21}]

        import homescreen_hero.core.integrations.tautulli_client as tc
        tc.get_tautulli_client = lambda config: Tautulli()
        assert cs.stats_are_stale()
        assert cs.collect_library_stats(None, Server(), "Films") == 2
        stats = cs.latest_stats("Films")
        assert stats["1"]["plays"] == 3 and stats["1"]["item_count"] == 2
        assert stats["2"]["plays"] == 1
        assert stats["1"]["latest_item_added_at"] == datetime.utcfromtimestamp(1710000000)
        assert not cs.stats_are_stale()
        print("ok")
    ''')
    env = {**os.environ, "HOMESCREEN_HERO_DB": f"sqlite:///{tmp_path / 'test.sqlite'}", "HOMESCREEN_HERO_LOG_DIR": str(tmp_path)}
    result = subprocess.run([sys.executable, "-c", script], env=env, capture_output=True, text=True, cwd=os.getcwd())
    assert result.returncode == 0, result.stderr[-2000:]
    assert result.stdout.strip().endswith("ok")
