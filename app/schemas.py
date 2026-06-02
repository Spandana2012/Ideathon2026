from pydantic import BaseModel

class AnalyzeRequest(BaseModel):
    lat: float
    lon: float


class AnalyzeResponse(BaseModel):
    status: str
    confidence: float
    area: float
    original_image: str
    overlay_image: str
    json_url: str
