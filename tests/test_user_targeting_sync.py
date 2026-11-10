from homescreen_hero.core import user_targeting as ut
from homescreen_hero.core.config.schema import AppConfig, CollectionGroupConfig, PlexLibraryConfig, PlexSettings, RotationSettings


def _config(groups):
    return AppConfig(
        plex=PlexSettings(base_url="x", token="t", libraries=[PlexLibraryConfig(name="Films", enabled=True)]),
        rotation=RotationSettings(),
        groups=groups,
    )


def test_no_targeting_means_no_plex_requests(monkeypatch):
    called = []
    monkeypatch.setattr(ut, "get_all_plex_users", lambda c: called.append("users") or [])
    monkeypatch.setattr(ut, "get_plex_account", lambda c: called.append("account"))
    ut.sync_all_user_filters(_config([CollectionGroupConfig(name="G", library="Films")]))
    assert called == []


def test_only_changed_filters_are_written(monkeypatch):
    users = [
        {"id": 1, "username": "amy", "title": "Amy", "is_admin": False},
        {"id": 2, "username": "bob", "title": "Bob", "is_admin": False},
        {"id": 3, "username": "me", "title": "Me", "is_admin": True},
    ]
    amy_label = ut._make_hide_label("amy")
    current = {
        "amy": {"filterMovies": f"label!={amy_label}", "filterTelevision": f"label!={amy_label}", "filterMusic": ""},
        "bob": {"filterMovies": "contentRating!=R", "filterTelevision": "", "filterMusic": ""},
    }
    writes = []
    monkeypatch.setattr(ut, "get_all_plex_users", lambda c: users)
    monkeypatch.setattr(ut, "get_plex_account", lambda c: object())
    monkeypatch.setattr(ut, "_read_current_filters", lambda acct, name, uid: current[name])
    monkeypatch.setattr(ut, "_set_user_filter", lambda acct, name, uid, m, t, mu="": writes.append((name, m, t)) or True)

    # Only Bob may see the group: Amy is excluded (already set), Bob has nothing to clean
    ut.sync_all_user_filters(_config([CollectionGroupConfig(name="G", library="Films", target_users=["bob"])]))
    assert writes == []

    # Now only Amy is targeted: Bob needs the exclusion added, Amy's must be cleaned
    ut.sync_all_user_filters(_config([CollectionGroupConfig(name="G", library="Films", target_users=["amy"])]))
    assert sorted(w[0] for w in writes) == ["amy", "bob"]
    bob = next(w for w in writes if w[0] == "bob")
    assert "contentRating!=R" in bob[1] and ut._make_hide_label("bob") in bob[1]
