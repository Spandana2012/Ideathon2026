import os
import math
from dotenv import load_dotenv

# -------------------------------------------------
# LOAD ENV
# -------------------------------------------------
load_dotenv()

# -------------------------------------------------
# PROJECT ROOT (IMPORTANT)
# utils.py → pipeline_code → PROJECT ROOT
# -------------------------------------------------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# -------------------------------------------------
# PATHS (ALL ABSOLUTE, PORTABLE)
# -------------------------------------------------
MODEL_PATH = os.getenv(
    "MODEL_PATH",
    os.path.join(BASE_DIR, "trained_model", "weights.pt")
)

INPUT_FILE = os.getenv(
    "INPUT_FILE",
    os.path.join(BASE_DIR, "input_data", "input.xlsx")
)

OUTPUT_DIR = os.getenv(
    "OUTPUT_DIR",
    os.path.join(BASE_DIR, "output_data")
)

# -------------------------------------------------
# IMAGE / INFERENCE CONSTANTS
# -------------------------------------------------
ZOOM_LEVEL = int(os.getenv("ZOOM_LEVEL", "20"))

SCALE = int(os.getenv("MAP_SCALE", "1"))
IMG_SIZE = int(os.getenv("IMG_SIZE", "640"))
CENTER = (IMG_SIZE // 2, IMG_SIZE // 2)
ENABLE_SAHI = os.getenv("ENABLE_SAHI", "false").lower() == "true"

YOLO_CONF = 0.25
MIN_PIXELS = 100

AREA_1200_SQFT = 1200
AREA_2400_SQFT = 2400

# -------------------------------------------------
# GSD FUNCTION
# -------------------------------------------------
def gsd(lat_deg):
    val = (156543.03392 * math.cos(math.radians(lat_deg)) / (2 ** ZOOM_LEVEL)) / SCALE
    return val
