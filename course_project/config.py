"""Independent AI/CAD settings, loaded once for each application instance."""
from dataclasses import dataclass
import os
from pathlib import Path
from .contracts import Mode

ROOT = Path(__file__).parent


@dataclass(frozen=True)
class Settings:
    ai_mode: Mode = "mock"
    cad_mode: Mode = "mock"
    output_dir: Path = ROOT / "outputs"
    mock_dir: Path = ROOT / "mock"

    def __post_init__(self):
        if self.ai_mode not in {"mock", "real"} or self.cad_mode not in {"mock", "real"}:
            raise ValueError("AI_MODE and CAD_MODE must be mock or real")

    @classmethod
    def from_env(cls):
        return cls(ai_mode=os.getenv("AI_MODE", "mock"),
                   cad_mode=os.getenv("CAD_MODE", "mock"),
                   output_dir=Path(os.getenv("MODEL_OUTPUT_DIR", str(ROOT / "outputs"))).resolve())
