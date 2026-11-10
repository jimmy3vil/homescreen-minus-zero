from types import SimpleNamespace as NS

import pytest

from homescreen_hero.core.smart_collections import (
    SmartQuery,
    SmartRule,
    build_search_key,
    filter_schema,
)


class FakeSection:
    key = 7
    type = "movie"

    def listFields(self, libtype=None):
        return [
            NS(key="title", title="Title", type="string"),
            NS(key="genre", title="Genre", type="tag"),
            NS(key="year", title="Year", type="integer"),
            NS(key="addedAt", title="Date Added", type="date"),
            NS(key="unwatched", title="Unplayed", type="boolean"),
            NS(key="guid", title="Guid", type="guid"),
            NS(key="index", title="Index", type="integer"),
        ]

    def listFilters(self, libtype=None):
        return [NS(filter="genre"), NS(filter="year")]

    def listOperators(self, field_type):
        return {
            "string": [NS(key="=", title="contains"), NS(key="==", title="is")],
            "tag": [NS(key="=", title="is"), NS(key="!=", title="is not")],
            "integer": [NS(key="=", title="is"), NS(key=">>=", title="is greater than")],
            "date": [NS(key="<<=", title="is before"), NS(key=">>=", title="is after")],
            "boolean": [NS(key="=", title="is")],
        }[field_type]

    def listSorts(self, libtype=None):
        return [NS(key="titleSort", title="Title", descKey="titleSort:desc")]


def test_match_all_joins_rules():
    key = build_search_key(
        FakeSection(),
        SmartQuery(
            libtype="movie",
            rules=[SmartRule("genre", "=", "87"), SmartRule("year", ">>=", "1999")],
            sort="titleSort:desc",
            limit=50,
        ),
    )
    assert key == (
        "/library/sections/7/all?type=1&includeGuids=1&sort=titleSort%3Adesc&limit=50"
        "&genre=87&year>>=1999"
    )


def test_match_any_wraps_rules_in_or_group():
    key = build_search_key(
        FakeSection(),
        SmartQuery(
            libtype="movie",
            match="any",
            rules=[SmartRule("genre", "=", "87"), SmartRule("genre", "=", "12")],
        ),
    )
    assert key.endswith("&push=1&genre=87&or=1&genre=12&pop=1")


def test_relative_and_absolute_dates():
    key = build_search_key(
        FakeSection(),
        SmartQuery(
            libtype="movie",
            rules=[SmartRule("addedAt", ">>=", "30d"), SmartRule("addedAt", "<<=", "2020-01-01")],
        ),
    )
    assert "addedAt>>=-30d" in key
    assert "addedAt<<=1577836800" in key


@pytest.mark.parametrize(
    "rule, message",
    [
        (SmartRule("nope", "=", "x"), "Unknown filter field"),
        (SmartRule("genre", ">>=", "x"), "isn't valid"),
        (SmartRule("year", "=", "nineteen"), "needs a number"),
        (SmartRule("addedAt", ">>=", "last week"), "needs a date"),
        (SmartRule("title", "=", "  "), "needs a value"),
    ],
)
def test_invalid_rules_are_rejected(rule, message):
    with pytest.raises(ValueError, match=message):
        build_search_key(FakeSection(), SmartQuery(libtype="movie", rules=[rule]))


def test_show_items_rejected_in_movie_library():
    with pytest.raises(ValueError, match="can't be collected"):
        build_search_key(FakeSection(), SmartQuery(libtype="episode"))


def test_schema_marks_fields_with_choices():
    schema = filter_schema(FakeSection())
    by_key = {f["key"]: f for f in schema["fields"]}
    assert by_key["genre"]["has_choices"] and not by_key["title"]["has_choices"]
    assert "guid" not in by_key and "index" not in by_key
    assert set(schema["operators"]) == {"string", "tag", "integer", "date", "boolean"}
    assert schema["libtypes"] == [{"key": "movie", "title": "Movies"}]


NESTED = {
    "match": "all",
    "conditions": [
        {"field": "year", "operator": ">>=", "value": "1990"},
        {
            "match": "any",
            "conditions": [
                {"field": "genre", "operator": "=", "value": "87"},
                {"match": "all", "conditions": [
                    {"field": "title", "operator": "=", "value": "alien"},
                    {"field": "unwatched", "operator": "=", "value": "1"},
                ]},
            ],
        },
    ],
}


def test_rule_groups_render_like_plex():
    key = build_search_key(FakeSection(), SmartQuery(libtype="movie", tree=NESTED))
    assert key.endswith(
        "&year>>=1990"
        "&push=1&genre=87&or=1&push=1&title=alien&and=1&unwatched=1&pop=1&pop=1"
    )


