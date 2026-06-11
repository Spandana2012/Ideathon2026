import os
import time
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.jobs import AnalysisJob, jobs, submit_analysis_job

router = APIRouter()


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
    job_id = uuid4().hex
    output_dir = os.path.join("output_data", sample_id)
    os.makedirs(output_dir, exist_ok=True)

    submit_analysis_job(
        AnalysisJob(
            job_id=job_id,
            lat=data.lat,
            lon=data.lon,
            sample_id=sample_id,
            output_dir=output_dir,
        )
    )

    return {"job_id": job_id, "status": "processing"}


@router.get("/status/{job_id}")
def get_status(job_id: str):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")

    return {
        "job_id": job.job_id,
        "sample_id": job.sample_id,
        "status": job.state.value,
        "progress": job.progress,
        "message": job.message,
        "error": job.error,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
    }


@router.get("/result/{job_id}")
def get_result(job_id: str):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")

    if job.state.value == "FAILED":
        raise HTTPException(status_code=500, detail=job.error or "Analysis failed.")

    if job.result is None:
        raise HTTPException(status_code=202, detail="Analysis is still processing.")

    return job.result
