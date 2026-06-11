import gc

import torch
import cv2

from .utils import YOLO_CONF, MIN_PIXELS, IMG_SIZE


def run_inference(model, image_path):
    masks = []
    confs = []
    results = None

    try:
        with torch.inference_mode():
            results = model.predict(
                source=image_path,
                imgsz=IMG_SIZE,
                conf=YOLO_CONF,
                iou=0.5,
                device="cpu",
                verbose=False
            )

            if len(results) == 0:
                return masks, confs

            r = results[0]
            if r.masks is None or r.boxes is None:
                return masks, confs

            mask_data = r.masks.data.cpu().numpy()
            conf_data = r.boxes.conf.cpu().numpy()

            for raw_mask, conf in zip(mask_data, conf_data):
                mask = cv2.resize(
                    (raw_mask > 0.3).astype("uint8"),
                    (IMG_SIZE, IMG_SIZE),
                    interpolation=cv2.INTER_NEAREST
                )
                if mask.sum() < MIN_PIXELS:
                    continue

                masks.append(mask)
                confs.append(float(conf))
    finally:
        del results
        gc.collect()

    return masks, confs
