"""A owns this adapter. Keep SDK-specific exports in this module."""
from pathlib import Path
from threading import Lock
from uuid import uuid4
from .contracts import CadFiles, CadResult, ModelSpec

_kernel_lock = Lock()


def generate_model(spec: ModelSpec, output_dir: Path) -> CadResult:
    import simplecadapi as scad
    from simplecadapi.kernel.ocp_export import export_step_shapes, export_stl_shape

    model_id = uuid4()
    target = output_dir / str(model_id)
    target.mkdir(parents=True)
    files = CadFiles(stl=target / "model.stl", step=target / "model.step")
    p = spec.parameters
    # The native recording/kernel context is shared; serialize calls.
    with _kernel_lock:
        shape = scad.make_box_rsolid(p.length, p.width, p.height)
        export_step_shapes([shape.wrapped], str(files.step))
        export_stl_shape(shape.wrapped, str(files.stl))
    return CadResult(model_id=model_id, spec=spec, files=files, cad_mode="real")
