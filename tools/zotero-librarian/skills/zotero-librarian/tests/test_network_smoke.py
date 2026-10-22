import os
import pytest
from zotlib import identifiers, resolvers

pytestmark = pytest.mark.skipif(
    os.environ.get("ZOTLIB_NETWORK_TESTS") != "1",
    reason="set ZOTLIB_NETWORK_TESTS=1 to run live network resolution tests",
)


@pytest.mark.timeout(30)
@pytest.mark.parametrize("text,expect_in_title", [
    ("https://arxiv.org/abs/2511.11595", None),
    ("https://link.springer.com/article/10.1007/s10462-026-11517-6", None),
    ("https://dl.acm.org/doi/10.1145/3790096", None),
])
def test_resolve_fixtures_live(text, expect_in_title):
    kind, ident = identifiers.detect(text)
    assert kind is not None
    payload = resolvers.resolve(kind, ident)
    assert payload["title"]
    assert payload["creators"]
    assert payload["itemType"]
