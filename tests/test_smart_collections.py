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
