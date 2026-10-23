import json
import os
from pathlib import Path


def config_path():
    override = os.environ.get("ZOTERO_LIBRARIAN_CONFIG")
    if override:
        return Path(override)
    return Path.home() / ".claude" / "zotero-config.json"


def load():
    p = config_path()
    if not p.exists():
        raise FileNotFoundError(
            f"No Zotero config at {p}. Run: zotero-librarian setup --api-key ... --library-id ..."
        )
    return json.loads(p.read_text(encoding="utf-8"))


def save(cfg):
    p = config_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    return p


def _parse_library_spec(spec, cfg):
    """Parse a --library spec into (library_type, library_id).

    Accepts: 'user', 'user:<id>', 'group:<id>', or a bare numeric id (= group).
    """
    spec = (spec or "").strip()
    if ":" in spec:
        lib_type, lib_id = spec.split(":", 1)
        lib_type, lib_id = lib_type.strip().lower(), lib_id.strip()
        if lib_type not in ("user", "group"):
            raise ValueError(f"--library type must be 'user' or 'group', got {lib_type!r}")
        if not lib_id:
            raise ValueError(f"--library {lib_type} requires an id, e.g. {lib_type}:12345")
        return lib_type, lib_id
    low = spec.lower()
    if low == "user":
        return "user", str(cfg["library_id"])
    if low == "group":
        raise ValueError("--library group requires an id, e.g. group:12345 (or --group 12345)")
    if spec.isdigit():
        return "group", spec
    raise ValueError(
        f"unrecognized --library {spec!r}; use 'user', 'user:<id>', 'group:<id>', "
        "or a numeric group id"
    )


def apply_library_override(cfg, spec):
    """Return a copy of `cfg` retargeted at another library for one command.

    Does not persist. Clears `default_collection`, since collection keys belong
    to the configured library and are invalid in the overridden one.
    """
    lib_type, lib_id = _parse_library_spec(spec, cfg)
    new = dict(cfg)
    new["library_type"] = lib_type
    new["library_id"] = lib_id
    new["default_collection"] = None
    return new
