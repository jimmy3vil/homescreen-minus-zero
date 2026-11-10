def test_section_names_and_saved_views_end_to_end(tmp_path):
    import os
    import subprocess
    import sys
    import textwrap

    script = textwrap.dedent('''
        from homescreen_hero.core.db import init_db
        from homescreen_hero.core import collections_page_settings as s
        init_db()
        assert s.set_section_name("Films", "!024", " Living Lists ") == {"!024": "Living Lists"}
        assert s.set_section_name("Films", "!024", "Community Lists") == {"!024": "Community Lists"}
        assert s.section_names("TV") == {}
        assert s.set_section_name("Films", "!024", "") == {}
        views = s.save_view("Films", "Unused directors", "group=Directors&last=never")
        assert [v["name"] for v in views] == ["Unused directors"]
        views = s.save_view("Films", "Unused directors", "group=Directors")
        assert len(views) == 1 and views[0]["params"] == "group=Directors"
        s.save_view("Films", "Pinned", "scope=pinned")
        assert [v["name"] for v in s.saved_views("Films")] == ["Pinned", "Unused directors"]
        assert s.delete_view("Films", views[0]["id"]) == [v for v in s.saved_views("Films")]
        assert [v["name"] for v in s.saved_views("Films")] == ["Pinned"]
        for bad in (lambda: s.save_view("Films", "  ", ""), lambda: s.set_section_name("Films", " ", "x")):
            try:
                bad()
                raise SystemExit("accepted a blank value")
            except ValueError:
                pass
        print("ok")
    ''')
    env = {**os.environ, "HOMESCREEN_HERO_DB": f"sqlite:///{tmp_path / 't.sqlite'}", "HOMESCREEN_HERO_LOG_DIR": str(tmp_path)}
    result = subprocess.run([sys.executable, "-c", script], env=env, capture_output=True, text=True, cwd=os.getcwd())
    assert result.returncode == 0, result.stderr[-2000:] + result.stdout[-500:]
    assert result.stdout.strip().endswith("ok")
