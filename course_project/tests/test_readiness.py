import builtins
import json
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

import pytest
from jsonschema import Draft202012Validator
from starlette.testclient import TestClient
from course_project import backend, mock_cad
from course_project.config import ROOT, Settings
from course_project.contracts import CadResult, ErrorResponse, GenerateRequest, GenerateResponse, ModelSpec


def spec():
    return json.loads(backend.DEMO.read_text(encoding="utf-8"))


@pytest.fixture
def client(tmp_path):
    with TestClient(backend.create_app(Settings(output_dir=tmp_path)), raise_server_exceptions=False) as client:
        yield client


def assert_error(response, status, code):
    assert response.status_code == status
    assert response.headers["content-type"].startswith("application/json")
    data = response.json()
    assert data["error"]["code"] == code
    ErrorResponse.model_validate(data)
    Draft202012Validator(ErrorResponse.model_json_schema()).validate(data)


def test_mock_never_imports_kernel(tmp_path):
    # Fresh process proves module startup, generation and downloads without an installed SDK.
    code = '''
import builtins, sys
original = builtins.__import__
def guarded(name, *args, **kwargs):
    if name.startswith(("simplecadapi", "OCP", "cadquery")):
        raise AssertionError("Mock attempted to import CAD kernel")
    return original(name, *args, **kwargs)
builtins.__import__ = guarded
from pathlib import Path
from starlette.testclient import TestClient
from course_project.backend import create_app
from course_project.config import Settings
with TestClient(create_app(Settings(output_dir=Path(sys.argv[1])))) as client:
    response = client.post("/api/v1/generate", json={"prompt":"demo"})
    assert response.status_code == 200, response.text
    for url in response.json()["files"].values():
        assert client.get(url).status_code == 200
assert not any(k.startswith("simplecadapi") for k in sys.modules)
'''
    subprocess.run([sys.executable, "-c", code, str(tmp_path)], check=True,
                   cwd=ROOT.parent, env={**os.environ, "AI_MODE": "mock", "CAD_MODE": "mock"})


def test_mock_is_downloadable_and_honest(client):
    request = spec()
    request["parameters"]["length"] = 250
    response = client.post("/api/v1/rebuild", json=request)
    assert response.status_code == 200
    result = response.json()
    GenerateResponse.model_validate(result)
    Draft202012Validator(GenerateResponse.model_json_schema()).validate(result)
    assert result["parameters"]["length"] == 100
    assert result["requested_spec"]["parameters"]["length"] == 250
    assert result["cad_mode"] == "mock" and result["ai_mode"] is None
    assert result["warnings"]
    for fmt, url in result["files"].items():
        download = client.get(url)
        assert download.status_code == 200
        assert download.content == (ROOT / "mock" / f"demo.{fmt}").read_bytes()
    second = client.post("/api/v1/rebuild", json=request).json()
    assert second["model_id"] != result["model_id"]


@pytest.mark.parametrize("endpoint,body,status,code", [
    ("/api/v1/generate", {"prompt":" "}, 422, "INVALID_REQUEST"),
    ("/api/v1/rebuild", {}, 422, "INVALID_REQUEST"),
    ("/api/v1/rebuild", {"model_type":"cylinder", "parameters":{}}, 422, "INVALID_REQUEST"),
])
def test_bad_requests(client, endpoint, body, status, code):
    assert_error(client.post(endpoint, json=body), status, code)


def test_invalid_json(client):
    assert_error(client.post("/api/v1/rebuild", content="bad"), 422, "INVALID_REQUEST")


@pytest.mark.parametrize("path,code", [
    ("/api/v1/files/bad/stl", "MODEL_NOT_FOUND"),
    (f"/api/v1/files/{uuid4()}/stl", "FILE_NOT_FOUND"),
    (f"/api/v1/files/{uuid4()}/obj", "FILE_NOT_FOUND"),
    ("/missing", "NOT_FOUND"),
])
def test_json_not_found(client, path, code):
    assert_error(client.get(path), 404, code)


def test_json_method_error(client):
    assert_error(client.get("/api/v1/generate"), 405, "HTTP_ERROR")


