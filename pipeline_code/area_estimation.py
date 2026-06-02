import numpy as np
from math import sqrt
from .utils import CENTER, gsd

def area_and_distance(mask, buffer_mask, lat):
    # STRICT CLIP
    clipped = np.logical_and(mask == 1, buffer_mask == 1)

    pixel_count = clipped.sum()
    if pixel_count == 0:
        return 0.0, 0.0

    area = pixel_count * (gsd(lat) ** 2)

    ys, xs = np.where(clipped)
    cx, cy = xs.mean(), ys.mean()

    dx = cx - CENTER[0]
    dy = cy - CENTER[1]
    dist = sqrt(dx * dx + dy * dy) * gsd(lat)

    return round(area, 2), round(dist, 2)
