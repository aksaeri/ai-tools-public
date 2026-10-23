#!/usr/bin/env python
"""Manual entry point: python scripts/zotero_librarian.py <args>."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from zotlib.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
