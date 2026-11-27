"""Regenerate the checked-in protocol schemas: python -m course_project.export_schemas."""
import json
from pathlib import Path
from .contracts import CadResult, ErrorResponse, GenerateRequest, GenerateResponse, ModelSpec


def export(directory: Path = Path(__file__).parent):
    for name, model in {"model_spec": ModelSpec, "generate_request": GenerateRequest,
                        "cad_result": CadResult, "generate_response": GenerateResponse,
                        "error_response": ErrorResponse}.items():
        (directory / f"{name}.schema.json").write_text(
            json.dumps(model.model_json_schema(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    export()
