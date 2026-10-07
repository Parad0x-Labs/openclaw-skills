"""HTTP-level tests for the FastAPI app in api/main.py (auth, upload round trip, archive download)."""
from __future__ import annotations

import importlib.util
import json
import os
import sys
from pathlib import Path

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")
from fastapi.testclient import TestClient  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
API_MAIN = REPO_ROOT / "api" / "main.py"
API_KEY = "test-api-key-for-the-suite"


@pytest.fixture(scope="module")
def api_module():
    saved_path = list(sys.path)
    mp = pytest.MonkeyPatch()
    mp.setenv("LIQUEFY_MASTER_KEY", "test-master-key-for-the-suite")
    try:
        spec = importlib.util.spec_from_file_location("liquefy_api_main_under_test", API_MAIN)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        yield mod
    finally:
        mp.undo()
        sys.path[:] = saved_path


@pytest.fixture
def client(api_module, tmp_path, monkeypatch):
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    monkeypatch.setattr(api_module, "UPLOAD_DIR", uploads)
    monkeypatch.setenv("LIQUEFY_API_KEY", API_KEY)
    with TestClient(api_module.app) as c:
        c.uploads = uploads
        yield c


AUTH = {"Authorization": f"Bearer {API_KEY}"}


def _log_bytes() -> bytes:
    rows = [{"ts": f"2026-10-07T00:00:{i % 60:02d}Z", "level": "info", "event": "compress", "n": i} for i in range(200)]
    return ("\n".join(json.dumps(r) for r in rows) + "\n").encode()


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "OK"


def test_data_endpoints_disabled_without_api_key(client, monkeypatch):
    monkeypatch.delenv("LIQUEFY_API_KEY")
    r = client.post("/api/compress/log", files={"file": ("a.jsonl", b"{}\n")})
    assert r.status_code == 503


def test_wrong_bearer_is_rejected(client):
    r = client.post("/api/compress/log", files={"file": ("a.jsonl", b"{}\n")},
                    headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401
    assert client.get("/api/archive/anything.null").status_code == 401


def test_compress_download_decompress_round_trip(client):
    original = _log_bytes()
    r = client.post("/api/compress/log", files={"file": ("trace.jsonl", original)},
                    data={"tenant": "t1"}, headers=AUTH)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "success"
    assert body["original_size"] == len(original)
    # plaintext upload is not retained
    assert [p.name for p in client.uploads.iterdir()] == [body["download_url"].rsplit("/", 1)[1]]

    archive = client.get(body["download_url"], headers=AUTH)
    assert archive.status_code == 200
    assert archive.content and archive.content != original

    r2 = client.post("/api/decompress", files={"file": ("trace.null", archive.content)},
                     data={"tenant": "t1"}, headers=AUTH)
    assert r2.status_code == 200, r2.text
    restored = client.get(r2.json()["download_url"], headers=AUTH)
    assert restored.status_code == 200
    assert restored.content == original


def test_upload_size_cap(client, api_module, monkeypatch):
    monkeypatch.setattr(api_module, "MAX_UPLOAD_BYTES", 16)
    r = client.post("/api/compress/log", files={"file": ("big.jsonl", b"x" * 64)}, headers=AUTH)
    assert r.status_code == 413
    assert list(client.uploads.iterdir()) == []


@pytest.mark.parametrize("name", [
    "..",
    "...",
    "..%2F..%2Fmain.py",
    "%2e%2e%2fmain.py",
    "..%5C..%5Cmain.py",
    "%2Fetc%2Fpasswd",
    "missing.null",
])
def test_archive_download_stays_inside_uploads(client, name):
    r = client.get(f"/api/archive/{name}", headers=AUTH)
    assert r.status_code == 404


def test_archive_download_refuses_symlink_out_of_uploads(client, tmp_path):
    outside = tmp_path / "outside.txt"
    outside.write_text("not for download")
    (client.uploads / "link.null").symlink_to(outside)
    r = client.get("/api/archive/link.null", headers=AUTH)
    assert r.status_code == 404


def test_archive_download_serves_a_plain_file(client):
    (client.uploads / "job_ok.null").write_bytes(b"payload")
    r = client.get("/api/archive/job_ok.null", headers=AUTH)
    assert r.status_code == 200
    assert r.content == b"payload"
