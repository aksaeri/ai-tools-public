import re
import requests
import xml.etree.ElementTree as ET

TIMEOUT = 20
UA = {"User-Agent": "zotero-librarian/0.1 (mailto:you@example.com)"}

_JATS = re.compile(r"<[^>]+>")

_CROSSREF_TYPE = {
    "journal-article": "journalArticle",
    "proceedings-article": "conferencePaper",
    "posted-content": "preprint",
    "book": "book",
    "book-chapter": "bookSection",
    "report": "report",
    "dataset": "dataset",
}


def _split_name(creator):
    return {"creatorType": "author",
            "firstName": creator.get("given", "").strip(),
            "lastName": creator.get("family", "").strip()}


def _full_name(name):
    parts = name.strip().rsplit(" ", 1)
    if len(parts) == 2:
        return {"creatorType": "author", "firstName": parts[0], "lastName": parts[1]}
    return {"creatorType": "author", "firstName": "", "lastName": name.strip()}


def resolve(kind, ident):
    """Resolve (kind, ident) to a metadata payload dict. Raises on lookup failure."""
    if kind == "doi":
        return _crossref(ident)
    if kind == "arxiv":
        return _arxiv(ident)
    if kind == "isbn":
        return _openlibrary(ident)
    if kind == "pmid":
        return _pubmed(ident)
    raise ValueError(f"unsupported identifier kind: {kind}")


def _crossref(doi):
    r = requests.get(f"https://api.crossref.org/works/{doi}", headers=UA, timeout=TIMEOUT)
    r.raise_for_status()
    m = r.json()["message"]
    year = ""
    dp = m.get("issued", {}).get("date-parts", [[None]])
    if dp and dp[0] and dp[0][0]:
        year = str(dp[0][0])
    payload = {
        "itemType": _CROSSREF_TYPE.get(m.get("type"), "journalArticle"),
        "title": (m.get("title") or [""])[0],
        "creators": [_split_name(a) for a in m.get("author", [])],
        "date": year,
        "DOI": m.get("DOI", ""),
        "url": m.get("URL", ""),
        "publicationTitle": (m.get("container-title") or [""])[0],
        "volume": m.get("volume", ""),
        "issue": m.get("issue", ""),
        "pages": m.get("page", ""),
        "abstractNote": _JATS.sub("", m.get("abstract", "")).strip(),
        "_source": "crossref",
    }
    return {k: v for k, v in payload.items() if v not in ("", [], None) or k == "itemType"}


def _arxiv(arxiv_id):
    bare = arxiv_id.split("v")[0] if re.match(r"\d", arxiv_id) else arxiv_id
    r = requests.get("http://export.arxiv.org/api/query",
                     params={"id_list": arxiv_id}, headers=UA, timeout=TIMEOUT)
    r.raise_for_status()
    ns = {"a": "http://www.w3.org/2005/Atom",
          "arxiv": "http://arxiv.org/schemas/atom"}
    root = ET.fromstring(r.text)
    entry = root.find("a:entry", ns)
    if entry is None:
        raise RuntimeError(f"arXiv returned no entry for {arxiv_id}")
    title = (entry.findtext("a:title", default="", namespaces=ns) or "").strip()
    summary = (entry.findtext("a:summary", default="", namespaces=ns) or "").strip()
    published = entry.findtext("a:published", default="", namespaces=ns) or ""
    year = published[:4]
    authors = [_full_name(a.findtext("a:name", default="", namespaces=ns))
               for a in entry.findall("a:author", ns)]
    doi = entry.findtext("arxiv:doi", default="", namespaces=ns) or ""
    payload = {
        "itemType": "preprint",
        "title": title,
        "creators": authors,
        "date": year,
        "url": f"https://arxiv.org/abs/{bare}",
        "repository": "arXiv",
        "archiveID": f"arXiv:{bare}",
        "abstractNote": summary,
        "DOI": doi,
        "_source": "arxiv",
    }
    return {k: v for k, v in payload.items() if v not in ("", [], None) or k == "itemType"}


def _openlibrary(isbn):
    r = requests.get(f"https://openlibrary.org/isbn/{isbn}.json",
                     headers=UA, timeout=TIMEOUT)
    r.raise_for_status()
    b = r.json()
    creators = []
    for a in b.get("authors", []):
        key = a.get("key")
        if not key:
            continue
        ar = requests.get(f"https://openlibrary.org{key}.json",
                          headers=UA, timeout=TIMEOUT)
        if ar.status_code < 400:
            creators.append(_full_name(ar.json().get("name", "")))
    payload = {
        "itemType": "book",
        "title": b.get("title", ""),
        "creators": creators,
        "date": str(b.get("publish_date", "")),
        "ISBN": isbn,
        "publisher": (b.get("publishers") or [""])[0],
        "numPages": str(b.get("number_of_pages", "")) if b.get("number_of_pages") else "",
        "_source": "openlibrary",
    }
    return {k: v for k, v in payload.items() if v not in ("", [], None) or k == "itemType"}


def _pubmed(pmid):
    r = requests.get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi",
                     params={"db": "pubmed", "id": pmid, "retmode": "json"},
                     headers=UA, timeout=TIMEOUT)
    r.raise_for_status()
    rec = r.json()["result"][pmid]
    doi = ""
    for aid in rec.get("articleids", []):
        if aid.get("idtype") == "doi":
            doi = aid.get("value", "")
    creators = []
    for a in rec.get("authors", []):
        parts = a.get("name", "").split(" ", 1)
        last = parts[0]
        first = parts[1] if len(parts) > 1 else ""
        creators.append({"creatorType": "author", "firstName": first, "lastName": last})
    payload = {
        "itemType": "journalArticle",
        "title": rec.get("title", "").rstrip("."),
        "creators": creators,
        "date": (rec.get("pubdate", "")[:4]),
        "publicationTitle": rec.get("fulljournalname", ""),
        "volume": rec.get("volume", ""),
        "issue": rec.get("issue", ""),
        "pages": rec.get("pages", ""),
        "DOI": doi,
        "extra": f"PMID: {pmid}",
        "_source": "pubmed",
    }
    return {k: v for k, v in payload.items() if v not in ("", [], None) or k == "itemType"}
