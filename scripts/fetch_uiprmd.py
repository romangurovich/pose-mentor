#!/usr/bin/env python3
"""
Fetch the public UI-PRMD rehab-movement dataset (Kinect v2 skeletons only) into ./data/uiprmd.

UI-PRMD: Vakanski et al., "A Data Set of Human Body Movements for Physical Rehabilitation
Exercises", Data 2018, 3(1):2. License: Open Data Commons PDDL v1.0 (public domain).

The original host (webpages.uidaho.edu/ui-prmd) now 404s, so we pull the archived copies from
the Internet Archive's Wayback Machine. Only stdlib is used.

Usage:
    python3 scripts/fetch_uiprmd.py [--cache DIR]

--cache DIR  directory holding already-downloaded zips (segmented.zip / incorrect.zip); they are
             downloaded there if missing.
"""
from __future__ import annotations

import argparse
import os
import sys
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "uiprmd")

SOURCES = {
    "segmented.zip": (
        "correct",
        "https://web.archive.org/web/20250425223830id_/"
        "https://www.webpages.uidaho.edu/ui-prmd/Segmented%20Movements.zip",
    ),
    "incorrect.zip": (
        "incorrect",
        "https://web.archive.org/web/20250425224116id_/"
        "https://www.webpages.uidaho.edu/ui-prmd/Incorrect%20Segmented%20Movements.zip",
    ),
}


def download(url: str, dest: str) -> None:
    print(f"  downloading {url}\n    -> {dest}")
    req = urllib.request.Request(url, headers={"User-Agent": "pose-mentor-dataset-fetch/0.1"})
    tmp = dest + ".part"
    with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
        total = int(r.headers.get("content-length") or 0)
        got = 0
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            got += len(chunk)
            if total:
                print(f"\r    {got / 1e6:6.1f} / {total / 1e6:.1f} MB", end="", flush=True)
    print()
    os.replace(tmp, dest)


def extract_kinect(zpath: str, split: str) -> int:
    n = 0
    with zipfile.ZipFile(zpath) as z:
        for name in z.namelist():
            if "/Kinect/" not in name or not name.endswith(".txt"):
                continue
            kind = "positions" if "/Positions/" in name else "angles"
            base = os.path.basename(name)
            dest_dir = os.path.join(OUT, split, kind)
            os.makedirs(dest_dir, exist_ok=True)
            with z.open(name) as src, open(os.path.join(dest_dir, base), "wb") as dst:
                dst.write(src.read())
            n += 1
    return n


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=os.path.join(ROOT, "data", ".cache"))
    args = ap.parse_args()
    os.makedirs(args.cache, exist_ok=True)
    for fname, (split, url) in SOURCES.items():
        zpath = os.path.join(args.cache, fname)
        if not os.path.exists(zpath):
            download(url, zpath)
        n = extract_kinect(zpath, split)
        print(f"  {split}: extracted {n} Kinect files")
    print(f"done -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
