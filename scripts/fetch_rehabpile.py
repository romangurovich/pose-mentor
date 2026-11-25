#!/usr/bin/env python3
"""
Fetch the parts of Rehab-Pile (DeepRehabPile, Ismail-Fawaz et al., FG 2026 — arXiv:2507.21018) that inform
exercises UI-PRMD doesn't cover, and convert them to compact JSON for the TypeScript calibration scripts.

    python3 scripts/fetch_rehabpile.py          # → data/rehabpile/<dataset>.json

Rehab-Pile redistributes several public rehab-skeleton datasets as NumPy folds. Fold 0's train + test
splits together hold every sample, so only fold 0 is downloaded.

Safety: skeleton arrays are plain float64 and are read with allow_pickle=False. Labels and subject ids are
stored as pickled object arrays; they are read with a restricted unpickler that only permits NumPy's array
reconstruction classes (no arbitrary code). Requires numpy.
"""
from __future__ import annotations

import io
import json
import os
import pickle
import sys
import urllib.request

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "rehabpile")
BASE = "https://maxime-devanne.com/datasets/RehabPile/"

# dataset path → description. (The Elderly Home Exercise set was tried and dropped: its score scale is undocumented
# and its best-scored waist bends moved the least, so the labels couldn't be interpreted.)
DATASETS = {
    # IntelliRehabDS (Miron et al. 2021): Kinect v2, 25 joints; patients + healthy, standing or seated; 1 = correct, 2 = incorrect
    "IRDS_clf_bn/SFL": "Shoulder flexion, left",
    "IRDS_clf_bn/SFR": "Shoulder flexion, right",
    "IRDS_clf_bn/SAL": "Shoulder abduction, left",
    "IRDS_clf_bn/SAR": "Shoulder abduction, right",
    "IRDS_clf_bn/STL": "Side tap, left",
    "IRDS_clf_bn/STR": "Side tap, right",
    # KIMORE (Capecci et al. 2019): Kinect v2 reduced to 18 joints; clinical quality score 0–100 (healthy + patients)
    "KIMORE_reg/LT": "Lateral tilt of the trunk, arms overhead",
    "KIMORE_reg/Sq": "Squat",
    # KERAAL (Nguyen et al. 2024): 11 upper-body joints (+ orientation); 4 classes = correct + 3 error types
    "KERAAL_clf_mc/ELK": "Lateral bending of the trunk",
}

ALLOWED = {
    ("numpy.core.multiarray", "_reconstruct"),
    ("numpy._core.multiarray", "_reconstruct"),
    ("numpy.core.multiarray", "scalar"),
    ("numpy._core.multiarray", "scalar"),
    ("numpy", "ndarray"),
    ("numpy", "dtype"),
}


class SafeUnpickler(pickle.Unpickler):
    def find_class(self, module: str, name: str):
        if (module, name) in ALLOWED:
            return getattr(__import__(module, fromlist=[name]), name)
        raise pickle.UnpicklingError(f"refusing to load {module}.{name}")


def load_npy(raw: bytes) -> np.ndarray:
    f = io.BytesIO(raw)
    version = np.lib.format.read_magic(f)
    shape, _, dtype = (np.lib.format.read_array_header_1_0 if version == (1, 0) else np.lib.format.read_array_header_2_0)(f)
    if dtype.hasobject:
        return np.asarray(SafeUnpickler(f).load(), dtype=object).reshape(shape)
    return np.load(io.BytesIO(raw), allow_pickle=False)


def label_of(v):
    """numeric score / class id where possible, else the class name (KERAAL uses letters)"""
    v = np.asarray(v).reshape(-1)[0]
    try:
        return float(v)
    except (TypeError, ValueError):
        return str(v)


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "pose-mentor-calibration"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def listing(url: str) -> list[str]:
    html = get(url).decode("utf-8", "replace")
    return [h for h in (part.split('"')[0] for part in html.split('href="')[1:]) if h.endswith(".npy")]


def fetch(path: str, desc: str) -> None:
    name = path.replace("/", "_")
    dest = os.path.join(OUT, name + ".json")
    if os.path.exists(dest):
        print(f"{name}: already converted")
        return
    info_txt = get(BASE + path + "/info.json").decode()
    info = json.loads(info_txt.replace(",}", "}").replace(",]", "]"))
    files = listing(BASE + path + "/fold0/")
    arr = {fn[:-4]: load_npy(get(BASE + path + "/fold0/" + fn)) for fn in files}
    n_joints = info["n_joints"]
    dim = info.get("n_dim", info.get("dim"))
    length = info["length_TS"]

    samples = []
    for split in ("train", "test"):
        x = arr[f"x_{split}_fold0"]
        y = arr[f"y_{split}_fold0"]
        s = arr.get(f"s_{split}_fold0", arr.get(f"{split}_subjects_fold0"))
        x = np.asarray(x, dtype=float).reshape(len(x), n_joints, dim, length)
        for i in range(len(x)):
            pos = x[i, :, :3, :].transpose(2, 0, 1)  # frames × joints × xyz
            # drop zero / repeated padding at the end
            keep = len(pos)
            while keep > 2 and (np.allclose(pos[keep - 1], 0) or np.allclose(pos[keep - 1], pos[keep - 2])):
                keep -= 1
            samples.append({
                "subject": str(s[i]) if s is not None and i < len(s) else None,
                "label": label_of(y[i]),
                "frames": np.round(pos[:keep], 4).tolist(),
            })
    os.makedirs(OUT, exist_ok=True)
    with open(dest, "w") as f:
        json.dump({"dataset": path, "description": desc, "joints": n_joints, "kinematicTree": info.get("kinematic_tree"), "samples": samples}, f)
    labels = sorted({s["label"] for s in samples}, key=str)
    print(f"{name}: {len(samples)} samples, labels {labels[:6]}{'…' if len(labels) > 6 else ''}")


def main() -> int:
    for path, desc in DATASETS.items():
        try:
            fetch(path, desc)
        except Exception as e:  # keep going; report at the end
            print(f"{path}: FAILED — {e}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
