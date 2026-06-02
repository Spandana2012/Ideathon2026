import io

import requests
from PIL import Image
from .utils import ZOOM_LEVEL, SCALE, IMG_SIZE

def fetch_image(sample_id, lat, lon, api_key, out_path):
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
    r = requests.get(url, params=params, timeout=15)
    if not r.ok:
        raise RuntimeError(f"Google Static Maps request failed with status {r.status_code}: {r.text[:200]}")

    try:
        img = Image.open(io.BytesIO(r.content)).convert("RGB")
    except Exception as exc:
        raise RuntimeError("Google Static Maps did not return a valid image.") from exc

    img.save(out_path, "JPEG", quality=95)
