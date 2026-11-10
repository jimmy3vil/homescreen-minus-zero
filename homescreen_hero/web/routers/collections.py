from datetime import datetime
from typing import List, Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from pydantic import BaseModel
import logging
import random
import requests
import tempfile
import os

from homescreen_hero.core.config.loader import load_config
from homescreen_hero.core.config.schema import HealthResponse
from homescreen_hero.core.auth import CurrentUser, get_current_user, require_admin
from homescreen_hero.core.db.history import init_db
from homescreen_hero.core.db.tools import list_rotations
from homescreen_hero.core.db.pinning import (
    get_pinned_collections,
    get_pinned_collection_names,
    is_collection_pinned,
    pin_collection,
    unpin_collection,
    get_display_order,
    update_display_order,
)
from homescreen_hero.core.integrations.plex_client import (
    get_plex_server,
    reorder_homescreen_collections,
    get_library_collections,
    remove_or_hide_hub,
    cleanup_hidden_managed_hubs,
)
from homescreen_hero.core.poster_proxy import (
    create_proxy_url,
    serve_proxy_poster,
    build_collection_poster_url,
    invalidate_poster_caches,
)


class ActiveCollectionOut(BaseModel):
    title: str
    library: Optional[str] = None
    poster_url: Optional[str] = None
    promoted_to_own_home: bool = False
    promoted_to_shared: bool = False
    promoted_to_recommended: bool = False
    is_pinned: bool = False
    display_order: int = 0


class ActiveCollectionsResponse(BaseModel):
    collections: List[ActiveCollectionOut]


class PinnedCollectionOut(BaseModel):
    collection_name: str
    library_name: str
    display_order: int
    pinned_at: datetime


class PinnedCollectionsResponse(BaseModel):
    pinned: List[PinnedCollectionOut]


class TogglePinRequest(BaseModel):
    collection_name: str
    library: str
    # Visibility options - if all None, this is an unpin request
    # If any are provided, this is a pin or update request
    home: Optional[bool] = None
    shared: Optional[bool] = None
    recommended: Optional[bool] = None


class TogglePinResponse(BaseModel):
    success: bool
    is_pinned: bool
    message: str
    # Return the visibility state after the operation
    home: Optional[bool] = None
    shared: Optional[bool] = None
    recommended: Optional[bool] = None


class ReorderCollectionsRequest(BaseModel):
    ordered_collections: List[str]


class ReorderResponse(BaseModel):
    success: bool
    message: str


class CollectionOut(BaseModel):
    title: str
    library: str
    poster_url: Optional[str] = None
    item_count: int = 0
    is_active: bool = False
    smart: bool = False


class AllCollectionsResponse(BaseModel):
    collections: List[CollectionOut]


class DashboardStat(BaseModel):
    label: str
    value: str
    hint: Optional[str] = None


class DashboardActivityItem(BaseModel):
    created_at: datetime
    success: bool
    summary: str
    error_message: Optional[str] = None


class DashboardUsageItem(BaseModel):
    collection_name: str
    times_used: int
    last_rotated_at: Optional[datetime] = None


class DashboardResponse(BaseModel):
    health: HealthResponse
    stats: list[DashboardStat]
    recent_activity: list[DashboardActivityItem]
    usage_top: list[DashboardUsageItem]


# Collection Management Models
class CollectionItemOut(BaseModel):
    rating_key: str
    title: str
    year: Optional[int] = None
    thumb: Optional[str] = None
    type: str  # "movie" or "show"


class CollectionDetailResponse(BaseModel):
    title: str
    library: str
    summary: Optional[str] = None
    poster_url: Optional[str] = None
    sort_title: Optional[str] = None
    content_rating: Optional[str] = None
    labels: List[str] = []
    collection_mode: Optional[str] = None
    collection_order: Optional[str] = None
    smart: bool = False
    item_count: int
    items: List[CollectionItemOut]


class LibraryItemOut(BaseModel):
    rating_key: str
    title: str
    year: Optional[int] = None
    thumb: Optional[str] = None
    type: str
    in_collection: bool = False


class LibrarySearchResponse(BaseModel):
    items: List[LibraryItemOut]
    total: int


class AddItemRequest(BaseModel):
    rating_key: str


class RemoveItemRequest(BaseModel):
    rating_key: str


class CreateCollectionRequest(BaseModel):
    title: str
    library: str
    summary: Optional[str] = None


class UpdateCollectionRequest(BaseModel):
    title: Optional[str] = None
    summary: Optional[str] = None
    sort_title: Optional[str] = None
    content_rating: Optional[str] = None
    labels: Optional[List[str]] = None
    collection_mode: Optional[str] = None  # "default", "hide", "hideItems", "showItems"
    collection_order: Optional[str] = None  # "release", "alpha", "custom"


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/collections")

# Cache version counter - increment this to invalidate client-side caches
_cache_version = 0


class CacheVersionResponse(BaseModel):
    version: int


def invalidate_collections_cache():
    """
    Invalidate client-side collections cache by incrementing the version.
    This is a module-level function that can be called from other parts of the app.
    """
    global _cache_version
    _cache_version += 1
    logger.info(f"Collections cache invalidated. New version: {_cache_version}")
    return _cache_version


@router.get("/cache-version", response_model=CacheVersionResponse)
def get_cache_version(_current_user: CurrentUser = Depends(require_admin)) -> CacheVersionResponse:
    """Get the current cache version to check if client-side cache should be invalidated."""
    return CacheVersionResponse(version=_cache_version)


@router.post("/invalidate-cache")
def invalidate_cache_endpoint(_current_user: CurrentUser = Depends(require_admin)) -> dict:
    """API endpoint to invalidate client-side collections cache."""
    new_version = invalidate_collections_cache()
    return {"success": True, "version": new_version}


