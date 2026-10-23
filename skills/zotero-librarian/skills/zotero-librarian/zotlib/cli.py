import argparse
import json
import sys

from . import identifiers, resolvers, zotero_client as zc, config as config_mod


def _load_payload(args):
    if args.json:
        return json.loads(args.json)
    if args.file:
        with open(args.file, encoding="utf-8") as fh:
            return json.load(fh)
    return json.load(sys.stdin)


def cmd_setup(args):
    from pyzotero import zotero
    zot = zotero.Zotero(args.library_id, args.library_type, args.api_key)
    zot.key_info()  # raises if credentials invalid
    config_mod.save({
        "api_key": args.api_key,
        "library_id": args.library_id,
        "library_type": args.library_type,
        "default_collection": args.default_collection,
    })
    print(f"Config saved to {config_mod.config_path()}")
    return 0


def cmd_resolve(args):
    kind, ident = identifiers.detect(args.input)
    if kind is None:
        print(f"No clean identifier in input: {args.input!r} (use the agentic path)",
              file=sys.stderr)
        return 3
    try:
        payload = resolvers.resolve(kind, ident)
    except Exception as e:  # noqa: BLE001 - surface the failure, signal retry
        print(f"Resolution failed for {kind} {ident}: {e}", file=sys.stderr)
        return 4
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


def _effective_cfg(args):
    """Load config, applying a per-command --library/--group override if given.

    Returns the effective cfg dict when an override is requested, else None
    (None keeps the default behaviour: get_client loads config itself)."""
    library = getattr(args, "library", None)
    group = getattr(args, "group", None)
    if not library and not group:
        return None
    cfg = config_mod.load()
    spec = f"group:{group}" if group else library
    return config_mod.apply_library_override(cfg, spec)


def _do_add(payload, *, cfg=None, collection, dedupe, dry_run, query=None,
            attach_pdf=False, pdf_url=None):
    import datetime
    zot = zc.get_client(cfg)
    item, missing = zc.coerce(zot, payload)
    if missing:
        print(f"Warning: missing required field(s): {', '.join(missing)}", file=sys.stderr)
    # Provenance: record the originating user query in Zotero's `extra` field.
    if query and "extra" in item:
        note = f'Automatic record from user query "{query}"'
        item["extra"] = f"{item['extra']}\n{note}".strip() if item.get("extra") else note
    # accessDate=today for web-sourced (agentic) records that support the field.
    if payload.get("_source") == "agent" and "accessDate" in item and not item.get("accessDate"):
        item["accessDate"] = datetime.date.today().isoformat()
    if dry_run:
        print(json.dumps(item, indent=2, ensure_ascii=False))
        return 0
    if dedupe:
        dup = zc.find_duplicate(zot, payload)
        if dup:
            print(f"Skipped (duplicate of {dup})")
            return 0
    if collection is None:
        if cfg is not None:
            collection = cfg.get("default_collection")
        else:
            try:
                collection = config_mod.load().get("default_collection")
            except FileNotFoundError:
                collection = None
    key, item_type = zc.create_item(zot, item, collection=collection)
    print(f"Added {item_type} {key} -> zotero://select/library/items/{key}")
    if attach_pdf:
        target = pdf_url or item.get("url")
        if not target:
            print("  (no url available to attach a PDF from)", file=sys.stderr)
        else:
            akey = zc.attach_pdf(zot, key, target)
            if akey:
                print(f"  attached PDF from {target}")
            else:
                print(f"  could not attach PDF from {target} (not a reachable PDF)",
                      file=sys.stderr)
    return 0


def cmd_add(args):
    try:
        payload = _load_payload(args)
    except (json.JSONDecodeError, OSError) as e:
        print(f"Invalid payload input: {e}", file=sys.stderr)
        return 2
    return _do_add(payload, cfg=_effective_cfg(args), collection=args.collection,
                   dedupe=not args.no_dedupe, dry_run=args.dry_run,
                   query=args.query, attach_pdf=args.attach_pdf, pdf_url=args.pdf_url)


def cmd_lookup(args):
    kind, ident = identifiers.detect(args.input)
    if kind is None:
        print(f"No clean identifier in input: {args.input!r} (use the agentic path)",
              file=sys.stderr)
        return 3
    try:
        payload = resolvers.resolve(kind, ident)
    except Exception as e:  # noqa: BLE001
        print(f"Resolution failed for {kind} {ident}: {e}", file=sys.stderr)
        return 4
    return _do_add(payload, cfg=_effective_cfg(args), collection=args.collection,
                   dedupe=not args.no_dedupe, dry_run=args.dry_run,
                   query=args.query, attach_pdf=args.attach_pdf, pdf_url=args.pdf_url)


def cmd_collections(args):
    zot = zc.get_client(_effective_cfg(args))
    for c in zot.collections():
        print(f"{c['data']['name']}\t{c['key']}")
    return 0


def _add_push_flags(p):
    p.add_argument("--collection", default=None, help="collection key to file under")
    p.add_argument("--no-dedupe", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--query", default=None,
                   help="originating user query, recorded in Zotero 'extra' as provenance")
    p.add_argument("--attach-pdf", action="store_true",
                   help="download and attach the PDF (from the item url, or --pdf-url)")
    p.add_argument("--pdf-url", default=None,
                   help="explicit PDF url to attach (used with --attach-pdf)")


def _add_library_flag(p):
    """Per-command library override (not persisted). Mutually exclusive."""
    g = p.add_mutually_exclusive_group()
    g.add_argument("--library", default=None,
                   help="target another library for this command only: "
                        "user, user:<id>, group:<id>, or a numeric group id")
    g.add_argument("--group", default=None,
                   help="shorthand for --library group:<id>")


def build_parser():
    parser = argparse.ArgumentParser(prog="zotero-librarian")
    sub = parser.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("setup")
    s.add_argument("--api-key", required=True)
    s.add_argument("--library-id", required=True)
    s.add_argument("--library-type", default="user", choices=["user", "group"])
    s.add_argument("--default-collection", default=None)
    s.set_defaults(func=cmd_setup)

    s = sub.add_parser("resolve")
    s.add_argument("input")
    s.set_defaults(func=cmd_resolve)

    s = sub.add_parser("add")
    g = s.add_mutually_exclusive_group()
    g.add_argument("--json")
    g.add_argument("--file")
    _add_push_flags(s)
    _add_library_flag(s)
    s.set_defaults(func=cmd_add)

    s = sub.add_parser("lookup")
    s.add_argument("input")
    _add_push_flags(s)
    _add_library_flag(s)
    s.set_defaults(func=cmd_lookup)

    s = sub.add_parser("collections")
    _add_library_flag(s)
    s.set_defaults(func=cmd_collections)
    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except FileNotFoundError as e:
        print(str(e), file=sys.stderr)
        return 5
    except Exception as e:  # noqa: BLE001
        print(f"Error: {e}", file=sys.stderr)
        return 5


if __name__ == "__main__":
    sys.exit(main())
