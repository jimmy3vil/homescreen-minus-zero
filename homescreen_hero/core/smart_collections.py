"""Plex smart collections, built from the same filters Plex's own editor uses.

Each library publishes its filterable fields, the operators for each field
type, the values available for tag-like fields, and its sort options. We hand
those to the UI, then turn the chosen rules into a Plex search URL and create
a smart collection from it, the same way Plex's web app does.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional
from urllib.parse import quote

from plexapi import utils

# Item types a smart collection can contain, per library type.
LIBTYPES: Dict[str, List[Dict[str, str]]] = {
    "movie": [{"key": "movie", "title": "Movies"}],
    "show": [
        {"key": "show", "title": "Shows"},
        {"key": "season", "title": "Seasons"},
        {"key": "episode", "title": "Episodes"},
    ],
}

# Fields Plex lists that only make sense internally, never offered as rules.
HIDDEN_FIELDS = {"guid", "id", "index", "group", "having"}

# Relative date values Plex accepts, e.g. "-30d" = 30 days ago.
_RELATIVE_DATE = re.compile(r"^-?\d+[dwmy]$")
_ABSOLUTE_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


@dataclass
class SmartRule:
    field: str      # Plex field key, e.g. "genre", "year", "show.title"
    operator: str   # Plex operator key, e.g. "=", "!=", ">>=", "<<="
    value: str      # tag choice key, number, text, date or relative date


@dataclass
class SmartQuery:
    libtype: str
    match: Literal["all", "any"] = "all"
    rules: List[SmartRule] = field(default_factory=list)
    sort: Optional[str] = None      # sort key, optionally with ":desc"
    limit: Optional[int] = None


def default_libtype(section) -> str:
    return LIBTYPES.get(section.type, [{"key": section.type}])[0]["key"]


def filter_schema(section, libtype: Optional[str] = None) -> Dict[str, Any]:
    # Everything the UI needs to build rules for this library and item type.
    libtype = libtype or default_libtype(section)
    choice_fields = {f.filter for f in section.listFilters(libtype)}

    fields = []
    field_types = set()
    for f in section.listFields(libtype):
        short = f.key.split(".")[-1]
        if short in HIDDEN_FIELDS:
            continue
        fields.append({
            "key": f.key,
            "title": f.title,
            "type": f.type,
            "has_choices": short in choice_fields,
        })
        field_types.add(f.type)

    operators = {
        t: [{"key": o.key, "title": o.title} for o in section.listOperators(t)]
        for t in sorted(field_types)
    }
    sorts = [
        {"key": s.key, "title": s.title, "desc_key": s.descKey}
        for s in section.listSorts(libtype)
    ]
    return {
        "libtype": libtype,
        "libtypes": LIBTYPES.get(section.type, [{"key": libtype, "title": libtype.title()}]),
        "fields": fields,
        "operators": operators,
        "sorts": sorts,
    }


def filter_choices(section, field_key: str, libtype: Optional[str] = None) -> List[Dict[str, str]]:
    # Values available for a tag-like field (genres, actors, studios, ...).
    libtype = libtype or default_libtype(section)
    short = field_key.split(".")[-1]
    return [
        {"key": str(c.key), "title": c.title}
        for c in section.listFilterChoices(short, libtype)
    ]


def _validate(section, query: SmartQuery) -> Dict[str, Any]:
    allowed_libtypes = {t["key"] for t in LIBTYPES.get(section.type, [])} or {query.libtype}
    if query.libtype not in allowed_libtypes:
        raise ValueError(f"'{query.libtype}' items can't be collected in a {section.type} library")

    fields = {f.key: f for f in section.listFields(query.libtype)}
    for rule in query.rules:
        f = fields.get(rule.field)
        if f is None:
            raise ValueError(f"Unknown filter field '{rule.field}'")
        ops = {o.key for o in section.listOperators(f.type)}
        if rule.operator not in ops:
            raise ValueError(f"Operator '{rule.operator}' isn't valid for '{f.title}'")
        value = str(rule.value).strip()
        if value == "":
            raise ValueError(f"'{f.title}' needs a value")
        if f.type == "integer" and not re.fullmatch(r"-?\d+(\.\d+)?", value):
            raise ValueError(f"'{f.title}' needs a number")
        if f.type == "date" and not (_RELATIVE_DATE.match(value) or _ABSOLUTE_DATE.match(value)):
            raise ValueError(f"'{f.title}' needs a date (YYYY-MM-DD) or a relative date like -30d")
        if f.type == "boolean" and value not in {"0", "1"}:
            raise ValueError(f"'{f.title}' must be yes or no")

    if query.sort:
        base = query.sort.split(":")[0]
        if base not in {s.key for s in section.listSorts(query.libtype)}:
            raise ValueError(f"Unknown sort '{query.sort}'")
    if query.limit is not None and query.limit < 1:
        raise ValueError("Limit must be at least 1")
    return fields


def _date_value(value: str) -> str:
    # Plex wants absolute dates as unix timestamps; relative ones pass through.
    if _ABSOLUTE_DATE.match(value):
        from datetime import datetime, timezone
        return str(int(datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp()))
    return value if value.startswith("-") else f"-{value}"


def build_search_key(section, query: SmartQuery) -> str:
    # The /library/sections/<id>/all?... URL Plex stores as the smart
    # collection's definition. Rules are "<field><operator><value>"; "match any"
    # wraps them in push/or/pop like Plex's own editor.
    fields = _validate(section, query)

    parts = [f"type={utils.searchType(query.libtype)}", "includeGuids=1"]
    if query.sort:
        parts.append(f"sort={quote(query.sort)}")
    if query.limit:
        parts.append(f"limit={int(query.limit)}")

    rule_parts = []
    for rule in query.rules:
        f = fields[rule.field]
        value = str(rule.value).strip()
        if f.type == "date":
            value = _date_value(value)
        rule_parts.append(f"{quote(rule.field)}{rule.operator}{quote(value)}")

    if rule_parts:
        if query.match == "any" and len(rule_parts) > 1:
            parts.append("push=1")
            parts.append("&or=1&".join(rule_parts))
            parts.append("pop=1")
        else:
            parts.extend(rule_parts)

    return f"/library/sections/{section.key}/all?" + "&".join(parts)


def preview(server, section, query: SmartQuery, size: int = 30) -> Dict[str, Any]:
    # How many items match, plus the first few for a poster strip.
    key = build_search_key(section, query)
    data = server.query(f"{key}&X-Plex-Container-Start=0&X-Plex-Container-Size={size}")
    total = int(data.attrib.get("totalSize", data.attrib.get("size", 0)))
    if query.limit:
        total = min(total, int(query.limit))
    items = [
        {
            "title": el.attrib.get("title"),
            "year": el.attrib.get("year"),
            "thumb": el.attrib.get("thumb"),
            "rating_key": el.attrib.get("ratingKey"),
        }
        for el in data
        if el.attrib.get("ratingKey")
    ]
    return {"count": total, "items": items[:size]}


def create_smart_collection(server, section, title: str, query: SmartQuery):
    key = build_search_key(section, query)
    args = {
        "uri": f"{server._uriRoot()}{key}",
        "type": utils.searchType(query.libtype),
        "title": title,
        "smart": 1,
        "sectionId": section.key,
    }
    return server.query(f"/library/collections{utils.joinArgs(args)}", method=server._session.post)


def parse_smart_content(content: str) -> Dict[str, Any]:
    # Read the search URL Plex stores on a smart collection back into
    # {libtype_id, match, rules[{field, operator, value}], sort, limit}.
    # Nested groups beyond a single all/any level are flattened, with match
    # taken from the outermost group.
    from urllib.parse import unquote

    query = content.split("?", 1)[1] if "?" in content else ""
    result: Dict[str, Any] = {"type": None, "match": "all", "rules": [], "sort": None, "limit": None}
    depth = 0
    for part in query.split("&"):
        if not part:
            continue
        m = re.match(r"^([A-Za-z0-9.]+)([!<>]*)=(=?)(.*)$", part)
        if not m:
            continue
        key, prefix_ops, extra_eq, value = m.groups()
        value = unquote(value)
        if key == "type":
            result["type"] = value
        elif key == "sort":
            result["sort"] = value
        elif key == "limit":
            result["limit"] = int(value) if value.isdigit() else None
        elif key == "push":
            depth += 1
        elif key == "pop":
            depth = max(0, depth - 1)
        elif key == "or":
            if depth <= 1:
                result["match"] = "any"
        elif key == "and":
            continue
        elif key in {"includeGuids", "includeExternalMedia", "group", "having"}:
            continue
        else:
            result["rules"].append({"field": key, "operator": f"{prefix_ops}={extra_eq}", "value": value})
    return result


def describe_smart_collection(section, content: str) -> Dict[str, Any]:
    # Plain-language version of a smart collection's rules, e.g.
    # "Genre is Horror", "Date Added is after 30 days ago".
    from datetime import datetime, timezone

    parsed = parse_smart_content(content)
    type_by_id = {str(utils.searchType(t["key"])): t["key"] for t in LIBTYPES.get(section.type, [])}
    libtype = type_by_id.get(str(parsed["type"])) or default_libtype(section)

    fields = {f.key: f for f in section.listFields(libtype)}
    choice_fields = {f.filter for f in section.listFilters(libtype)}
    choice_titles: Dict[str, Dict[str, str]] = {}
    op_titles: Dict[str, Dict[str, str]] = {}

    lines = []
    for rule in parsed["rules"]:
        f = fields.get(rule["field"])
        if f is None:
            lines.append(f"{rule['field']} {rule['operator']} {rule['value']}")
            continue
        if f.type not in op_titles:
            op_titles[f.type] = {o.key: o.title for o in section.listOperators(f.type)}
        op = op_titles[f.type].get(rule["operator"], rule["operator"])
        value = rule["value"]
        short = f.key.split(".")[-1]
        if short in choice_fields:
            if short not in choice_titles:
                try:
                    choice_titles[short] = {str(c.key): c.title for c in section.listFilterChoices(short, libtype)}
                except Exception:
                    choice_titles[short] = {}
            value = ", ".join(choice_titles[short].get(v, v) for v in value.split(","))
        elif f.type == "date":
            rel = re.fullmatch(r"-?(\d+)([dwmy])", value)
            if rel:
                unit = {"d": "days", "w": "weeks", "m": "months", "y": "years"}[rel.group(2)]
                value = f"{rel.group(1)} {unit} ago"
            elif value.isdigit():
                value = datetime.fromtimestamp(int(value), tz=timezone.utc).strftime("%Y-%m-%d")
        elif f.type == "boolean":
            value = "true" if value == "1" else "false"
        lines.append(f"{f.title} {op} {value}")

    sort_text = None
    if parsed["sort"]:
        base, _, direction = parsed["sort"].partition(":")
        sorts = {s.key: s.title for s in section.listSorts(libtype)}
        sort_text = f"{sorts.get(base, base)}{' (descending)' if direction == 'desc' else ''}"

    return {
        "libtype": libtype,
        "match": parsed["match"],
        "rules": lines,
        "sort": sort_text,
        "limit": parsed["limit"],
    }
