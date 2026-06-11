import hashlib
import io
import os
import shutil

import requests
from PIL import Image

from .utils import IMG_SIZE, SCALE, ZOOM_LEVEL


def fetch_image(sample_id, lat, lon, api_key, out_path):
    cache_dir = os.path.join("output_data", "image_cache")
    os.makedirs(cache_dir, exist_ok=True)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    cache_key = hashlib.sha256(
        f"{round(float(lat), 6)}:{round(float(lon), 6)}:{ZOOM_LEVEL}:{SCALE}:{IMG_SIZE}".encode("utf-8")
    ).hexdigest()[:24]
    cached_path = os.path.join(cache_dir, f"{cache_key}.jpg")

    if os.path.exists(cached_path):
        shutil.copyfile(cached_path, out_path)
        print(f"[CACHE] sample_id={sample_id} fetch_image=hit", flush=True)
        return

    if not api_key:
        raise RuntimeError("GOOGLE_API_KEY is not configured.")

    url = "https://maps.googleapis.com/maps/api/staticmap"
    params = {
        "center": f"{lat},{lon}",
        "zoom": ZOOM_LEVEL,
        "scale": SCALE,
        "size": f"{IMG_SIZE}x{IMG_SIZE}",
        "maptype": "satellite",
        "key": api_key,
    }
    response = requests.get(url, params=params, timeout=15)
    if not response.ok:
        raise RuntimeError(
            f"Google Static Maps request failed with status {response.status_code}: {response.text[:200]}"
        )

    try:
        img = Image.open(io.BytesIO(response.content)).convert("RGB")
    except Exception as exc:
        raise RuntimeError("Google Static Maps did not return a valid image.") from exc

    img.save(out_path, "JPEG", quality=95)
    shutil.copyfile(out_path, cached_path)
    print(f"[CACHE] sample_id={sample_id} fetch_image=miss", flush=True)
