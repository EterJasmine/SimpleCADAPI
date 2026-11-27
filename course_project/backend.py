"""B owns HTTP orchestration and downloadable artifacts."""
import logging
from uuid import UUID
from pydantic import ValidationError
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse
from starlette.routing import Route
from starlette.exceptions import HTTPException
from starlette.concurrency import run_in_threadpool
from . import mock_cad
from .ai_service import Parser, parse_prompt
from .cad import generate_model
from .config import ROOT, Settings
from .contracts import ErrorInfo, ErrorResponse, GenerateRequest, GenerateResponse, ModelFiles, ModelSpec
from .errors import ServiceError

DEMO = ROOT / "mock" / "model_spec.json"


def error(code, message, status):
    result = ErrorResponse(error=ErrorInfo(code=code, message=message))
    return JSONResponse(result.model_dump(mode="json"), status_code=status)


async def service_error(request, exc):
    logging.error("Service failure: %s", exc.code, exc_info=(type(exc), exc, exc.__traceback__))
    return error(exc.code, exc.message, exc.status)


async def http_error(request, exc):
    return error("NOT_FOUND" if exc.status_code == 404 else "HTTP_ERROR",
                 "访问路径不存在。" if exc.status_code == 404 else "请求方法或访问方式不支持。", exc.status_code)


async def unexpected_error(request, exc):
    logging.error("Unhandled service error", exc_info=(type(exc), exc, exc.__traceback__))
    return error("INTERNAL_ERROR", "服务内部错误，请查看服务端日志。", 500)


async def health(request):
    settings = request.app.state.settings
    return JSONResponse({"status": "ok", "schema_version": "1.0",
                         "ai_mode": settings.ai_mode, "cad_mode": settings.cad_mode,
                         "real_ai_available": request.app.state.ai_parser is not None})


async def build(request: Request):
    settings = request.app.state.settings
    generate = request.url.path.endswith("generate")
    try:
        body = await request.json()
        parsed = GenerateRequest.model_validate(body) if generate else ModelSpec.model_validate(body)
    except (ValidationError, ValueError, TypeError):
        return error("INVALID_REQUEST", "请求不符合协议，请检查零件类型和正数尺寸。", 422)
    warnings = []
    if generate:
        try:
            spec, warnings = await run_in_threadpool(parse_prompt, parsed.prompt, settings, request.app.state.ai_parser)
        except ServiceError:
            raise
        except (OSError, ValueError) as exc:
            raise ServiceError("DEMO_DATA_ERROR", "演示参数文件缺失或无效。") from exc
    else:
        spec = parsed
    try:
        if settings.cad_mode == "mock":
            result = await run_in_threadpool(mock_cad.generate_model, spec, settings.output_dir, settings.mock_dir)
        else:
            result = await run_in_threadpool(generate_model, spec, settings.output_dir)
    except Exception as exc:
        raise ServiceError("CAD_BUILD_FAILED", "建模、测试模型读取或导出失败，请查看服务端日志。") from exc
    response = GenerateResponse(
        **result.spec.model_dump(), model_id=result.model_id,
        files=ModelFiles(**{fmt: f"/api/v1/files/{result.model_id}/{fmt}" for fmt in ("stl", "step")}),
        warnings=warnings + result.warnings, cad_mode=result.cad_mode,
        ai_mode=settings.ai_mode if generate else None,
        requested_spec=spec if result.cad_mode == "mock" else None)
    return JSONResponse(response.model_dump(mode="json"))


async def file(request):
    try:
        model_id = str(UUID(request.path_params["model_id"]))
    except ValueError:
        return error("MODEL_NOT_FOUND", "模型不存在。", 404)
    fmt = request.path_params["format"]
    if fmt not in {"step", "stl"}:
        return error("FILE_NOT_FOUND", "不支持的文件格式。", 404)
    target = request.app.state.settings.output_dir / model_id / f"model.{fmt}"
    if not target.is_file():
        return error("FILE_NOT_FOUND", "模型文件不存在。", 404)
    return FileResponse(target, filename=f"{model_id}.{fmt}", media_type="application/octet-stream")


def create_app(settings: Settings | None = None, ai_parser: Parser | None = None):
    app = Starlette(routes=[Route("/health", health),
        Route("/api/v1/generate", build, methods=["POST"]),
        Route("/api/v1/rebuild", build, methods=["POST"]),
        Route("/api/v1/files/{model_id}/{format}", file)],
        exception_handlers={ServiceError: service_error, HTTPException: http_error, Exception: unexpected_error})
    app.state.settings = settings or Settings.from_env()
    app.state.ai_parser = ai_parser
    return app


app = create_app()
