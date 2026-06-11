from pydantic import BaseModel


class AnalyzeRequest(BaseModel):
    lat: float
    lon: float


class AnalyzeResponse(BaseModel):
    job_id: str
    status: str


class JobStatusResponse(BaseModel):
    job_id: str
    sample_id: str
    status: str
    progress: int
    message: str
    error: str | None = None


class AnalysisResultResponse(BaseModel):
    sample_id: str
    status: str
    confidence: float
    area: float
    distance: float
    has_solar: bool
    inference_mode: str
    original_image: str
    overlay_image: str
    json_url: str