# Return the collections currently featured on the Plex home screen
@router.get("/active", response_model=ActiveCollectionsResponse)
def get_active_collections(
    _current_user: CurrentUser = Depends(require_admin),
) -> ActiveCollectionsResponse:
    init_db()
    config = load_config()
    server = get_plex_server(config)

    # Get pinning info from database (with display order)
    pinned_collections = get_pinned_collections()
    pinned_order_map = {p.collection_name: p.display_order for p in pinned_collections}
    pinned_names = set(pinned_order_map.keys())

    # Get actual order from Plex's managed hubs (returns in homescreen order)
    plex_order_map: dict[str, int] = {}
    order_counter = 0
    for section in server.library.sections():
        try:
            for hub in section.managedHubs():
                if hasattr(hub, "title"):
                    # Assign order based on position in managedHubs() results
                    plex_order_map[hub.title] = order_counter
                    order_counter += 1
        except Exception as e:
            logger.warning(f"Could not get managed hubs for section {section.title}: {e}")

    out: List[ActiveCollectionOut] = []

    for section in server.library.sections():
        try:
            for col in section.collections():
                try:
                    hub = col.visibility()
                    promoted_own = getattr(hub, "promotedToOwnHome", False)
                    promoted_shared = getattr(hub, "promotedToSharedHome", False)
                    promoted_recommended = getattr(hub, "promotedToRecommended", False)

                    if promoted_own or promoted_shared or promoted_recommended:
                        poster_url = build_collection_poster_url(server, col)
                        is_pinned = col.title in pinned_names
                        # Use Plex's actual order, fallback to 9999 for unknown
                        display_order = plex_order_map.get(col.title, 9999)

                        out.append(
                            ActiveCollectionOut(
                                title=col.title,
                                poster_url=poster_url,
                                library=section.title,
                                promoted_to_own_home=promoted_own,
                                promoted_to_shared=promoted_shared,
                                promoted_to_recommended=promoted_recommended,
                                is_pinned=is_pinned,
                                display_order=display_order,
                            )
                        )
                except Exception as e:
                    logger.warning(
                        f"Could not get visibility for collection {col.title}: {e}"
                    )
        except Exception as e:
            logger.error(
                f"Error retrieving collections from section {section.title}: {e}"
            )

    # Sort: group by library, pinned first (by pin order), then non-pinned (by Plex order)
    out.sort(key=lambda c: (
        c.library or "",
        0 if c.is_pinned else 1,
        pinned_order_map.get(c.title, 0) if c.is_pinned else c.display_order,
        c.title
    ))

    return ActiveCollectionsResponse(collections=out)


# Return all collections from the Plex library with their metadata, including active status.
@router.get("/all", response_model=AllCollectionsResponse)
def get_all_collections(
    _current_user: CurrentUser = Depends(require_admin),
) -> AllCollectionsResponse:
    init_db()

    # Get currently active collection names
    active_names = set()
    rows = list_rotations(limit=1)
    if rows:
        latest = rows[0]
        active_names = set(latest.featured_collections or [])

    config = load_config()
    server = get_plex_server(config)

    collections: List[CollectionOut] = []

    # Iterate through all library sections
    for section in server.library.sections():
        try:
            for col in section.collections():
                poster_url = build_collection_poster_url(server, col)

                # Use metadata attribute for O(1) count instead of fetching all items
                item_count = getattr(col, "childCount", 0)
                # Some older PMS versions might use leafCount
                if not item_count:
                    item_count = getattr(col, "leafCount", 0)

                collections.append(
                    CollectionOut(
                        title=col.title,
                        library=section.title,
                        poster_url=poster_url,
                        item_count=item_count,
                        is_active=(col.title in active_names),
                        smart=bool(getattr(col, "smart", False)),
                    )
                )
        except Exception as e:
            logger.error(f"Error retrieving collections from section {section.title}: {e}")
            continue

    # Sort by library, then by title
    collections.sort(key=lambda c: (c.library, c.title))

    return AllCollectionsResponse(collections=collections)


class GroupPostersResponse(BaseModel):
    posters: List[str]


@router.get("/group-posters", response_model=GroupPostersResponse)
async def get_group_posters(
    collection_names: str,
    _current_user: CurrentUser = Depends(require_admin),
) -> GroupPostersResponse:
    try:
        config = load_config()
        server = get_plex_server(config)

        # Parse collection names from query parameter
        collections_to_fetch = [name.strip() for name in collection_names.split(',') if name.strip()]

        if not collections_to_fetch:
            return GroupPostersResponse(posters=[])

        # Collect all items from the specified collections
        all_items = []
        for section in server.library.sections():
            try:
                for col in section.collections():
                    if col.title in collections_to_fetch:
                        try:
                            items = col.items()
                            all_items.extend(items)
                        except Exception as e:
                            logger.warning(f"Could not get items for collection {col.title}: {e}")
                            continue
            except Exception as e:
                logger.error(f"Error retrieving collections from section {section.title}: {e}")
                continue

        if not all_items:
            return GroupPostersResponse(posters=[])

        # Randomly sample up to 6 items (1 row)
        sample_size = min(6, len(all_items))
        sampled_items = random.sample(all_items, sample_size)

        # Extract poster URLs and create proxied versions
        posters = []
        for item in sampled_items:
            if hasattr(item, 'thumb') and item.thumb:
                plex_url = server.url(item.thumb, includeToken=True)
                posters.append(create_proxy_url(plex_url))

        logger.info(f"Fetched {len(posters)} poster URLs for group collections: {collections_to_fetch}")
        return GroupPostersResponse(posters=posters)

    except Exception as exc:
        logger.exception("Failed to fetch posters for group collections")
        return GroupPostersResponse(posters=[])


@router.get("/poster-proxy/{cache_key}")
def proxy_poster(cache_key: str):
    return serve_proxy_poster(cache_key)


@router.get("/group-poster-proxy/{cache_key}", include_in_schema=False)
def proxy_group_poster(cache_key: str):
    # Backward-compatible alias for clients with cached legacy group poster URLs.
    return proxy_poster(cache_key)


class LibraryOut(BaseModel):
    title: str
    type: str  # "movie" or "show"
    enabled: bool = False  # switched on in Settings


class LibrariesResponse(BaseModel):
    libraries: List[LibraryOut]


# ============================================================================
# Collection Management Endpoints
# ============================================================================

