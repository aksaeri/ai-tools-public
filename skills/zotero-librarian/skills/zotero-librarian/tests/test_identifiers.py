import pytest
from zotlib.identifiers import detect


@pytest.mark.parametrize("text,kind,ident", [
    ("https://arxiv.org/abs/2511.11595", "arxiv", "2511.11595"),
    ("arXiv:2502.09288", "arxiv", "2502.09288"),
    ("2502.13294", "arxiv", "2502.13294"),
    ("https://arxiv.org/abs/2502.09288v2", "arxiv", "2502.09288v2"),
    ("https://link.springer.com/article/10.1007/s10462-026-11517-6",
     "doi", "10.1007/s10462-026-11517-6"),
    ("https://dl.acm.org/doi/10.1145/3790096", "doi", "10.1145/3790096"),
    ("https://doi.org/10.1145/3790096#sec1", "doi", "10.1145/3790096"),
    ("https://doi.org/10.1145/3790096?utm=x", "doi", "10.1145/3790096"),
    ("doi:10.1145/3790096", "doi", "10.1145/3790096"),
    ("https://pubmed.ncbi.nlm.nih.gov/37001234", "pmid", "37001234"),
    ("PMID: 37001234", "pmid", "37001234"),
    ("ISBN 978-0-13-468599-1", "isbn", "9780134685991"),
])
def test_detect_known(text, kind, ident):
    assert detect(text) == (kind, ident)


@pytest.mark.parametrize("text", [
    "Model evaluation for extreme risks",
    "Nguyen security considerations for multi-agent",
    "https://example.com/some/article",
    "",
])
def test_detect_unknown(text):
    assert detect(text) == (None, None)
