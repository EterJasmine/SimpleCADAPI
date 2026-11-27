"""Shared v1 contract. All dimensions are millimetres."""
from typing import Literal
from pathlib import Path
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Parameters(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, strict=True)
    length: float = Field(gt=0, le=10000)
    width: float = Field(gt=0, le=10000)
    height: float = Field(gt=0, le=10000)


class ModelSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal["1.0"] = "1.0"
    model_type: Literal["box"]
    unit: Literal["mm"] = "mm"
    parameters: Parameters


class GenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    prompt: str = Field(min_length=1, max_length=2000)


Mode = Literal["mock", "real"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CadFiles(Contract):
    stl: Path
    step: Path


class CadResult(Contract):
    """Internal artifact contract: no HTTP addresses."""
    model_id: UUID
    spec: ModelSpec
    files: CadFiles
    cad_mode: Mode
    warnings: list[str] = Field(default_factory=list)


class ModelFiles(Contract):
    stl: str = Field(pattern=r"^/api/v1/files/[0-9a-f-]{36}/stl$")
    step: str = Field(pattern=r"^/api/v1/files/[0-9a-f-]{36}/step$")


class GenerateResponse(ModelSpec):
    success: Literal[True] = True
    model_id: UUID
    files: ModelFiles
    warnings: list[str] = Field(default_factory=list)
    error: None = None
    ai_mode: Mode | None = None
    cad_mode: Mode
    requested_spec: ModelSpec | None = None

    @model_validator(mode="after")
    def matching_downloads(self):
        for fmt in ("stl", "step"):
            if getattr(self.files, fmt) != f"/api/v1/files/{self.model_id}/{fmt}":
                raise ValueError("Download URL must match model_id")
        return self


class ErrorInfo(Contract):
    code: str
    message: str


class ErrorResponse(Contract):
    success: Literal[False] = False
    model_id: None = None
    files: None = None
    error: ErrorInfo
