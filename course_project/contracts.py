"""Shared v1 contract. All dimensions are millimetres."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


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
