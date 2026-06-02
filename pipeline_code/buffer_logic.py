import cv2
import numpy as np
from math import sqrt, pi
from .utils import IMG_SIZE, CENTER, gsd

AREA_1200_SQFT = 1200
AREA_2400_SQFT = 2400

BUFFER_CACHE = {}

def create_buffer(radius_px):
    key = int(radius_px)
    if key in BUFFER_CACHE:
        return BUFFER_CACHE[key]

    mask = np.zeros((IMG_SIZE, IMG_SIZE), dtype="uint8")
    cv2.circle(mask, CENTER, int(radius_px), 1, -1)
    BUFFER_CACHE[key] = mask
    return mask


def _best_overlap_mask(masks, buffer_mask):
    best_mask = None
    max_overlap = 0

    for m in masks:
        overlap = np.logical_and(m, buffer_mask).sum()
        if overlap > max_overlap:
            max_overlap = overlap
            best_mask = m

    if best_mask is None or best_mask.sum() == 0:
        return None

    # Enforce minimum 50% overlap
    if max_overlap / best_mask.sum() < 0.5:
        return None

    return best_mask


def select_masks(masks, lat):
    r1200_px = sqrt((AREA_1200_SQFT * 0.092903) / pi) / gsd(lat)
    r2400_px = sqrt((AREA_2400_SQFT * 0.092903) / pi) / gsd(lat)

    buffer_1200 = create_buffer(r1200_px)
    buffer_2400 = create_buffer(r2400_px)

    if not masks:
        return None, None, 0, r1200_px, r2400_px

    # Try smaller buffer first
    best_mask = _best_overlap_mask(masks, buffer_1200)
    if best_mask is not None:
        return buffer_1200, best_mask, AREA_1200_SQFT, r1200_px, r2400_px

    # Fallback to larger buffer
    best_mask = _best_overlap_mask(masks, buffer_2400)
    if best_mask is not None:
        return buffer_2400, best_mask, AREA_2400_SQFT, r1200_px, r2400_px

    return None, None, 0, r1200_px, r2400_px
