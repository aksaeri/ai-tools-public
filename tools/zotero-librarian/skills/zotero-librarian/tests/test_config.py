import json
import pytest
from zotlib import config


def test_save_then_load_roundtrip(tmp_config):
    cfg = {"api_key": "k", "library_id": "123",
           "library_type": "user", "default_collection": None}
    path = config.save(cfg)
    assert path == tmp_config
    assert config.load() == cfg


def test_load_missing_raises(tmp_config):
    with pytest.raises(FileNotFoundError):
        config.load()


def test_save_creates_parent_dir(tmp_path, monkeypatch):
    nested = tmp_path / "deep" / "zotero-config.json"
    monkeypatch.setenv("ZOTERO_LIBRARIAN_CONFIG", str(nested))
    config.save({"api_key": "k", "library_id": "1"})
    assert nested.exists()


def test_apply_library_override_group_by_spec():
    cfg = {"api_key": "k", "library_id": "111", "library_type": "user",
           "default_collection": "COLL"}
    out = config.apply_library_override(cfg, "group:6626682")
    assert out["library_type"] == "group"
    assert out["library_id"] == "6626682"
    assert out["api_key"] == "k"
    # a collection key is library-specific; the configured default must not leak
    assert out["default_collection"] is None
    # the original cfg must not be mutated
    assert cfg["library_type"] == "user"
    assert cfg["default_collection"] == "COLL"


def test_apply_library_override_bare_numeric_is_group():
    cfg = {"api_key": "k", "library_id": "111", "library_type": "user"}
    out = config.apply_library_override(cfg, "6626682")
    assert (out["library_type"], out["library_id"]) == ("group", "6626682")


def test_apply_library_override_user_uses_config_id():
    cfg = {"api_key": "k", "library_id": "111", "library_type": "user"}
    out = config.apply_library_override(cfg, "user")
    assert (out["library_type"], out["library_id"]) == ("user", "111")


def test_apply_library_override_user_with_explicit_id():
    cfg = {"api_key": "k", "library_id": "111", "library_type": "user"}
    out = config.apply_library_override(cfg, "user:999")
    assert (out["library_type"], out["library_id"]) == ("user", "999")


def test_apply_library_override_invalid_spec_raises():
    cfg = {"api_key": "k", "library_id": "111", "library_type": "user"}
    with pytest.raises(ValueError):
        config.apply_library_override(cfg, "banana")


def test_apply_library_override_group_without_id_raises():
    cfg = {"api_key": "k", "library_id": "111", "library_type": "user"}
    with pytest.raises(ValueError):
        config.apply_library_override(cfg, "group")
