"""Production settings: secrets from files and TLS configuration."""
import pytest

from app.config import Settings
from app.utils.startup import local_service_url


def test_token_file_takes_precedence(monkeypatch, tmp_path):
    token = tmp_path / "token"
    token.write_text("from-file\n", encoding="utf-8")
    monkeypatch.setenv("AI_SERVICE_TOKEN", "from-env")
    assert Settings().service_token == "from-env"
    monkeypatch.setenv("AI_SERVICE_TOKEN_FILE", str(token))
    assert Settings().service_token == "from-file"


def test_tls_requires_certificate_and_key(monkeypatch, tmp_path):
    monkeypatch.setenv("AI_TLS_CERT_FILE", str(tmp_path / "ai.crt"))
    monkeypatch.delenv("AI_TLS_KEY_FILE", raising=False)
    with pytest.raises(ValueError):
        Settings()
    monkeypatch.setenv("AI_TLS_KEY_FILE", str(tmp_path / "ai.key"))
    assert local_service_url(Settings()).startswith("https://")


def test_plain_http_without_tls(monkeypatch):
    monkeypatch.delenv("AI_TLS_CERT_FILE", raising=False)
    monkeypatch.delenv("AI_TLS_KEY_FILE", raising=False)
    assert local_service_url(Settings()).startswith("http://")