@router.get("/libraries", response_model=LibrariesResponse)
def get_available_libraries(
    _current_user: CurrentUser = Depends(require_admin),
) -> LibrariesResponse:
    """Get all available Plex library sections, enabled ones first."""
    config = load_config()
    server = get_plex_server(config)
    enabled_names = {lib.name for lib in config.plex.libraries if lib.enabled}

    try:
        libraries = []
        for section in server.library.sections():
            # Exclude music libraries (artist type)
            if section.type == "artist":
                logger.debug(f"Skipping music library: {section.title}")
                continue

            libraries.append(
                LibraryOut(
                    title=section.title,
                    type=section.type,
                    enabled=section.title in enabled_names,
                )
            )
            logger.debug(f"Added library: {section.title} (type: {section.type})")

        # Enabled libraries first, then by title
        libraries.sort(key=lambda lib: (not lib.enabled, lib.title))

        return LibrariesResponse(libraries=libraries)

    except Exception as e:
        logger.error(f"Error getting libraries: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to get libraries: {str(e)}"
        )

@router.get(
    "/{library}/{collection_title}/details", response_model=CollectionDetailResponse
)
def get_collection_details(
    library: str,
    collection_title: str,
    _current_user: CurrentUser = Depends(require_admin),
) -> CollectionDetailResponse:
    """Get detailed information about a specific collection, including all items."""
    config = load_config()
    server = get_plex_server(config)

    try:
        # Get the library section
        section = server.library.section(library)

        # Find the collection
        collection = None
        for col in section.collections():
            if col.title == collection_title:
                collection = col
                break

        if not collection:
            raise HTTPException(
                status_code=404,
                detail=f"Collection '{collection_title}' not found in library '{library}'",
            )

        # Get all items in the collection
        items = collection.items()

        # Build response
        collection_items = []
        for item in items:
            thumb_url = None
            if hasattr(item, "thumb") and item.thumb:
                thumb_url = create_proxy_url(server.url(item.thumb, includeToken=True))

            collection_items.append(
                CollectionItemOut(
                    rating_key=str(item.ratingKey),
                    title=item.title,
                    year=getattr(item, "year", None),
                    thumb=thumb_url,
                    type=item.type,  # "movie" or "show"
                )
            )

        summary = getattr(collection, "summary", None)

        # Get poster URL
        poster_url = None
        if hasattr(collection, "thumb") and collection.thumb:
            try:
                full_thumb_url = server.url(collection.thumb, includeToken=True)
                plex_url = server.transcodeImage(full_thumb_url, height=600, width=400, minSize=1)
            except Exception:
                plex_url = server.url(collection.thumb, includeToken=True)
            poster_url = create_proxy_url(plex_url)

        # Get additional metadata
        sort_title = getattr(collection, "titleSort", None)
        content_rating = getattr(collection, "contentRating", None)

        # Get labels
        labels = []
        if hasattr(collection, "labels"):
            labels = [label.tag for label in collection.labels]

        # Map collection mode from integer to string
        collection_mode = None
        mode_value = getattr(collection, "collectionMode", None)
        if mode_value is not None:
            mode_map = {-1: "default", 0: "hide", 1: "hideItems", 2: "showItems"}
            collection_mode = mode_map.get(mode_value)

        # Map collection order from integer to string
        collection_order = None
        order_value = getattr(collection, "collectionSort", None)
        if order_value is not None:
            order_map = {0: "release", 1: "alpha", 2: "custom"}
            collection_order = order_map.get(order_value)

        return CollectionDetailResponse(
            title=collection.title,
            library=library,
            summary=summary,
            poster_url=poster_url,
            sort_title=sort_title,
            content_rating=content_rating,
            labels=labels,
            collection_mode=collection_mode,
            collection_order=collection_order,
            smart=bool(getattr(collection, "smart", False)),
            item_count=len(collection_items),
            items=collection_items,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting collection details: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to get collection details: {str(e)}"
        )
    
# Search for items in a library, optionally filtering by collection membership
@router.get("/{library}/search", response_model=LibrarySearchResponse)
def search_library_items(
    library: str,
    query: Optional[str] = None,
    collection_title: Optional[str] = None,
    limit: int = 50,
    _current_user: CurrentUser = Depends(require_admin),
) -> LibrarySearchResponse:
    config = load_config()
    server = get_plex_server(config)

    try:
        # Get the library section
        logger.info(f"Searching library: {library}, query: {query}")
        section = server.library.section(library)
        logger.info(f"Found section: {section.title} (type: {section.type})")

        # Get items in the collection (if specified) to mark them
        collection_item_keys = set()
        if collection_title:
            for col in section.collections():
                if col.title == collection_title:
                    collection_item_keys = {str(item.ratingKey) for item in col.items()}
                    break

        # Search or get all items
        if query:
            items = section.search(title=query, limit=limit)
        else:
            items = section.all(limit=limit)

        logger.info(f"Found {len(items)} items in library {library}")

        # Build response
        library_items = []
        for idx, item in enumerate(items):
            thumb_url = None
            if hasattr(item, "thumb") and item.thumb:
                thumb_url = create_proxy_url(server.url(item.thumb, includeToken=True))

            # Log first few items to help debug
            if idx < 3:
                logger.info(f"Item {idx}: {item.title} (type: {item.type})")

            library_items.append(
                LibraryItemOut(
                    rating_key=str(item.ratingKey),
                    title=item.title,
                    year=getattr(item, "year", None),
                    thumb=thumb_url,
                    type=item.type,
                    in_collection=(str(item.ratingKey) in collection_item_keys),
                )
            )

        return LibrarySearchResponse(items=library_items, total=len(library_items))

    except Exception as e:
        logger.error(f"Error searching library: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to search library: {str(e)}"
        )
    

