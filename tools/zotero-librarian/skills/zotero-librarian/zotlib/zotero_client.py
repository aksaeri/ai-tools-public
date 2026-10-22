import os
import tempfile
from urllib.parse import urlparse, unquote

import requests

from . import config as config_mod

PUSH_STRIP = {"_source"}
_ATTACH_UA = {"User-Agent": "zotero-librarian/0.1"}


def get_client(cfg=None):
    """Construct a pyzotero client from config. Imported lazily so unit tests
    that pass a stub never require pyzotero."""
    from pyzotero import zotero
    cfg = cfg or config_mod.load()
    return zotero.Zotero(cfg["library_id"], cfg.get("library_type", "user"), cfg["api_key"])


def coerce(zot, payload):
    """Map `payload` onto the Zotero item template for its itemType.

    Returns (item_dict, missing_required). Drops keys not in the template and
    any provenance keys. Raises RuntimeError for an unknown itemType.
    """
    item_type = payload.get("itemType")
    if not item_type:
        raise ValueError("payload missing itemType")
    template = zot.item_template(item_type)   # raises RuntimeError if unknown
    allowed = set(template.keys())
    item = dict(template)
    for k, v in payload.items():
        if k in PUSH_STRIP:
            continue
        if k in allowed:
            item[k] = v
    missing = []
    if not item.get("title"):
        missing.append("title")
    if "creators" in allowed and not item.get("creators"):
        missing.append("creators")
    return item, missing


def find_duplicate(zot, payload):
    """Return the key of an existing item matching by DOI (exact) or title."""
    doi = (payload.get("DOI") or "").strip().lower()
    if doi:
        for it in zot.items(q=doi, qmode="everything", limit=25):
            if it["data"].get("DOI", "").strip().lower() == doi:
                return it["key"]
    title = (payload.get("title") or "").strip().lower()
    if title:
        for it in zot.items(q=title, qmode="titleCreatorYear", limit=25):
            if it["data"].get("title", "").strip().lower() == title:
                return it["key"]
    return None


def create_item(zot, item, collection=None):
    """Create a single item; returns (key, itemType). Raises on Zotero failure."""
    if collection:
        item = dict(item)
        item["collections"] = [collection]
    resp = zot.create_items([item])
    if resp.get("failed"):
        raise RuntimeError(f"Zotero rejected item: {resp['failed']}")
    created = resp["successful"]["0"]
    return created["key"], created["data"].get("itemType")


def attach_pdf(zot, parent_key, url):
    """Download the PDF at `url` and attach it to item `parent_key`.

    Returns an attachment key (or True) on success, or None if the url is not a
    reachable PDF. Best-effort: paywalled/blocked PDFs simply return None.
    """
    try:
        r = requests.get(url, headers=_ATTACH_UA, timeout=60)
    except requests.RequestException:
        return None
    if r.status_code >= 400:
        return None
    ctype = r.headers.get("content-type", "").lower()
    is_pdf = (
        "pdf" in ctype
        or url.lower().split("?")[0].endswith(".pdf")
        or r.content[:5] == b"%PDF-"
    )
    if not is_pdf:
        return None
    name = unquote(os.path.basename(urlparse(url).path)) or "attachment.pdf"
    if not name.lower().endswith(".pdf"):
        name += ".pdf"
    tmpdir = tempfile.mkdtemp(prefix="zl_attach_")
    path = os.path.join(tmpdir, name)
    with open(path, "wb") as fh:
        fh.write(r.content)
    resp = zot.attachment_simple([path], parent_key)
    succ = resp.get("success") or resp.get("successful") or {}
    if not succ and not resp.get("unchanged"):
        return None
    if isinstance(succ, dict) and succ:
        return list(succ.values())[0]
    if isinstance(succ, list) and succ:
        first = succ[0]
        return first.get("key") if isinstance(first, dict) else first
    return True
