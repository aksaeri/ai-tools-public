import json
import pytest


class FakeResp:
    """Minimal stand-in for requests.Response."""
    def __init__(self, *, json_data=None, text="", status=200, headers=None, content=b""):
        self._json = json_data
        self.text = text
        self.status_code = status
        self.headers = headers or {}
        self.content = content

    def json(self):
        if self._json is None:
            raise ValueError("no json")
        return self._json

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class StubZotero:
    """Stand-in for pyzotero.zotero.Zotero used in unit tests."""
    def __init__(self, templates=None, existing=None, create_response=None):
        self._templates = templates or {}
        self._existing = existing or []          # list of item dicts {'key','data'}
        self._create_response = create_response
        self.created = []                        # records what was sent to create_items
        self.attached = []                       # records (files, parentid) attachments

    def item_template(self, item_type):
        if item_type not in self._templates:
            raise RuntimeError(f"unknown item type {item_type}")
        return dict(self._templates[item_type])

    def items(self, **kwargs):
        return list(self._existing)

    def create_items(self, items):
        self.created.append(items)
        if self._create_response is not None:
            return self._create_response
        return {"successful": {"0": {"key": "ABCD1234",
                                     "data": {**items[0], "key": "ABCD1234"}}},
                "failed": {}}

    def attachment_simple(self, files, parentid=None):
        self.attached.append((list(files), parentid))
        return {"success": {"0": "ATTACHKEY"}, "failure": {}, "unchanged": {}}


@pytest.fixture
def tmp_config(tmp_path, monkeypatch):
    path = tmp_path / "zotero-config.json"
    monkeypatch.setenv("ZOTERO_LIBRARIAN_CONFIG", str(path))
    return path