# Add an item to a collection
@router.post("/{library}/{collection_title}/add-item")
def add_item_to_collection(
    library: str,
    collection_title: str,
    request: AddItemRequest,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    config = load_config()
    server = get_plex_server(config)

    try:
        # Get the library section
        section = server.library.section(library)

        # Find the item by rating key
        item = section.fetchItem(int(request.rating_key))

        if not item:
            raise HTTPException(
                status_code=404,
                detail=f"Item with rating key '{request.rating_key}' not found",
            )

        # Add the item to the collection (creates collection if it doesn't exist)
        item.addCollection(collection_title)

        logger.info(f"Added '{item.title}' to collection '{collection_title}'")

        return {
            "success": True,
            "message": f"Added '{item.title}' to collection '{collection_title}'",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding item to collection: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to add item to collection: {str(e)}"
        )
    
# Remove an item from a collection
@router.post("/{library}/{collection_title}/remove-item")
def remove_item_from_collection(
    library: str,
    collection_title: str,
    request: RemoveItemRequest,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    config = load_config()
    server = get_plex_server(config)

    try:
        # Get the library section
        section = server.library.section(library)

        # Find the item by rating key
        item = section.fetchItem(int(request.rating_key))

        if not item:
            raise HTTPException(
                status_code=404,
                detail=f"Item with rating key '{request.rating_key}' not found",
            )

        # Remove the item from the collection
        item.removeCollection(collection_title)

        logger.info(f"Removed '{item.title}' from collection '{collection_title}'")

        return {
            "success": True,
            "message": f"Removed '{item.title}' from collection '{collection_title}'",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error removing item from collection: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to remove item from collection: {str(e)}"
        )


# Create a new collection
@router.post("/create")
def create_collection(
    request: CreateCollectionRequest,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    config = load_config()
    server = get_plex_server(config)

    try:
        # Get the library section
        section = server.library.section(request.library)

        # Check if collection already exists
        for col in section.collections():
            if col.title == request.title:
                raise HTTPException(
                    status_code=409,
                    detail=f"Collection '{request.title}' already exists in library '{request.library}'",
                )

        # Create the collection by adding it to the first item in the library
        # Note: Plex collections require at least one item, so we keep the first item in the collection
        # Users can remove it later if they want an empty collection
        items = section.all(limit=1)
        if not items:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot create collection: library '{request.library}' is empty",
            )

        # Add collection to first item (this creates the collection)
        items[0].addCollection(request.title)

        # Find the newly created collection
        new_collection = None
        for col in section.collections():
            if col.title == request.title:
                new_collection = col
                break

        if not new_collection:
            raise HTTPException(
                status_code=500,
                detail="Failed to create collection"
            )

        # Set summary if provided
        if request.summary:
            new_collection.editSummary(request.summary)

        logger.info(
            f"Created collection '{request.title}' in library '{request.library}'"
        )

        return {"success": True, "message": f"Created collection '{request.title}'"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating collection: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to create collection: {str(e)}"
        )


# Update collection metadata
@router.put("/{library}/{collection_title}")
def update_collection(
    library: str,
    collection_title: str,
    request: UpdateCollectionRequest,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    config = load_config()
    server = get_plex_server(config)

    try:
        # Get the library section
        section = server.library.section(library)

        # Find the collection
        collection = None
        for col in section.collections():
            if col.title == collection_title:
                collection = col
                break

        if not collection:
            raise HTTPException(
                status_code=404,
                detail=f"Collection '{collection_title}' not found in library '{library}'",
            )

        # Apply edits using the new non-deprecated methods
        updated = False

        if request.title is not None:
            collection.editTitle(request.title)
            updated = True

        if request.summary is not None:
            collection.editSummary(request.summary)
            updated = True

        if request.sort_title is not None:
            collection.editSortTitle(request.sort_title)
            updated = True

        if request.content_rating is not None:
            collection.editContentRating(request.content_rating)
            updated = True

        # Handle labels - replace all labels
        if request.labels is not None:
            # Get current labels
            current_labels = [label.tag for label in collection.labels] if hasattr(collection, "labels") else []

            # Remove labels that aren't in the new list
            for label in current_labels:
                if label not in request.labels:
                    collection.removeLabel(label)

            # Add labels that aren't already present
            for label in request.labels:
                if label not in current_labels:
                    collection.addLabel(label)

            updated = True

        # Handle collection mode
        if request.collection_mode is not None:
            collection.modeUpdate(mode=request.collection_mode)
            updated = True

        # Handle collection order
        if request.collection_order is not None:
            collection.sortUpdate(sort=request.collection_order)
            updated = True

        if not updated:
            raise HTTPException(status_code=400, detail="No fields to update")

        logger.info(f"Updated collection '{collection_title}' in library '{library}'")

        return {"success": True, "message": f"Updated collection '{collection_title}'"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating collection: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to update collection: {str(e)}"
        )


# Delete a collection
@router.delete("/{library}/{collection_title}")
def delete_collection(
    library: str,
    collection_title: str,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    config = load_config()
    server = get_plex_server(config)

    try:
        # Get the library section
        section = server.library.section(library)

        # Find the collection
        collection = None
        for col in section.collections():
            if col.title == collection_title:
                collection = col
                break

        if not collection:
            raise HTTPException(
                status_code=404,
                detail=f"Collection '{collection_title}' not found in library '{library}'",
            )

        # Delete the collection
        collection.delete()

        logger.info(f"Deleted collection '{collection_title}' from library '{library}'")

        return {"success": True, "message": f"Deleted collection '{collection_title}'"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting collection: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to delete collection: {str(e)}"
        )


# Upload a poster to a collection (from file or URL)
@router.post("/{library}/{collection_title}/upload-poster")
async def upload_collection_poster(
    library: str,
    collection_title: str,
    file: Optional[UploadFile] = File(None),
    url: Optional[str] = Form(None),
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    """
    Upload a custom poster to a Plex collection.
    Either provide a file upload OR a URL to a poster image.
    """
    config = load_config()
    server = get_plex_server(config)

    try:
        # Validate that exactly one input method is provided
        if not file and not url:
            raise HTTPException(
                status_code=400,
                detail="Either 'file' or 'url' must be provided",
            )
        if file and url:
            raise HTTPException(
                status_code=400,
                detail="Provide either 'file' or 'url', not both",
            )

        # Get the library section
        section = server.library.section(library)

        # Find the collection
        collection = None
        for col in section.collections():
            if col.title == collection_title:
                collection = col
                break

        if not collection:
            raise HTTPException(
                status_code=404,
                detail=f"Collection '{collection_title}' not found in library '{library}'",
            )

        # Upload poster based on input method
        if url:
            # Upload from URL
            logger.info(f"Uploading poster from URL for collection '{collection_title}': {url}")
            collection.uploadPoster(url=url)
            logger.info(f"Successfully uploaded poster from URL for collection '{collection_title}'")
        else:
            # Upload from file
            logger.info(f"Uploading poster from file for collection '{collection_title}': {file.filename}")

            # Create a temporary file to save the uploaded content
            with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file.filename)[1]) as temp_file:
                # Read and write the uploaded file content
                content = await file.read()
                temp_file.write(content)
                temp_file_path = temp_file.name

            try:
                # Upload the poster using the temporary file
                collection.uploadPoster(filepath=temp_file_path)
                logger.info(f"Successfully uploaded poster from file for collection '{collection_title}'")
            finally:
                # Clean up the temporary file
                try:
                    os.unlink(temp_file_path)
                except Exception as cleanup_error:
                    logger.warning(f"Failed to clean up temporary file: {cleanup_error}")

        # Invalidate caches to show the new poster
        invalidate_collections_cache()
        invalidate_poster_caches()

        return {
            "success": True,
            "message": f"Successfully uploaded poster for collection '{collection_title}'",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading poster: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to upload poster: {str(e)}"
        )


# Upload a poster to an item in a library (from file or URL)
@router.post("/{library}/items/{rating_key}/upload-poster")
async def upload_item_poster(
    library: str,
    rating_key: str,
    file: Optional[UploadFile] = File(None),
    url: Optional[str] = Form(None),
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    """
    Upload a custom poster to a Plex library item (movie or show).
    Either provide a file upload OR a URL to a poster image.
    """
    config = load_config()
    server = get_plex_server(config)

    try:
        # Validate that exactly one input method is provided
        if not file and not url:
            raise HTTPException(
                status_code=400,
                detail="Either 'file' or 'url' must be provided",
            )
        if file and url:
            raise HTTPException(
                status_code=400,
                detail="Provide either 'file' or 'url', not both",
            )

        # Get the library section
        section = server.library.section(library)

        # Find the item by rating key
        item = section.fetchItem(int(rating_key))

        if not item:
            raise HTTPException(
                status_code=404,
                detail=f"Item with rating key '{rating_key}' not found in library '{library}'",
            )

        # Upload poster based on input method
        if url:
            # Upload from URL
            logger.info(f"Uploading poster from URL for item '{item.title}' ({rating_key}): {url}")
            item.uploadPoster(url=url)
            logger.info(f"Successfully uploaded poster from URL for item '{item.title}'")
        else:
            # Upload from file
            logger.info(f"Uploading poster from file for item '{item.title}' ({rating_key}): {file.filename}")

            # Create a temporary file to save the uploaded content
            with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file.filename)[1]) as temp_file:
                # Read and write the uploaded file content
                content = await file.read()
                temp_file.write(content)
                temp_file_path = temp_file.name

            try:
                # Upload the poster using the temporary file
                item.uploadPoster(filepath=temp_file_path)
                logger.info(f"Successfully uploaded poster from file for item '{item.title}'")
            finally:
                # Clean up the temporary file
                try:
                    os.unlink(temp_file_path)
                except Exception as cleanup_error:
                    logger.warning(f"Failed to clean up temporary file: {cleanup_error}")

        # Invalidate caches to show the new poster
        invalidate_poster_caches()

        return {
            "success": True,
            "message": f"Successfully uploaded poster for '{item.title}'",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading item poster: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to upload poster: {str(e)}"
        )
    

@router.get("/pinned", response_model=PinnedCollectionsResponse)
def get_pinned_collections_endpoint(
    _current_user: CurrentUser = Depends(require_admin),
) -> PinnedCollectionsResponse:
    init_db()
    pinned = get_pinned_collections()
    return PinnedCollectionsResponse(
        pinned=[
            PinnedCollectionOut(
                collection_name=p.collection_name,
                library_name=p.library_name,
                display_order=p.display_order,
                pinned_at=p.pinned_at,
            )
            for p in pinned
        ]
    )


@router.post("/toggle-pin", response_model=TogglePinResponse)
def toggle_pin_collection_endpoint(
    request: TogglePinRequest,
    _current_user: CurrentUser = Depends(require_admin),
) -> TogglePinResponse:
    init_db()
    currently_pinned = is_collection_pinned(request.collection_name)

    # Determine if this is an unpin request (all visibility options are None AND already pinned)
    visibility_provided = request.home is not None or request.shared is not None or request.recommended is not None
    should_unpin = currently_pinned and not visibility_provided

    if should_unpin:
        unpin_collection(request.collection_name)

        # Also remove the collection from the Plex homescreen
        try:
            config = load_config()
            server = get_plex_server(config)
            library_collections = get_library_collections(server, request.library)
            collection = library_collections.get(request.collection_name)

            if collection:
                hub = collection.visibility()
                if getattr(hub, "_promoted", False):
                    remove_or_hide_hub(hub, request.collection_name)
                logger.info(f"Removed unpinned collection '{request.collection_name}' from Plex homescreen")
        except Exception as e:
            logger.error(f"Failed to remove collection from Plex homescreen: {e}")

        return TogglePinResponse(
            success=True,
            is_pinned=False,
            message=f"Unpinned collection '{request.collection_name}'",
            home=False,
            shared=False,
            recommended=False,
        )
    else:
        # Pin or update visibility - use provided values or defaults
        home = request.home if request.home is not None else True
        shared = request.shared if request.shared is not None else False
        recommended = request.recommended if request.recommended is not None else False

        # Store pin with visibility settings (creates or updates)
        pin_collection(
            request.collection_name,
            request.library,
            visibility_home=home,
            visibility_shared=shared,
            visibility_recommended=recommended,
        )

        # Also add the collection to the Plex homescreen with specified visibility
        try:
            config = load_config()
            server = get_plex_server(config)
            library_collections = get_library_collections(server, request.library)
            collection = library_collections.get(request.collection_name)

            if collection:
                hub = collection.visibility()
                hub.updateVisibility(home=home, shared=shared, recommended=recommended)
                action = "Updated" if currently_pinned else "Added"
                logger.info(f"{action} pinned collection '{request.collection_name}' on Plex homescreen (home={home}, shared={shared}, recommended={recommended})")
        except Exception as e:
            logger.error(f"Failed to update collection on Plex homescreen: {e}")

        action = "Updated" if currently_pinned else "Pinned"
        return TogglePinResponse(
            success=True,
            is_pinned=True,
            message=f"{action} collection '{request.collection_name}'",
            home=home,
            shared=shared,
            recommended=recommended,
        )


@router.post("/reorder", response_model=ReorderResponse)
def reorder_collections_endpoint(
    request: ReorderCollectionsRequest,
    _current_user: CurrentUser = Depends(require_admin),
) -> ReorderResponse:
    init_db()
    try:
        update_display_order(request.ordered_collections)
        config = load_config()
        server = get_plex_server(config)
        reorder_homescreen_collections(server, config, request.ordered_collections)
        return ReorderResponse(
            success=True,
            message=f"Reordered {len(request.ordered_collections)} collections",
        )
    except Exception as e:
        logger.error(f"Error reordering collections: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to reorder: {str(e)}")


class RecentlyAddedItem(BaseModel):
    title: str
    year: Optional[int] = None
    added_at: Optional[str] = None
    thumb: Optional[str] = None
    media_type: str = "unknown"
    rating_key: str
    library: str


class RecentlyAddedResponse(BaseModel):
    items: List[RecentlyAddedItem]


@router.get("/recently-added", response_model=RecentlyAddedResponse)
def get_recently_added_endpoint(
    limit: int = Query(10, ge=1, le=25),
    _current_user: CurrentUser = Depends(require_admin),
) -> RecentlyAddedResponse:
    from homescreen_hero.core.integrations.plex_client import get_recently_added

    try:
        config = load_config()
        server = get_plex_server(config)
        items = get_recently_added(server, config, limit=limit)
        return RecentlyAddedResponse(items=[RecentlyAddedItem(**item) for item in items])
    except Exception as e:
        logger.error(f"Error fetching recently added: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch recently added")


class HiddenHubOut(BaseModel):
    library: str
    title: str


class CleanupHiddenHubsResponse(BaseModel):
    dry_run: bool
    removed: List[HiddenHubOut]


@router.post("/cleanup-hidden-hubs", response_model=CleanupHiddenHubsResponse)
def cleanup_hidden_hubs_endpoint(
    dry_run: bool = True,
    _current_user: CurrentUser = Depends(require_admin),
) -> CleanupHiddenHubsResponse:
    # Remove collection rows from Plex's Manage Recommendations that are hidden
    # everywhere. Call with dry_run=true first to preview.
    try:
        config = load_config()
        server = get_plex_server(config)
        removed = cleanup_hidden_managed_hubs(server, config, dry_run=dry_run)
    except Exception as e:
        logger.error("Hidden hub cleanup failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Plex request failed: {e}")
    return CleanupHiddenHubsResponse(
        dry_run=dry_run,
        removed=[HiddenHubOut(**r) for r in removed],
    )


# ---------------------------------------------------------------- smart collections

class SmartRuleIn(BaseModel):
    field: str
    operator: str
    value: str


class SmartQueryIn(BaseModel):
    libtype: Optional[str] = None
    match: Literal["all", "any"] = "all"
    rules: List[SmartRuleIn] = []
    sort: Optional[str] = None
    limit: Optional[int] = None
    # Rule groups: {"match": "all"|"any", "conditions": [rule | group]}. Overrides match/rules.
    tree: Optional[dict] = None


class CreateSmartCollectionRequest(SmartQueryIn):
    title: str


def _smart_query(section, payload: SmartQueryIn):
    from homescreen_hero.core.smart_collections import SmartQuery, SmartRule, default_libtype

    return SmartQuery(
        libtype=payload.libtype or default_libtype(section),
        match=payload.match,
        rules=[SmartRule(field=r.field, operator=r.operator, value=r.value) for r in payload.rules],
        sort=payload.sort or None,
        limit=payload.limit or None,
        tree=payload.tree,
    )


def _enabled_section(library: str):
    # Smart collections can only be built in libraries enabled in Settings.
    config = load_config()
    if library not in {lib.name for lib in config.plex.libraries if lib.enabled}:
        raise HTTPException(status_code=400, detail=f"Library '{library}' isn't enabled")
    server = get_plex_server(config)
    try:
        return server, server.library.section(library)
    except Exception:
        raise HTTPException(status_code=404, detail=f"Library '{library}' not found in Plex")


@router.get("/{library}/smart-filters")
def get_smart_filter_schema(
    library: str,
    libtype: Optional[str] = None,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    # Fields, operators and sorts for building a smart collection in this library.
    from homescreen_hero.core.smart_collections import filter_schema

    _, section = _enabled_section(library)
    try:
        return filter_schema(section, libtype)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Plex request failed: {e}")


@router.get("/{library}/smart-filters/choices")
def get_smart_filter_choices(
    library: str,
    field: str,
    libtype: Optional[str] = None,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    # Values for a tag-like field, e.g. every genre or actor in the library.
    from homescreen_hero.core.smart_collections import filter_choices

    _, section = _enabled_section(library)
    try:
        return {"choices": filter_choices(section, field, libtype)}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Plex request failed: {e}")


@router.post("/{library}/smart-preview")
def preview_smart_collection(
    library: str,
    payload: SmartQueryIn,
    start: int = 0,
    size: int = 30,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    from homescreen_hero.core.smart_collections import preview

    server, section = _enabled_section(library)
    try:
        result = preview(server, section, _smart_query(section, payload), start=max(0, start), size=max(1, min(size, 200)))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Plex request failed: {e}")
    for item in result["items"]:
        thumb = item.pop("thumb", None)
        item["poster_url"] = create_proxy_url(server.url(thumb, includeToken=True)) if thumb else None
    return result


@router.post("/{library}/smart")
def create_smart_collection_endpoint(
    library: str,
    payload: CreateSmartCollectionRequest,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    from homescreen_hero.core.smart_collections import create_smart_collection

    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Give the collection a name")
    server, section = _enabled_section(library)
    if any(col.title == title for col in section.collections()):
        raise HTTPException(
            status_code=409,
            detail=f"Collection '{title}' already exists in library '{library}'",
        )
    try:
        create_smart_collection(server, section, title, _smart_query(section, payload))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Plex request failed: {e}")
    invalidate_collections_cache()
    return {"success": True, "title": title, "library": library}


# ---------------------------------------------------------------- per-library collections page

@router.get("/library/{library}/overview")
def get_library_collections_overview(
    library: str,
    refresh: bool = False,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    # Every collection in one enabled library, with what the Collections page
    # sorts and filters on. Cached briefly; refresh=true rebuilds it.
    from homescreen_hero.core.collections_overview import get_overview

    server, _ = _enabled_section(library)
    try:
        return get_overview(server, load_config(), library, _cache_version, refresh=refresh)
    except Exception as e:
        logger.error("Collections overview failed for '%s': %s", library, e)
        raise HTTPException(status_code=502, detail=f"Plex request failed: {e}")


@router.get("/library/{library}/collection/{rating_key}/items")
def get_collection_row_items(
    library: str,
    rating_key: str,
    limit: int = 20,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    # First items of a collection, in its own sort order, for its row preview.
    from homescreen_hero.core.collections_overview import collection_items

    server, _ = _enabled_section(library)
    try:
        return collection_items(server, rating_key, limit=max(1, min(limit, 50)))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Plex request failed: {e}")


@router.get("/library/{library}/containing/{item_rating_key}")
def get_collections_containing_item(
    library: str,
    item_rating_key: str,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    # Titles of the collections a movie or show belongs to.
    from homescreen_hero.core.collections_overview import collections_containing

    server, _ = _enabled_section(library)
    try:
        return {"collections": collections_containing(server, item_rating_key)}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Plex request failed: {e}")


@router.get("/library/{library}/collection/{rating_key}/smart-summary")
def get_smart_collection_summary(
    library: str,
    rating_key: str,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    # A smart collection's rules in plain words, for hover details.
    from homescreen_hero.core.smart_collections import describe_smart_collection

    server, section = _enabled_section(library)
    try:
        collection = server.fetchItem(int(rating_key))
        content = getattr(collection, "content", None)
        if not getattr(collection, "smart", False) or not content:
            raise HTTPException(status_code=400, detail="Not a smart collection")
        return describe_smart_collection(section, content)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Plex request failed: {e}")


# ---------------------------------------------------------------- edit collection panel

class CollectionDetailsIn(BaseModel):
    title: str
    sort_title: str = ""
    summary: str = ""
    labels: List[str] = []


class CollectionAdvancedIn(BaseModel):
    collection_mode: Optional[str] = None
    collection_sort: Optional[str] = None
    filter_user: Optional[str] = None


def _editable_collection(library: str, rating_key: str):
    from homescreen_hero.core.collection_editing import get_collection

    server, section = _enabled_section(library)
    try:
        return server, section, get_collection(server, section, rating_key)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception:
        raise HTTPException(status_code=404, detail="Collection not found in Plex")


def _after_edit(library: str) -> None:
    # The Collections page and rotation both read collection names and posters
    invalidate_collections_cache()
    invalidate_poster_caches()


@router.get("/library/{library}/collection/{rating_key}/edit")
def get_collection_for_editing(
    library: str,
    rating_key: str,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    from homescreen_hero.core.collection_editing import edit_details

    server, _, collection = _editable_collection(library, rating_key)
    try:
        return edit_details(server, collection)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Plex request failed: {e}")


@router.put("/library/{library}/collection/{rating_key}/details")
def save_collection_details(
    library: str,
    rating_key: str,
    payload: CollectionDetailsIn,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    from homescreen_hero.core.collection_editing import save_details

    _, section, collection = _editable_collection(library, rating_key)
    new_title = payload.title.strip()
    if new_title != collection.title and any(c.title == new_title for c in section.collections()):
        raise HTTPException(status_code=409, detail=f"A collection called '{new_title}' already exists in {library}")
    try:
        result = save_details(collection, library, payload.title, payload.sort_title, payload.summary, payload.labels)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Plex request failed: {e}")
    _after_edit(library)
    return {"success": True, **result}


@router.put("/library/{library}/collection/{rating_key}/advanced")
def save_collection_advanced(
    library: str,
    rating_key: str,
    payload: CollectionAdvancedIn,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    from homescreen_hero.core.collection_editing import save_advanced

    _, _, collection = _editable_collection(library, rating_key)
    try:
        save_advanced(collection, payload.collection_mode, payload.collection_sort, payload.filter_user)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Plex request failed: {e}")
    _after_edit(library)
    return {"success": True}


@router.put("/library/{library}/collection/{rating_key}/smart")
def save_collection_smart_filters(
    library: str,
    rating_key: str,
    payload: SmartQueryIn,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    from homescreen_hero.core.collection_editing import save_smart_filters

    server, section, collection = _editable_collection(library, rating_key)
    try:
        save_smart_filters(server, section, collection, _smart_query(section, payload))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Plex request failed: {e}")
    _after_edit(library)
    return {"success": True}


@router.get("/library/{library}/collection/{rating_key}/artwork/{kind}")
def list_collection_artwork(
    library: str,
    rating_key: str,
    kind: str,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    from homescreen_hero.core.collection_editing import artwork_options

    server, _, collection = _editable_collection(library, rating_key)
    try:
        return {"options": artwork_options(server, collection, kind)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Plex request failed: {e}")


@router.post("/library/{library}/collection/{rating_key}/artwork/{kind}")
async def set_collection_artwork(
    library: str,
    rating_key: str,
    kind: str,
    file: Optional[UploadFile] = File(None),
    url: Optional[str] = Form(None),
    select: Optional[str] = Form(None),
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    # Set poster, background, logo or square art: upload a file, give a link,
    # or pick one of the images Plex already has.
    import os
    import tempfile

    from homescreen_hero.core.collection_editing import select_artwork, upload_artwork

    _, _, collection = _editable_collection(library, rating_key)
    tmp_path = None
    try:
        if select:
            select_artwork(collection, kind, select)
        elif file is not None:
            suffix = os.path.splitext(file.filename or "")[1] or ".jpg"
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp.write(await file.read())
                tmp_path = tmp.name
            upload_artwork(collection, kind, filepath=tmp_path)
        else:
            upload_artwork(collection, kind, url=(url or "").strip() or None)
    except (ValueError, LookupError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Plex request failed: {e}")
    finally:
        if tmp_path:
            os.unlink(tmp_path)
    _after_edit(library)
    return {"success": True}


class AddItemsIn(BaseModel):
    rating_keys: List[str]


class MoveItemIn(BaseModel):
    after: Optional[str] = None  # None = move to the start


@router.get("/library/{library}/collection/{rating_key}/all-items")
def list_all_collection_items(
    library: str,
    rating_key: str,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    # Every item in a collection, in its current order, for the Items tab.
    from homescreen_hero.core.collections_overview import collection_items

    server, _, _ = _editable_collection(library, rating_key)
    try:
        return collection_items(server, rating_key, limit=5000)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Plex request failed: {e}")


@router.post("/library/{library}/collection/{rating_key}/items")
def add_collection_items(
    library: str,
    rating_key: str,
    payload: AddItemsIn,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    from homescreen_hero.core.collection_editing import add_items

    server, _, collection = _editable_collection(library, rating_key)
    try:
        added = add_items(server, collection, payload.rating_keys)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Plex request failed: {e}")
    _after_edit(library)
    return {"success": True, "added": added}


@router.delete("/library/{library}/collection/{rating_key}/items/{item_rating_key}")
def remove_collection_item(
    library: str,
    rating_key: str,
    item_rating_key: str,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    from homescreen_hero.core.collection_editing import remove_item

    _, _, collection = _editable_collection(library, rating_key)
    try:
        remove_item(collection, item_rating_key)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Plex request failed: {e}")
    _after_edit(library)
    return {"success": True}


@router.put("/library/{library}/collection/{rating_key}/items/{item_rating_key}/move")
def move_collection_item(
    library: str,
    rating_key: str,
    item_rating_key: str,
    payload: MoveItemIn,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    from homescreen_hero.core.collection_editing import move_item

    _, _, collection = _editable_collection(library, rating_key)
    try:
        move_item(collection, item_rating_key, payload.after)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Plex request failed: {e}")
    _after_edit(library)
    return {"success": True}


@router.post("/stats/refresh")
def refresh_collection_stats(
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    # Recollect plays and latest-item dates now, in the background.
    import threading

    from homescreen_hero.core.collection_stats import collect_all_stats

    def run():
        collect_all_stats()
        invalidate_collections_cache()

    threading.Thread(target=run, name="collection-stats", daemon=True).start()
    return {"started": True}


@router.get("/library/{library}/collection/{rating_key}/label-suggestions")
def get_label_suggestions(
    library: str,
    rating_key: str,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    # Labels worth adding, from what most of the collection's items share,
    # the groups it's in, and labels already used in this library.
    from collections import Counter

    from homescreen_hero.core.collection_editing import collection_item_traits, shared_traits

    server, section, collection = _editable_collection(library, rating_key)
    try:
        traits = shared_traits(collection_item_traits(server, rating_key))
        used = Counter(
            label.tag
            for c in section.collections()
            for label in (getattr(c, "labels", None) or [])
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Plex request failed: {e}")
    config = load_config()
    groups = sorted(
        g.name for g in config.groups
        if g.library == library and (g.smart is False and collection.title in g.collections)
    )
    return {
        **traits,
        "groups": groups,
        "library": [name for name, _ in used.most_common(15)],
    }



# ---------------------------------------------------------------- collection types (this app's own metadata)

class CollectionTypeIn(BaseModel):
    id: Optional[int] = None
    name: str
    color: str = "sky"
    labels: List[str] = []
    prefixes: List[str] = []
    groups: List[str] = []


class CollectionTypesIn(BaseModel):
    types: List[CollectionTypeIn]


class AssignTypeIn(BaseModel):
    type_id: Optional[int] = None  # None = work it out automatically


@router.get("/library/{library}/types")
def get_collection_types(
    library: str,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    from homescreen_hero.core.collection_types import COLORS, list_types

    _enabled_section(library)
    return {"types": list_types(library), "colors": COLORS}


@router.put("/library/{library}/types")
def save_collection_types(
    library: str,
    payload: CollectionTypesIn,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    from homescreen_hero.core.collection_types import save_types

    _enabled_section(library)
    try:
        return {"types": save_types(library, [t.model_dump() for t in payload.types])}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/library/{library}/collection/{rating_key}/type")
def assign_collection_type(
    library: str,
    rating_key: str,
    payload: AssignTypeIn,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    from homescreen_hero.core.collection_types import assign_type

    _enabled_section(library)
    try:
        assign_type(library, rating_key, payload.type_id)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"success": True}


# ---------------------------------------------------------------- manual collections built from searches and filters

class CreateManualCollectionIn(BaseModel):
    title: str
    rating_keys: List[str]


@router.post("/{library}/smart-preview/keys")
def smart_preview_keys(
    library: str,
    payload: SmartQueryIn,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    # IDs of every item matching these rules, for "Select all matching".
    from homescreen_hero.core.smart_collections import matching_keys

    server, section = _enabled_section(library)
    try:
        return matching_keys(server, section, _smart_query(section, payload))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Plex request failed: {e}")


@router.post("/{library}/manual")
def create_manual_collection_endpoint(
    library: str,
    payload: CreateManualCollectionIn,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    # A manual collection holding the chosen items, created in one go.
    from homescreen_hero.core.collection_editing import create_manual_collection

    server, section = _enabled_section(library)
    try:
        rating_key = create_manual_collection(server, section, payload.title, payload.rating_keys)
    except FileExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Plex request failed: {e}")
    invalidate_collections_cache()
    return {"success": True, "rating_key": rating_key, "title": payload.title.strip(), "added": len(dict.fromkeys(payload.rating_keys))}


# ---------------------------------------------------------------- Collections page settings: sections and saved views

class SectionNameIn(BaseModel):
    prefix: str
    name: str = ""


class SavedViewIn(BaseModel):
    name: str
    params: str = ""


@router.get("/library/{library}/page-settings")
def get_collections_page_settings(
    library: str,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    from homescreen_hero.core.collections_page_settings import saved_views, section_names

    return {"section_names": section_names(library), "saved_views": saved_views(library)}


@router.put("/library/{library}/section-name")
def put_section_name(
    library: str,
    payload: SectionNameIn,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    from homescreen_hero.core.collections_page_settings import set_section_name

    try:
        return {"section_names": set_section_name(library, payload.prefix, payload.name)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/library/{library}/saved-views")
def post_saved_view(
    library: str,
    payload: SavedViewIn,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    from homescreen_hero.core.collections_page_settings import save_view

    try:
        return {"saved_views": save_view(library, payload.name, payload.params)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/library/{library}/saved-views/{view_id}")
def delete_saved_view(
    library: str,
    view_id: int,
    _current_user: CurrentUser = Depends(require_admin),
) -> dict:
    from homescreen_hero.core.collections_page_settings import delete_view

    return {"saved_views": delete_view(library, view_id)}