def test_rule_groups_round_trip_through_plex_format():
    from homescreen_hero.core.smart_collections import parse_smart_content

    key = build_search_key(FakeSection(), SmartQuery(libtype="movie", tree=NESTED))
    parsed = parse_smart_content(key)
    assert parsed["tree"] == NESTED
    assert parsed["nested"]
    assert [r["field"] for r in parsed["rules"]] == ["year", "genre", "title", "unwatched"]


def test_top_level_any_is_unwrapped():
    from homescreen_hero.core.smart_collections import parse_smart_content

    tree = {"match": "any", "conditions": [{"field": "genre", "operator": "=", "value": "1"}, {"field": "genre", "operator": "=", "value": "2"}]}
    key = build_search_key(FakeSection(), SmartQuery(libtype="movie", tree=tree))
    assert parse_smart_content(key)["tree"] == tree


def test_empty_rule_group_is_rejected():
    tree = {"match": "all", "conditions": [{"match": "any", "conditions": []}]}
    with pytest.raises(ValueError, match="empty"):
        build_search_key(FakeSection(), SmartQuery(libtype="movie", tree=tree))


def test_rules_inside_groups_are_validated():
    tree = {"match": "all", "conditions": [{"match": "any", "conditions": [{"field": "year", "operator": "=", "value": "soon"}]}]}
    with pytest.raises(ValueError, match="needs a number"):
        build_search_key(FakeSection(), SmartQuery(libtype="movie", tree=tree))


def test_preview_pages_and_respects_limit():
    import xml.etree.ElementTree as ET

    from homescreen_hero.core.smart_collections import preview

    asked = []

    class Server:
        def query(self, key):
            asked.append(key)
            root = ET.Element("MediaContainer", totalSize="367")
            start = int(key.split("X-Plex-Container-Start=")[1].split("&")[0])
            size = int(key.split("X-Plex-Container-Size=")[1])
            for i in range(start, start + size):
                v = ET.SubElement(root, "Video", ratingKey=str(i), title=f"Film {i}", year="1999",
                                  duration="5400000", contentRating="PG", audienceRating="7.5")
                ET.SubElement(v, "Genre", tag="Comedy")
            return root

    q = SmartQuery(libtype="movie", limit=50, rules=[SmartRule("genre", "=", "87")])
    first = preview(Server(), FakeSection(), q, start=0, size=30)
    assert first["count"] == 50 and len(first["items"]) == 30
    item = first["items"][0]
    assert item["duration_minutes"] == 90 and item["rating"] == 7.5
    assert item["genres"] == ["Comedy"] and item["content_rating"] == "PG"
    second = preview(Server(), FakeSection(), q, start=30, size=30)
    assert len(second["items"]) == 20  # stops at the limit
    unlimited = preview(Server(), FakeSection(), SmartQuery(libtype="movie"), start=60, size=60)
    assert unlimited["count"] == 367 and unlimited["start"] == 60 and len(unlimited["items"]) == 60


def test_matching_keys_respects_limit_and_cap():
    import xml.etree.ElementTree as ET

    from homescreen_hero.core.smart_collections import matching_keys

    class Server:
        def query(self, key):
            root = ET.Element("MediaContainer", totalSize="300")
            size = int(key.split("X-Plex-Container-Size=")[1])
            for i in range(min(size, 300)):
                ET.SubElement(root, "Video", ratingKey=str(i))
            return root

    everything = matching_keys(Server(), FakeSection(), SmartQuery(libtype="movie"))
    assert everything["count"] == 300 and len(everything["keys"]) == 300 and not everything["capped"]
    limited = matching_keys(Server(), FakeSection(), SmartQuery(libtype="movie", limit=50))
    assert limited["count"] == 50 and len(limited["keys"]) == 50
    capped = matching_keys(Server(), FakeSection(), SmartQuery(libtype="movie"), cap=100)
    assert capped["capped"] and len(capped["keys"]) == 100


def test_previews_without_a_sort_use_title_order():
    import xml.etree.ElementTree as ET

    from homescreen_hero.core.smart_collections import preview

    asked = []

    class Server:
        def query(self, key):
            asked.append(key)
            return ET.Element("MediaContainer", totalSize="0")

    preview(Server(), FakeSection(), SmartQuery(libtype="movie"))
    preview(Server(), FakeSection(), SmartQuery(libtype="movie", sort="titleSort:desc"))
    assert "sort=titleSort&" in asked[0]
    assert "sort=titleSort%3Adesc" in asked[1]
