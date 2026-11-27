"""A owns this adapter. Keep SDK-specific exports in this module."""
from pathlib import Path
from threading import Lock
from uuid import uuid4
from .contracts import ModelSpec

_kernel_lock = Lock()


def generate_model(spec: ModelSpec, output_dir: Path) -> dict:
    import simplecadapi as scad
    from simplecadapi.kernel.ocp_export import export_step_shapes, export_stl_shape

    model_id = str(uuid4())
    target = output_dir / model_id
    target.mkdir(parents=True)
    p = spec.parameters
    # The native recording/kernel context is shared; serialize calls.
    with _kernel_lock:
        shape = scad.make_box_rsolid(p.length, p.width, p.height)
        export_step_shapes([shape.wrapped], str(target / "model.step"))
        export_stl_shape(shape.wrapped, str(target / "model.stl"))
    result = {
        "success": True, "model_id": model_id, **spec.model_dump(),
        "files": {fmt: f"/api/v1/files/{model_id}/{fmt}" for fmt in ("stl", "step")},
        "warnings": [], "error": None,
    }
    (target / "result.json").write_text(__import__("json").dumps(result), encoding="utf-8")
    return result
