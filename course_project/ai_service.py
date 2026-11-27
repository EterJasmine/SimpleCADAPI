"""B owns this extension point; no provider credentials are needed yet."""
from collections.abc import Callable
from .config import Settings
from .contracts import ModelSpec
from .errors import ServiceError

Parser = Callable[[str], ModelSpec]


def parse_prompt(prompt: str, settings: Settings, real_parser: Parser | None = None):
    if settings.ai_mode == "mock":
        spec = ModelSpec.model_validate_json(
            (settings.mock_dir / "model_spec.json").read_text(encoding="utf-8"))
        return spec, ["AI 演示模式：未解析文字，使用固定的 100×60×10 mm 长方体参数。"]
    if real_parser is None:
        raise ServiceError("AI_NOT_IMPLEMENTED", "真实 AI 尚未接入，请使用 AI_MODE=mock。", 501)
    try:
        return ModelSpec.model_validate(real_parser(prompt)), []
    except Exception as exc:
        raise ServiceError("AI_SERVICE_ERROR", "AI 调用失败或返回值不符合 ModelSpec。", 502) from exc
