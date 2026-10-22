import re

# arXiv ids in a URL or with an arXiv: prefix
ARXIV_URL_RE = re.compile(r'(?:arxiv\.org/abs/|arxiv:)\s*([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)', re.I)
# bare arXiv id as the whole string
ARXIV_BARE_RE = re.compile(r'^([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)$')
DOI_RE = re.compile(r'(10\.\d{4,9}/[^\s"<>]+)', re.I)
PMID_RE = re.compile(r'(?:pmid:\s*|pubmed\.ncbi\.nlm\.nih\.gov/)(\d{1,9})', re.I)
ISBN_RE = re.compile(r'(97[89][\d-]{10,16}\d|\d[\d-]{8,14}[\dxX])')


def detect(text):
    """Detect a bibliographic identifier in `text`.

    Returns (kind, normalized_id) where kind is one of
    'arxiv' | 'doi' | 'pmid' | 'isbn', or (None, None) if nothing recognized.
    Order matters: arXiv and DOI are checked before the looser ISBN pattern.
    """
    s = (text or "").strip()
    if not s:
        return (None, None)

    m = ARXIV_URL_RE.search(s) or ARXIV_BARE_RE.match(s)
    if m:
        return ("arxiv", m.group(1))

    m = DOI_RE.search(s)
    if m:
        doi = m.group(1).split("#", 1)[0].split("?", 1)[0].rstrip(".,);")
        return ("doi", doi)

    m = PMID_RE.search(s)
    if m:
        return ("pmid", m.group(1))

    m = ISBN_RE.search(s)
    if m:
        digits = re.sub(r"[-\s]", "", m.group(1))
        if len(digits) in (10, 13):
            return ("isbn", digits)

    return (None, None)
