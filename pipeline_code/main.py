import os
import cv2
import gc
import json
import numpy as np
import torch
from ultralytics import YOLO
from dotenv import load_dotenv

from .utils import (
    MODEL_PATH,
    INPUT_FILE,
    OUTPUT_DIR,
    ZOOM_LEVEL,
    YOLO_CONF,
    CENTER,
    ENABLE_SAHI
)

from .image_fetcher import fetch_image
from .inference import run_inference
from .buffer_logic import select_masks
from .area_estimation import area_and_distance
from .overlay import draw_overlay
from .json_writer import write_json
from .image_enhancer import enhance_image

# -------------------------------------------------
# ENV + MODEL LOAD (ONCE)
# -------------------------------------------------
load_dotenv()
API_KEY = os.getenv("GOOGLE_API_KEY")

torch.set_num_threads(int(os.getenv("TORCH_NUM_THREADS", "1")))
torch.set_num_interop_threads(int(os.getenv("TORCH_NUM_INTEROP_THREADS", "1")))
cv2.setNumThreads(0)

model = YOLO(MODEL_PATH)

# =================================================
# 🔹 SINGLE LOCATION PIPELINE (FOR WEBSITE)
# =================================================
def run_single_pipeline(lat, lon, sample_id, output_dir):
    img_path = os.path.join(output_dir, f"{sample_id}.jpg")

    fetch_image(sample_id, lat, lon, API_KEY, img_path)

    masks, confs = run_inference(model, img_path)
    inference_mode = "PRIMARY"

    buffer_mask, best_mask, buffer_sqft, r1200, r2400 = select_masks(masks, lat)
    gc.collect()

    # Enhancement fallback
    if best_mask is None:
        img = cv2.imread(img_path)
        enhanced = enhance_image(img)
        enhanced_path = img_path.replace(".jpg", "_enhanced.jpg")
        cv2.imwrite(enhanced_path, enhanced)

        masks, confs = run_inference(model, enhanced_path)
        inference_mode = "ENHANCED"
        buffer_mask, best_mask, buffer_sqft, r1200, r2400 = select_masks(masks, lat)
        del img, enhanced
        gc.collect()

    # SAHI can be memory-heavy on small Render instances, so keep it opt-in.
    if best_mask is None and ENABLE_SAHI:
        from .sahi_inference import run_sahi

        masks, confs = run_sahi(MODEL_PATH, img_path, YOLO_CONF + 0.05)
        inference_mode = "SAHI"
        buffer_mask, best_mask, buffer_sqft, r1200, r2400 = select_masks(masks, lat)
        gc.collect()

    total_area, dist = 0.0, 0.0
    best_conf = max(confs) if confs else 0.0

    green, red = [], []

    if best_mask is not None:
        total_area, dist = area_and_distance(best_mask, buffer_mask, lat)

        green = [best_mask]
    else:
        red = masks

    img = cv2.imread(img_path)
    draw_overlay(img, green, red, r1200, r2400)
    cv2.imwrite(os.path.join(output_dir, f"{sample_id}_overlay.jpg"), img)
    del img
    gc.collect()

    json_data = {
        "sample_id": sample_id,
        "lat": lat,
        "lon": lon,
        "has_solar": best_mask is not None,
        "confidence": round(best_conf, 2),
        "buffer_radius_sqft": buffer_sqft,
        "pv_area_sqm_est": round(total_area, 2),
        "euclidean_distance_m_est": round(dist, 2),
        "qc_status": "VERIFIABLE" if best_mask is not None else "NOT_VERIFIABLE",
        "bbox_or_mask": "mask",
        "image_metadata": {
            "source": "Google Static Maps",
            "zoom": ZOOM_LEVEL,
            "inference_mode": inference_mode
        }
    }


    json_path = os.path.join(output_dir, "result.json")
    write_json(json_path, json_data)
    return json_data

# =================================================
# 🔹 BATCH PIPELINE (EXCEL MODE – ORIGINAL BEHAVIOR)
# =================================================
def run_batch_pipeline():
    """
    Runs original Excel-based batch inference.
    """
    import pandas as pd

    df = pd.read_excel(INPUT_FILE)

    IMG_DIR = os.path.join(OUTPUT_DIR, "artefacts", "test")
    JSON_DIR = os.path.join(OUTPUT_DIR, "prediction_files", "test")

    os.makedirs(IMG_DIR, exist_ok=True)
    os.makedirs(JSON_DIR, exist_ok=True)
    print("[DEBUG] OUTPUT_DIR:", OUTPUT_DIR)

    for _, row in df.iterrows():
        sid = str(row["sample_id"]).strip()
        lat = float(row["latitude"])
        lon = float(row["longitude"])

        print(f"\n[INFO] Processing sample_id: {sid}")

        out_dir = os.path.join(IMG_DIR, sid)
        os.makedirs(out_dir, exist_ok=True)

        result_json = run_single_pipeline(
            lat=lat,
            lon=lon,
            sample_id=sid,
            output_dir=out_dir
        )
        json_out = os.path.join(JSON_DIR, f"{sid}.json")
        write_json(json_out, result_json)

    print("\n✅ Pipeline completed successfully")

# =================================================
# 🔒 SAFE ENTRY POINT
# =================================================
if __name__ == "__main__":
    run_batch_pipeline()
