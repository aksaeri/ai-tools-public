import pytest
from conftest import StubZotero
import zotlib.zotero_client as Z

TEMPLATES = {
    "journalArticle": {"itemType": "journalArticle", "title": "", "creators": [],
                       "date": "", "DOI": "", "publicationTitle": "",
                       "volume": "", "issue": "", "pages": "", "abstractNote": "",
                       "url": "", "tags": [], "collections": []},
}


def test_coerce_keeps_known_drops_unknown():
    zot = StubZotero(templates=TEMPLATES)
    payload = {"itemType": "journalArticle", "title": "T",
               "creators": [{"creatorType": "author", "firstName": "A", "lastName": "B"}],
               "DOI": "10.1/x", "bogusField": "nope", "_source": "crossref"}
    item, missing = Z.coerce(zot, payload)
    assert item["title"] == "T"
    assert item["DOI"] == "10.1/x"
    assert "bogusField" not in item
    assert "_source" not in item
    assert missing == []


def test_coerce_flags_missing_title():
    zot = StubZotero(templates=TEMPLATES)
    item, missing = Z.coerce(zot, {"itemType": "journalArticle", "creators": [{"x": 1}]})
    assert "title" in missing


def test_coerce_unknown_type_raises():
    zot = StubZotero(templates=TEMPLATES)
    with pytest.raises(RuntimeError):
        Z.coerce(zot, {"itemType": "nonsense", "title": "T"})


def test_find_duplicate_by_doi():
    existing = [{"key": "DUP1", "data": {"DOI": "10.1/x", "title": "T"}}]
    zot = StubZotero(templates=TEMPLATES, existing=existing)
    assert Z.find_duplicate(zot, {"DOI": "10.1/X"}) == "DUP1"


def test_find_duplicate_none():
    zot = StubZotero(templates=TEMPLATES, existing=[])
    assert Z.find_duplicate(zot, {"DOI": "10.1/x", "title": "T"}) is None


def test_create_item_returns_key_and_collection():
    zot = StubZotero(templates=TEMPLATES)
    item, _ = Z.coerce(zot, {"itemType": "journalArticle", "title": "T"})
    key, item_type = Z.create_item(zot, item, collection="COLL9")
    assert key == "ABCD1234"
    assert item_type == "journalArticle"
    assert zot.created[0][0]["collections"] == ["COLL9"]


def test_create_item_raises_on_failure():
    zot = StubZotero(templates=TEMPLATES,
                     create_response={"successful": {}, "failed": {"0": {"message": "bad"}}})
    item, _ = Z.coerce(zot, {"itemType": "journalArticle", "title": "T"})
    with pytest.raises(RuntimeError):
        Z.create_item(zot, item)


def test_attach_pdf_success(monkeypatch):
    from conftest import FakeResp
    zot = StubZotero(templates=TEMPLATES)
    monkeypatch.setattr(Z.requests, "get",
                        lambda url, **k: FakeResp(headers={"content-type": "application/pdf"},
                                                  content=b"%PDF-1.7 hello"))
    key = Z.attach_pdf(zot, "PARENT9", "https://x.example/report.pdf")
    assert key == "ATTACHKEY"
    files, parentid = zot.attached[0]
    assert parentid == "PARENT9"
    assert files[0].lower().endswith("report.pdf")


def test_attach_pdf_rejects_non_pdf(monkeypatch):
    from conftest import FakeResp
    zot = StubZotero(templates=TEMPLATES)
    monkeypatch.setattr(Z.requests, "get",
                        lambda url, **k: FakeResp(headers={"content-type": "text/html"},
                                                  content=b"<html></html>"))
    assert Z.attach_pdf(zot, "PARENT9", "https://x.example/page") is None
    assert zot.attached == []
