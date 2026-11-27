"""Copies checked-in fixtures; never imports or runs the geometry kernel."""
from pathlib import Path
from shutil import copyfile
from uuid import uuid4
from .contracts import CadFiles, CadResult, ModelSpec


def generate_model(spec: ModelSpec, output_dir: Path, mock_dir: Path) -> CadResult:
    # Fixture dimensions are independent of the mock AI's editable request sample.
    actual = ModelSpec(model_type="box", parameters={"length": 100.0, "width": 60.0, "height": 10.0})
    model_id = uuid4()
    target = output_dir / str(model_id)
    target.mkdir(parents=True)
    files = CadFiles(stl=target / "model.stl", step=target / "model.step")
    for fmt in ("stl", "step"):
        copyfile(mock_dir / f"demo.{fmt}", getattr(files, fmt))
    return CadResult(model_id=model_id, spec=actual, files=files, cad_mode="mock",
                     warnings=["CAD 模拟模式：文件是固定的 100×60×10 mm 测试模型，不随请求尺寸变化。"])
