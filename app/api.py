from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import os
import time
import traceback
from uuid import uuid4

from pipeline_code.main import run_single_pipeline

router = APIRouter()


# ✅ DEFINE INPUT SCHEMA
class InputSchema(BaseModel):
    lat: float
    lon: float


@router.post("/analyze")
def analyze(data: InputSchema):
    if not -90 <= data.lat <= 90:
        raise HTTPException(status_code=422, detail="Latitude must be between -90 and 90.")

    if not -180 <= data.lon <= 180:
        raise HTTPException(status_code=422, detail="Longitude must be between -180 and 180.")

    sample_id = f"WEB_{int(time.time())}_{uuid4().hex[:8]}"

    output_dir = os.path.join("output_data", sample_id)
    os.makedirs(output_dir, exist_ok=True)

    try:
        result_json = run_single_pipeline(
            lat=data.lat,
            lon=data.lon,
            sample_id=sample_id,
            output_dir=output_dir
        )
    except Exception as exc:
        print(traceback.format_exc(), flush=True)
        raise HTTPException(status_code=500, detail=str(exc) or "Analysis failed.") from exc

    return {
        "sample_id": sample_id,
        "status": result_json["qc_status"],
        "confidence": result_json["confidence"],
        "area": result_json["pv_area_sqm_est"],
        "distance": result_json["euclidean_distance_m_est"],
        "has_solar": result_json["has_solar"],
        "inference_mode": result_json["image_metadata"]["inference_mode"],
        "original_image": f"/output/{sample_id}/{sample_id}.jpg",
        "overlay_image": f"/output/{sample_id}/{sample_id}_overlay.jpg",
        "json_url": f"/output/{sample_id}/result.json",
        "json_output": result_json
    }
