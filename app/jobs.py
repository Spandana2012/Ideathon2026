import os
import traceback
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from threading import Lock
from typing import Any, Dict, Optional

from pipeline_code.main import run_single_pipeline


class JobState(str, Enum):
    PENDING = "PENDING"
    FETCHING_IMAGE = "FETCHING_IMAGE"
    RUNNING_YOLO = "RUNNING_YOLO"
    BUFFER_VERIFICATION = "BUFFER_VERIFICATION"
    IMAGE_ENHANCEMENT = "IMAGE_ENHANCEMENT"
    RUNNING_SAHI = "RUNNING_SAHI"
    GENERATING_OUTPUT = "GENERATING_OUTPUT"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


PROGRESS_BY_STATE = {
    JobState.PENDING: 0,
    JobState.FETCHING_IMAGE: 12,
    JobState.RUNNING_YOLO: 34,
    JobState.BUFFER_VERIFICATION: 54,
    JobState.IMAGE_ENHANCEMENT: 64,
    JobState.RUNNING_SAHI: 76,
    JobState.GENERATING_OUTPUT: 90,
    JobState.COMPLETED: 100,
    JobState.FAILED: 100,
}

MESSAGE_BY_STATE = {
    JobState.PENDING: "Waiting for the analysis worker...",
    JobState.FETCHING_IMAGE: "Fetching satellite imagery...",
    JobState.RUNNING_YOLO: "Running solar panel segmentation...",
    JobState.BUFFER_VERIFICATION: "Applying buffer verification...",
    JobState.IMAGE_ENHANCEMENT: "Enhancing image for fallback inference...",
    JobState.RUNNING_SAHI: "Running SAHI fallback...",
    JobState.GENERATING_OUTPUT: "Generating overlays and preparing report...",
    JobState.COMPLETED: "Analysis complete.",
    JobState.FAILED: "Analysis failed.",
}


@dataclass
class AnalysisJob:
    job_id: str
    lat: float
    lon: float
    sample_id: str
    output_dir: str
    state: JobState = JobState.PENDING
    progress: int = 0
    message: str = MESSAGE_BY_STATE[JobState.PENDING]
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    timings: Dict[str, float] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class JobStore:
    def __init__(self) -> None:
        self._jobs: Dict[str, AnalysisJob] = {}
        self._lock = Lock()

    def create(self, job: AnalysisJob) -> None:
        with self._lock:
            self._jobs[job.job_id] = job

    def get(self, job_id: str) -> Optional[AnalysisJob]:
        with self._lock:
            return self._jobs.get(job_id)

    def update(
        self,
        job_id: str,
        state: JobState,
        *,
        message: Optional[str] = None,
        progress: Optional[int] = None,
        result: Optional[Dict[str, Any]] = None,
        error: Optional[str] = None,
        timings: Optional[Dict[str, float]] = None,
    ) -> None:
        with self._lock:
            job = self._jobs[job_id]
            job.state = state
            job.progress = PROGRESS_BY_STATE[state] if progress is None else progress
            job.message = message or MESSAGE_BY_STATE[state]
            job.result = result if result is not None else job.result
            job.error = error
            job.timings = timings if timings is not None else job.timings
            job.updated_at = datetime.now(timezone.utc).isoformat()


jobs = JobStore()
executor = ThreadPoolExecutor(max_workers=int(os.getenv("ANALYSIS_WORKERS", "1")))


def submit_analysis_job(job: AnalysisJob) -> None:
    jobs.create(job)
    executor.submit(_run_job, job.job_id)


def _run_job(job_id: str) -> None:
    job = jobs.get(job_id)
    if job is None:
        return

    def progress_callback(state: str, message: Optional[str] = None) -> None:
        jobs.update(job_id, JobState(state), message=message)

    try:
        result_json = run_single_pipeline(
            lat=job.lat,
            lon=job.lon,
            sample_id=job.sample_id,
            output_dir=job.output_dir,
            progress_callback=progress_callback,
        )
        response = format_result(job.sample_id, result_json)
        jobs.update(
            job_id,
            JobState.COMPLETED,
            result=response,
            timings=result_json.get("timings", {}),
        )
    except Exception as exc:
        print(traceback.format_exc(), flush=True)
        jobs.update(job_id, JobState.FAILED, error=str(exc) or "Analysis failed.")


def format_result(sample_id: str, result_json: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "sample_id": sample_id,
        "status": result_json["qc_status"],
        "confidence": result_json["confidence"],
        "area": result_json["pv_area_sqm_est"],
        "distance": result_json["euclidean_distance_m_est"],
        "has_solar": result_json["has_solar"],
        "capacity_estimate_kw": result_json.get("capacity_estimate_kw"),
        "buffer_used": result_json.get("buffer_radius_sqft"),
        "verification_status": result_json.get("qc_status"),
        "inference_mode": result_json["image_metadata"]["inference_mode"],
        "original_image": f"/output/{sample_id}/{sample_id}.jpg",
        "overlay_image": f"/output/{sample_id}/{sample_id}_overlay.jpg",
        "json_url": f"/output/{sample_id}/result.json",
        "json_output": result_json,
        "timings": result_json.get("timings", {}),
    }
