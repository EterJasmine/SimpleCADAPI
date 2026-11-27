"""B owns HTTP integration. Demo parsing intentionally does not call an LLM."""
import json
import logging
from pathlib import Path
from uuid import UUID
from pydantic import ValidationError
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse
from starlette.routing import Route
from starlette.concurrency import run_in_threadpool
from .cad import generate_model
from .contracts import GenerateRequest, ModelSpec

OUTPUT_DIR = Path(__file__).parent / "outputs"
DEMO = Path(__file__).parent / "mock" / "model_spec.json"


def error(code, message, status):
    return JSONResponse({"success": False, "model_id": None, "files": None,
                         "error": {"code": code, "message": message}}, status_code=status)


async def health(request):
    return JSONResponse({"status": "ok", "schema_version": "1.0", "ai_mode": "mock", "cad_mode": "real"})


async def build(request: Request):
    try:
        body = await request.json()
        if request.url.path.endswith("generate"):
            GenerateRequest.model_validate(body)
            spec = ModelSpec.model_validate_json(DEMO.read_text(encoding="utf-8"))
        else:
            spec = ModelSpec.model_validate(body)
    except (ValidationError, ValueError, TypeError):
        return error("INVALID_REQUEST", "请求不符合协议，请检查零件类型和正数尺寸。", 422)
    try:
        result = await run_in_threadpool(generate_model, spec, OUTPUT_DIR)
    except Exception:
        logging.exception("CAD generation failed")
        return error("CAD_BUILD_FAILED", "建模或导出失败，请查看服务端日志。", 500)
    if request.url.path.endswith("generate"):
        result["warnings"] = ["演示模式：未解析输入文字，固定生成 100×60×10 mm 长方体。"]
    return JSONResponse(result)


async def file(request):
    try:
        model_id = str(UUID(request.path_params["model_id"]))
    except ValueError:
        return error("MODEL_NOT_FOUND", "模型不存在。", 404)
    fmt = request.path_params["format"]
    if fmt not in {"step", "stl"}:
        return error("FILE_NOT_FOUND", "不支持的文件格式。", 404)
    target = OUTPUT_DIR / model_id / f"model.{fmt}"
    if not target.is_file():
        return error("FILE_NOT_FOUND", "模型文件不存在。", 404)
    return FileResponse(target, filename=f"{model_id}.{fmt}")


app = Starlette(routes=[Route("/health", health),
    Route("/api/v1/generate", build, methods=["POST"]),
    Route("/api/v1/rebuild", build, methods=["POST"]),
    Route("/api/v1/files/{model_id}/{format}", file)])
