from homescreen_hero.core.config.schema import CollectionGroupConfig, SmartGroupRule
from homescreen_hero.core.smart_groups import CollectionMetadata
from homescreen_hero.web.routers.config.groups import compute_group_libraries


def _meta(name, library):
    return CollectionMetadata(name=name, source="plex", library=library)


def test_manual_and_smart_groups_map_to_libraries():
    metadata = [_meta("Spotlight on A", "Films"), _meta("Test Picks", "movies-test")]
    libraries_by_name = {
        "Spotlight on A": {"Films"},
        "Test Picks": {"movies-test"},
        "Trending": {"Films", "movies-test"},
    }
    groups = [
        CollectionGroupConfig(name="Actors", collections=["Spotlight on A"]),
        CollectionGroupConfig(name="Pins", collections=["Trending"]),
        CollectionGroupConfig(name="Gone", collections=["Deleted Collection"]),
        CollectionGroupConfig(
            name="Test smart",
            smart=True,
            rules=[SmartGroupRule(field="library", operator="is", values=["movies-test"])],
        ),
    ]

    result = compute_group_libraries(groups, metadata, libraries_by_name)

    assert result == {
        "Actors": ["Films"],
        "Pins": ["Films", "movies-test"],
        "Gone": [],
        "Test smart": ["movies-test"],
    }
