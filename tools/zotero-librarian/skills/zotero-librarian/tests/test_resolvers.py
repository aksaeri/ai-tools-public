import zotlib.resolvers as R
from conftest import FakeResp

CROSSREF_MSG = {
    "message": {
        "type": "journal-article",
        "title": ["A Survey of Multi-Agent Security"],
        "author": [
            {"given": "Anh", "family": "Nguyen"},
            {"given": "Mei", "family": "Lin"},
        ],
        "issued": {"date-parts": [[2026, 3]]},
        "DOI": "10.1007/s10462-026-11517-6",
        "container-title": ["Artificial Intelligence Review"],
        "volume": "59", "issue": "4", "page": "1-40",
        "abstract": "<jats:p>We survey.</jats:p>",
        "URL": "https://doi.org/10.1007/s10462-026-11517-6",
    }
}

ARXIV_XML = """<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2511.11595v1</id>
    <title>Extreme Risk Model Evaluation</title>
    <summary>We propose evaluations.</summary>
    <published>2025-11-15T00:00:00Z</published>
    <author><name>Toby Shevlane</name></author>
    <author><name>Mary Phuong</name></author>
    <arxiv:doi>10.0000/zzz</arxiv:doi>
  </entry>
</feed>"""


def test_crossref_maps_to_payload(monkeypatch):
    monkeypatch.setattr(R.requests, "get",
                        lambda url, **k: FakeResp(json_data=CROSSREF_MSG))
    p = R.resolve("doi", "10.1007/s10462-026-11517-6")
    assert p["itemType"] == "journalArticle"
    assert p["title"] == "A Survey of Multi-Agent Security"
    assert p["creators"][0] == {"creatorType": "author",
                                "firstName": "Anh", "lastName": "Nguyen"}
    assert p["date"] == "2026"
    assert p["DOI"] == "10.1007/s10462-026-11517-6"
    assert p["publicationTitle"] == "Artificial Intelligence Review"
    assert p["pages"] == "1-40"
    assert "<jats" not in p["abstractNote"]
    assert p["_source"] == "crossref"


def test_crossref_proceedings_type(monkeypatch):
    msg = {"message": {**CROSSREF_MSG["message"], "type": "proceedings-article"}}
    monkeypatch.setattr(R.requests, "get",
                        lambda url, **k: FakeResp(json_data=msg))
    assert R.resolve("doi", "x")["itemType"] == "conferencePaper"


def test_arxiv_maps_to_payload(monkeypatch):
    monkeypatch.setattr(R.requests, "get",
                        lambda url, **k: FakeResp(text=ARXIV_XML))
    p = R.resolve("arxiv", "2511.11595")
    assert p["itemType"] == "preprint"
    assert p["title"] == "Extreme Risk Model Evaluation"
    assert p["creators"][0] == {"creatorType": "author",
                                "firstName": "Toby", "lastName": "Shevlane"}
    assert p["date"] == "2025"
    assert p["url"] == "https://arxiv.org/abs/2511.11595"
    assert p["archiveID"] == "arXiv:2511.11595"
    assert p["_source"] == "arxiv"


OPENLIB = {
    "title": "Reinforcement Learning",
    "authors": [{"key": "/authors/OL1A"}],
    "publish_date": "2018",
    "publishers": ["MIT Press"],
    "number_of_pages": 552,
}
OPENLIB_AUTHOR = {"name": "Richard S. Sutton"}


def test_openlibrary_maps_to_book(monkeypatch):
    def fake_get(url, **k):
        if "/authors/" in url:
            return FakeResp(json_data=OPENLIB_AUTHOR)
        return FakeResp(json_data=OPENLIB)
    monkeypatch.setattr(R.requests, "get", fake_get)
    p = R.resolve("isbn", "9780262039246")
    assert p["itemType"] == "book"
    assert p["title"] == "Reinforcement Learning"
    assert p["creators"][0]["lastName"] == "Sutton"
    assert p["ISBN"] == "9780262039246"
    assert p["publisher"] == "MIT Press"
    assert p["numPages"] == "552"


PUBMED_SUMMARY = {
    "result": {
        "uids": ["37001234"],
        "37001234": {
            "title": "A Clinical Study.",
            "authors": [{"name": "Smith J"}, {"name": "Doe A"}],
            "fulljournalname": "Journal of Medicine",
            "pubdate": "2023 May",
            "volume": "12", "issue": "3", "pages": "200-210",
            "articleids": [{"idtype": "doi", "value": "10.1000/xyz"}],
        }
    }
}


def test_pubmed_maps_to_article(monkeypatch):
    monkeypatch.setattr(R.requests, "get",
                        lambda url, **k: FakeResp(json_data=PUBMED_SUMMARY))
    p = R.resolve("pmid", "37001234")
    assert p["itemType"] == "journalArticle"
    assert p["title"] == "A Clinical Study"
    assert p["creators"][0]["lastName"] == "Smith"
    assert p["publicationTitle"] == "Journal of Medicine"
    assert p["date"] == "2023"
    assert p["DOI"] == "10.1000/xyz"
