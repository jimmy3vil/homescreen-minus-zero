"""Each group belongs to one Plex library.

Older configs don't record a library on their groups. On startup we work it
out from where each group's collections live and save it to config.yaml, so
it can be seen and changed in the UI from then on.
"""
from __future__ import annotations

import logging
import shutil
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set

from .config.loader import get_config_path, load_config_text, save_config_text

logger = logging.getLogger(__name__)


def collection_names_by_library(server, library_names: Iterable[str] | None = None) -> Dict[str, Set[str]]:
    # Map library name -> collection titles in it. All movie/show libraries
    # when library_names is None.
    result: Dict[str, Set[str]] = {}
    for section in server.library.sections():
        if section.type not in ("movie", "show"):
            continue
        if library_names is not None and section.title not in library_names:
            continue
        try:
            result[section.title] = {c.title for c in section.collections()}
        except Exception as e:
            logger.warning("Could not list collections in '%s': %s", section.title, e)
    return result


def infer_group_library(
    group: dict,
    names_by_library: Dict[str, Set[str]],
    enabled_libraries: List[str],
) -> Optional[str]:
    # Pick the library holding most of the group's collections. Smart groups
    # with a single "library is X" rule use that. Ties go to an enabled library,
    # then alphabetical. None when no collection is found anywhere.
    if group.get("smart"):
        for rule in group.get("rules") or []:
            values = rule.get("values") or []
            if rule.get("field") == "library" and rule.get("operator") == "is" and len(values) == 1:
                return str(values[0])

    counts: Counter = Counter()
    for name in group.get("collections") or []:
        for library, names in names_by_library.items():
            if name in names:
                counts[library] += 1
    if not counts:
        return None
    return sorted(
        counts.items(),
        key=lambda kv: (-kv[1], kv[0] not in enabled_libraries, kv[0]),
    )[0][0]


def assign_missing_group_libraries(server, data: dict) -> Dict[str, str]:
    # Fill in `library` on groups that don't have one. Mutates `data` (the raw
    # config mapping) and returns {group name: library} for what changed.
    groups = data.get("groups") or []
    missing = [g for g in groups if isinstance(g, dict) and not g.get("library")]
    if not missing:
        return {}

    enabled = [
        lib.get("name")
        for lib in (data.get("plex") or {}).get("libraries") or []
        if isinstance(lib, dict) and lib.get("enabled", True)
    ]
    names_by_library = collection_names_by_library(server)

    assigned: Dict[str, str] = {}
    for group in missing:
        library = infer_group_library(group, names_by_library, enabled)
        if library:
            group["library"] = library
            assigned[group.get("name", "?")] = library
    return assigned


def migrate_group_libraries_on_startup(server) -> Dict[str, str]:
    # Assign libraries to older groups and save config.yaml, keeping a
    # timestamped backup of the previous file next to it.
    import yaml

    data = yaml.safe_load(load_config_text()) or {}
    assigned = assign_missing_group_libraries(server, data)
    if not assigned:
        return {}

    config_path = Path(get_config_path())
    backup = config_path.with_name(
        f"{config_path.stem}.before-group-libraries-{datetime.now():%Y%m%d-%H%M%S}{config_path.suffix}"
    )
    shutil.copy2(config_path, backup)
    save_config_text(yaml.safe_dump(data, sort_keys=False))
    logger.info(
        "Assigned libraries to %d group(s) (backup at %s): %s",
        len(assigned),
        backup,
        assigned,
    )
    return assigned