@pytest.mark.parametrize("contents", [None, "invalid json", "{}"])
def test_broken_demo_file(tmp_path, contents):
    if contents is not None:
        (tmp_path / "model_spec.json").write_text(contents)
    with TestClient(backend.create_app(Settings(mock_dir=tmp_path))) as client:
        assert_error(client.post("/api/v1/generate", json={"prompt":"demo"}), 500, "DEMO_DATA_ERROR")


def test_missing_mock_geometry(tmp_path):
    (tmp_path / "model_spec.json").write_text(json.dumps(spec()))
    with TestClient(backend.create_app(Settings(mock_dir=tmp_path, output_dir=tmp_path / "out"))) as client:
        assert_error(client.post("/api/v1/rebuild", json=spec()), 500, "CAD_BUILD_FAILED")


def test_unexpected_error(client, monkeypatch):
    def fail(*args):
        raise RuntimeError("private internal details")
    monkeypatch.setattr(backend, "parse_prompt", fail)
    response = client.post("/api/v1/generate", json={"prompt":"demo"})
    assert_error(response, 500, "INTERNAL_ERROR")
    assert "private internal details" not in response.text


@pytest.mark.parametrize("cad_mode", ["mock", "real"])
def test_real_ai_explicitly_unimplemented(tmp_path, cad_mode):
    with TestClient(backend.create_app(Settings(ai_mode="real", cad_mode=cad_mode, output_dir=tmp_path))) as client:
        assert_error(client.post("/api/v1/generate", json={"prompt":"demo"}), 501, "AI_NOT_IMPLEMENTED")
        # Rebuild bypasses AI even when no real parser is installed.
        assert client.post("/api/v1/rebuild", json=spec()).status_code == 200


@pytest.mark.parametrize("cad_mode", ["mock", "real"])
def test_real_parser_extension(tmp_path, cad_mode):
    received = []
    def parser(prompt):
        received.append(prompt)
        return ModelSpec.model_validate(spec())
    app = backend.create_app(Settings(ai_mode="real", cad_mode=cad_mode, output_dir=tmp_path), ai_parser=parser)
    with TestClient(app) as client:
        response = client.post("/api/v1/generate", json={"prompt":"test parser"})
        assert response.status_code == 200, response.text
        assert response.json()["ai_mode"] == "real"
        assert received == ["test parser"]


def test_bad_real_parser(tmp_path):
    app = backend.create_app(Settings(ai_mode="real", output_dir=tmp_path), ai_parser=lambda prompt: {})
    with TestClient(app) as client:
        assert_error(client.post("/api/v1/generate", json={"prompt":"demo"}), 502, "AI_SERVICE_ERROR")


def test_env_modes(monkeypatch):
    monkeypatch.setenv("AI_MODE", "real")
    monkeypatch.setenv("CAD_MODE", "mock")
    assert Settings.from_env().ai_mode == "real"
    monkeypatch.setenv("CAD_MODE", "typo")
    with pytest.raises(ValueError):
        Settings.from_env()


@pytest.mark.parametrize("name,model", [("model_spec", ModelSpec), ("generate_request", GenerateRequest),
    ("cad_result", CadResult), ("generate_response", GenerateResponse), ("error_response", ErrorResponse)])
def test_schema_and_examples(name, model):
    saved = json.loads((ROOT / f"{name}.schema.json").read_text(encoding="utf-8"))
    assert saved == model.model_json_schema()
    Draft202012Validator.check_schema(saved)
    if name == "generate_response":
        example = json.loads((ROOT / "mock" / "response.example.json").read_text(encoding="utf-8-sig"))
        GenerateResponse.model_validate(example)
        Draft202012Validator(saved).validate(example)


def test_internal_artifacts_have_no_http(tmp_path):
    result = mock_cad.generate_model(ModelSpec.model_validate(spec()), tmp_path, ROOT / "mock")
    assert all(path.is_file() for path in (result.files.stl, result.files.step))
    assert "/api/" not in result.model_dump_json()


def test_mock_dimensions_do_not_follow_ai_sample(tmp_path):
    from shutil import copyfile
    for fmt in ("stl", "step"):
        copyfile(ROOT / "mock" / f"demo.{fmt}", tmp_path / f"demo.{fmt}")
    altered = spec()
    altered["parameters"]["length"] = 999
    (tmp_path / "model_spec.json").write_text(json.dumps(altered))
    result = mock_cad.generate_model(ModelSpec.model_validate(altered), tmp_path / "out", tmp_path)
    assert result.spec.parameters.length == 100
