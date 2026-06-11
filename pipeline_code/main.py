import gc
import os
import time

import cv2
import torch
from dotenv import load_dotenv
from ultralytics import YOLO

from .area_estimation import area_and_distance
from .buffer_logic import select_masks
from .image_enhancer import enhance_image
from .image_fetcher import fetch_image
from .inference import run_inference
from .json_writer import write_json
from .overlay import draw_overlay
from .utils import ENABLE_SAHI, INPUT_FILE, MODEL_PATH, OUTPUT_DIR, YOLO_CONF, ZOOM_LEVEL


load_dotenv()
API_KEY = os.getenv("GOOGLE_API_KEY")

torch.set_num_threads(int(os.getenv("TORCH_NUM_THREADS", "1")))
torch.set_num_interop_threads(int(os.getenv("TORCH_NUM_INTEROP_THREADS", "1")))
cv2.setNumThreads(0)

# Load YOLO once per process. Render cold starts pay this cost once, not per request.
model = YOLO(MODEL_PATH)


def run_single_pipeline(lat, lon, sample_id, output_dir, progress_callback=None):
    timings = {}

    def set_stage(stage, message=None):
        if progress_callback:
            progress_callback(stage, message)

    def timed(stage_name, fn):
        start = time.perf_counter()
        try:
            return fn()
        finally:
            duration = round(time.perf_counter() - start, 3)
            timings[stage_name] = duration
            print(f"[TIMER] sample_id={sample_id} stage={stage_name} duration_s={duration}", flush=True)

    img_path = os.path.join(output_dir, f"{sample_id}.jpg")

    set_stage("FETCHING_IMAGE")
    timed("fetch_image", lambda: fetch_image(sample_id, lat, lon, API_KEY, img_path))

    set_stage("RUNNING_YOLO")
    masks, confs = timed("run_inference", lambda: run_inference(model, img_path))
    inference_mode = "PRIMARY"

    set_stage("BUFFER_VERIFICATION")
    buffer_mask, best_mask, buffer_sqft, r1200, r2400 = timed(
        "buffer_verification",
        lambda: select_masks(masks, lat),
    )
    gc.collect()

    if best_mask is None:
        set_stage("IMAGE_ENHANCEMENT")

        def run_enhancement():
            img = cv2.imread(img_path)
            enhanced = enhance_image(img)
            enhanced_path = img_path.replace(".jpg", "_enhanced.jpg")
            cv2.imwrite(enhanced_path, enhanced)
            del img, enhanced
            return enhanced_path

        enhanced_path = timed("image_enhancement", run_enhancement)

        set_stage("RUNNING_YOLO", "Running solar panel segmentation on enhanced imagery...")
        masks, confs = timed("run_enhanced_inference", lambda: run_inference(model, enhanced_path))
        inference_mode = "ENHANCED"

        set_stage("BUFFER_VERIFICATION")
        buffer_mask, best_mask, buffer_sqft, r1200, r2400 = timed(
            "enhanced_buffer_verification",
            lambda: select_masks(masks, lat),
        )
        gc.collect()

    if best_mask is None and ENABLE_SAHI:
        set_stage("RUNNING_SAHI")
        from .sahi_inference import run_sahi

        masks, confs = timed("run_sahi", lambda: run_sahi(MODEL_PATH, img_path, YOLO_CONF + 0.05))
        inference_mode = "SAHI"

        set_stage("BUFFER_VERIFICATION")
        buffer_mask, best_mask, buffer_sqft, r1200, r2400 = timed(
            "sahi_buffer_verification",
            lambda: select_masks(masks, lat),
        )
        gc.collect()

    set_stage("GENERATING_OUTPUT")
    total_area, dist = 0.0, 0.0
    best_conf = max(confs) if confs else 0.0

    green, red = [], []
    if best_mask is not None:
        total_area, dist = timed("area_estimation", lambda: area_and_distance(best_mask, buffer_mask, lat))
        green = [best_mask]
    else:
        red = masks

    def generate_overlay():
        img = cv2.imread(img_path)
        draw_overlay(img, green, red, r1200, r2400)
        cv2.imwrite(os.path.join(output_dir, f"{sample_id}_overlay.jpg"), img)
        del img

    timed("overlay_generation", generate_overlay)
    gc.collect()

    capacity_kw = round(total_area * 0.18, 2) if total_area else 0.0
    json_data = {
        "sample_id": sample_id,
        "lat": lat,
        "lon": lon,
        "has_solar": best_mask is not None,
        "confidence": round(best_conf, 2),
        "buffer_radius_sqft": buffer_sqft,
        "pv_area_sqm_est": round(total_area, 2),
        "capacity_estimate_kw": capacity_kw,
        "euclidean_distance_m_est": round(dist, 2),
        "qc_status": "VERIFIABLE" if best_mask is not None else "NOT_VERIFIABLE",
        "bbox_or_mask": "mask",
        "image_metadata": {
            "source": "Google Static Maps",
            "zoom": ZOOM_LEVEL,
            "inference_mode": inference_mode,
        },
        "timings": timings,
    }

    json_path = os.path.join(output_dir, "result.json")
    timed("json_generation", lambda: write_json(json_path, json_data))
    return json_data


def run_batch_pipeline():
    import pandas as pd

    df = pd.read_excel(INPUT_FILE)

    img_dir = os.path.join(OUTPUT_DIR, "artefacts", "test")
    json_dir = os.path.join(OUTPUT_DIR, "prediction_files", "test")

    os.makedirs(img_dir, exist_ok=True)
    os.makedirs(json_dir, exist_ok=True)
    print("[DEBUG] OUTPUT_DIR:", OUTPUT_DIR)

    for _, row in df.iterrows():
        sid = str(row["sample_id"]).strip()
        lat = float(row["latitude"])
        lon = float(row["longitude"])

        print(f"\n[INFO] Processing sample_id: {sid}")

        out_dir = os.path.join(img_dir, sid)
        os.makedirs(out_dir, exist_ok=True)

        result_json = run_single_pipeline(
            lat=lat,
            lon=lon,
            sample_id=sid,
            output_dir=out_dir,
        )
        json_out = os.path.join(json_dir, f"{sid}.json")
        write_json(json_out, result_json)

    print("\nPipeline completed successfully")


if __name__ == "__main__":
    run_batch_pipeline()
