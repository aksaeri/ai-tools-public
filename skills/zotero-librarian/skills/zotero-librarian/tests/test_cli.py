import json
import pytest
import zotlib.cli as cli
import zotlib.resolvers as R
import zotlib.zotero_client as Z
from conftest import StubZotero

TEMPLATES = {
    "journalArticle": {"itemType": "journalArticle", "title": "", "creators": [],
                       "date": "", "DOI": "", "publicationTitle": "", "url": "",
                       "extra": "", "collections": [], "tags": []},
    "webpage": {"itemType": "webpage", "title": "", "creators": [], "date": "",
                "url": "", "websiteTitle": "", "abstractNote": "", "accessDate": "",
                "extra": "", "collections": [], "tags": []},
}


def test_resolve_unknown_returns_3(capsys):
    code = cli.main(["resolve", "Model evaluation for extreme risks"])
    assert code == 3


def test_resolve_doi_prints_payload(monkeypatch, capsys):
    monkeypatch.setattr(R, "resolve",
                        lambda kind, ident: {"itemType": "journalArticle",
                                             "title": "T", "DOI": ident})
    code = cli.main(["resolve", "10.1145/3790096"])
    out = json.loads(capsys.readouterr().out)
    assert code == 0
    assert out["title"] == "T"
    assert out["DOI"] == "10.1145/3790096"


def test_add_dry_run_prints_item(monkeypatch, capsys, tmp_config):
    monkeypatch.setattr(Z, "get_client", lambda cfg=None: StubZotero(templates=TEMPLATES))
    payload = json.dumps({"itemType": "journalArticle", "title": "Hello"})
    code = cli.main(["add", "--json", payload, "--dry-run"])
    out = json.loads(capsys.readouterr().out)
    assert code == 0
    assert out["title"] == "Hello"


def test_add_creates_and_reports_key(monkeypatch, capsys, tmp_config):
    stub = StubZotero(templates=TEMPLATES)
    monkeypatch.setattr(Z, "get_client", lambda cfg=None: stub)
    payload = json.dumps({"itemType": "journalArticle", "title": "Hello"})
    code = cli.main(["add", "--json", payload, "--no-dedupe"])
    assert code == 0
    assert "ABCD1234" in capsys.readouterr().out


def test_add_skips_duplicate(monkeypatch, capsys, tmp_config):
    existing = [{"key": "DUP1", "data": {"DOI": "10.1/x", "title": "Hello"}}]
    monkeypatch.setattr(Z, "get_client",
                        lambda cfg=None: StubZotero(templates=TEMPLATES, existing=existing))
    payload = json.dumps({"itemType": "journalArticle", "title": "Hello", "DOI": "10.1/x"})
    code = cli.main(["add", "--json", payload])
    assert code == 0
    assert "duplicate" in capsys.readouterr().out.lower()


def test_add_malformed_json_returns_2(capsys):
    code = cli.main(["add", "--json", "{not valid json"])
    assert code == 2


def test_add_query_writes_provenance_extra(monkeypatch, capsys, tmp_config):
    stub = StubZotero(templates=TEMPLATES)
    monkeypatch.setattr(Z, "get_client", lambda cfg=None: stub)
    payload = json.dumps({"itemType": "journalArticle", "title": "Hello"})
    code = cli.main(["add", "--json", payload, "--no-dedupe", "--query", "add Hello to zotero"])
    assert code == 0
    sent = stub.created[0][0]
    assert 'Automatic record from user query "add Hello to zotero"' in sent["extra"]


def test_add_accessdate_today_for_agent_webpage(monkeypatch, capsys, tmp_config):
    import datetime
    stub = StubZotero(templates=TEMPLATES)
    monkeypatch.setattr(Z, "get_client", lambda cfg=None: stub)
    payload = json.dumps({"itemType": "webpage", "title": "A page",
                          "url": "https://x.example", "_source": "agent"})
    code = cli.main(["add", "--json", payload, "--no-dedupe"])
    assert code == 0
    sent = stub.created[0][0]
    assert sent["accessDate"] == datetime.date.today().isoformat()


