import json
import pytest
from starlette.testclient import TestClient
from course_project import backend


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(backend, "OUTPUT_DIR", tmp_path)
    with TestClient(backend.app) as client:
        yield client


def test_real_cad_roundtrip(client):
    spec = json.loads(backend.DEMO.read_text())
    response = client.post("/api/v1/rebuild", json=spec)
    assert response.status_code == 200, response.text
    result = response.json()
    step = client.get(result["files"]["step"])
    stl = client.get(result["files"]["stl"])
    assert step.status_code == stl.status_code == 200
    assert b"ISO-10303-21" in step.content
    assert len(stl.content) > 100
    again = client.post("/api/v1/rebuild", json=spec).json()
    assert again["model_id"] != result["model_id"]


@pytest.mark.parametrize("value", [-1, 0, "100", True, None])
def test_invalid_dimension(client, value):
    spec = json.loads(backend.DEMO.read_text())
    spec["parameters"]["length"] = value
    assert client.post("/api/v1/rebuild", json=spec).status_code == 422


def test_mock_prompt_and_errors(client):
    assert client.get("/health").json()["ai_mode"] == "mock"
    assert client.post("/api/v1/generate", json={"prompt": " "}).status_code == 422
    response = client.post("/api/v1/generate", json={"prompt": "演示"})
    assert response.status_code == 200
    assert response.json()["warnings"]
    assert client.post("/api/v1/rebuild", content="bad json").status_code == 422
    assert client.get("/api/v1/files/invalid/step").status_code == 404


def test_kernel_error(client, monkeypatch):
    def fail(*args):
        raise RuntimeError("internal details")
    monkeypatch.setattr(backend, "generate_model", fail)
    result = client.post("/api/v1/rebuild", json=json.loads(backend.DEMO.read_text()))
    assert result.status_code == 500
    assert "internal details" not in result.text
