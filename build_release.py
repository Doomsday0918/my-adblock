# -*- coding: utf-8 -*-
"""
build_release.py — 배포용 ZIP 패키지 생성

my-adblock 폴더를 사용자가 내려받아 바로 설치할 수 있는
Simple-Ad-Blocker-vX.Y.Z.zip 파일로 묶는다.
rules.json이 없으면 먼저 make_rules.py를 돌리라고 안내한다.

  python build_release.py
"""

import json
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "my-adblock")
DIST = os.path.join(HERE, "dist")

# 배포에 포함할 파일 (그 외 파일은 넣지 않음)
INCLUDE = [
    "manifest.json",
    "rules.json",
    "yt_allow.json",
    "hide_ads.css",
    "youtube_ads.css",
    "youtube_skip.js",
    "README.md",
    "LICENSE",
]


def main():
    manifest_path = os.path.join(SRC, "manifest.json")
    with open(manifest_path, encoding="utf-8") as f:
        version = json.load(f)["version"]

    missing = [n for n in INCLUDE if not os.path.exists(os.path.join(SRC, n))]
    if "rules.json" in missing:
        print("[!] rules.json이 없습니다. 먼저 아래를 실행하세요:")
        print("    python make_rules.py")
        return
    if missing:
        print(f"[!] 빠진 파일: {missing}")
        return

    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, f"Simple-Ad-Blocker-v{version}.zip")

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name in INCLUDE:
            # 압축 파일 안에서도 폴더 이름을 유지 (풀면 폴더가 통째로 나옴)
            z.write(os.path.join(SRC, name), arcname=f"Simple-Ad-Blocker/{name}")

    size_mb = os.path.getsize(out) / 1024 / 1024
    print(f"[+] 배포 패키지 생성 완료: {out} ({size_mb:.1f} MB)")
    print("    이 ZIP 파일을 GitHub Releases 등에 올려 공유하면 됩니다.")


if __name__ == "__main__":
    main()