def test_add_no_accessdate_for_non_agent(monkeypatch, capsys, tmp_config):
    stub = StubZotero(templates=TEMPLATES)
    monkeypatch.setattr(Z, "get_client", lambda cfg=None: stub)
    payload = json.dumps({"itemType": "webpage", "title": "A page",
                          "url": "https://x.example", "_source": "crossref"})
    code = cli.main(["add", "--json", payload, "--no-dedupe"])
    assert code == 0
    assert stub.created[0][0]["accessDate"] == ""


def test_add_without_override_uses_default_client(monkeypatch, capsys, tmp_config):
    captured = {}
    stub = StubZotero(templates=TEMPLATES)

    def fake_get_client(cfg=None):
        captured["cfg"] = cfg
        return stub
    monkeypatch.setattr(Z, "get_client", fake_get_client)
    payload = json.dumps({"itemType": "journalArticle", "title": "Hello"})
    code = cli.main(["add", "--json", payload, "--no-dedupe"])
    assert code == 0
    # no --library/--group → default client (get_client loads config itself)
    assert captured["cfg"] is None


def test_add_group_override_targets_group_library(monkeypatch, capsys, tmp_config):
    from zotlib import config
    config.save({"api_key": "k", "library_id": "111", "library_type": "user",
                 "default_collection": None})
    captured = {}
    stub = StubZotero(templates=TEMPLATES)

    def fake_get_client(cfg=None):
        captured["cfg"] = cfg
        return stub
    monkeypatch.setattr(Z, "get_client", fake_get_client)
    payload = json.dumps({"itemType": "journalArticle", "title": "Hello"})
    code = cli.main(["add", "--json", payload, "--no-dedupe", "--group", "1234567"])
    assert code == 0
    assert captured["cfg"]["library_type"] == "group"
    assert captured["cfg"]["library_id"] == "1234567"


def test_add_library_spec_override_targets_group(monkeypatch, capsys, tmp_config):
    from zotlib import config
    config.save({"api_key": "k", "library_id": "111", "library_type": "user"})
    captured = {}
    stub = StubZotero(templates=TEMPLATES)

    def fake_get_client(cfg=None):
        captured["cfg"] = cfg
        return stub
    monkeypatch.setattr(Z, "get_client", fake_get_client)
    payload = json.dumps({"itemType": "journalArticle", "title": "Hello"})
    code = cli.main(["add", "--json", payload, "--no-dedupe", "--library", "group:1234567"])
    assert code == 0
    assert (captured["cfg"]["library_type"], captured["cfg"]["library_id"]) == ("group", "1234567")


def test_collections_group_override(monkeypatch, capsys, tmp_config):
    from zotlib import config
    config.save({"api_key": "k", "library_id": "111", "library_type": "user"})
    captured = {}

    class CollStub(StubZotero):
        def collections(self):
            return [{"key": "CK", "data": {"name": "Name"}}]
    stub = CollStub(templates=TEMPLATES)

    def fake_get_client(cfg=None):
        captured["cfg"] = cfg
        return stub
    monkeypatch.setattr(Z, "get_client", fake_get_client)
    code = cli.main(["collections", "--group", "1234567"])
    assert code == 0
    assert (captured["cfg"]["library_type"], captured["cfg"]["library_id"]) == ("group", "1234567")


def test_add_attach_pdf_calls_attachment(monkeypatch, capsys, tmp_config):
    from conftest import FakeResp
    stub = StubZotero(templates=TEMPLATES)
    monkeypatch.setattr(Z, "get_client", lambda cfg=None: stub)
    monkeypatch.setattr(Z.requests, "get",
                        lambda url, **k: FakeResp(headers={"content-type": "application/pdf"},
                                                  content=b"%PDF-1.7 data"))
    payload = json.dumps({"itemType": "webpage", "title": "A page",
                          "url": "https://x.example/file.pdf", "_source": "agent"})
    code = cli.main(["add", "--json", payload, "--no-dedupe", "--attach-pdf"])
    assert code == 0
    assert len(stub.attached) == 1
    files, parentid = stub.attached[0]
    assert parentid == "ABCD1234"
    assert files[0].lower().endswith(".pdf")
