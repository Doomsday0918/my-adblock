# -*- coding: utf-8 -*-
"""
make_rules.py — 광고 도메인 목록을 내려받아 Chrome 확장용 rules.json 생성

ad_blocker.py의 다운로드/파싱 기능을 재사용한다.
실행하면 my-adblock/rules.json 이 새로 만들어진다 (관리자 권한 불필요).

  python make_rules.py
"""

import json
import os

from ad_blocker import BLOCKLIST_SOURCES, download, parse_domains

# 규칙 1개에 도메인 1,000개씩 묶는다.
# declarativeNetRequest는 규칙 1개의 requestDomains에 여러 도메인을 담을 수 있어서
# 8만 개 도메인도 규칙 수십 개로 처리 가능 (Chrome 보장 한도는 정적 규칙 30,000개)
CHUNK_SIZE = 1000

RESOURCE_TYPES = [
    "main_frame", "sub_frame", "stylesheet", "script", "image", "font",
    "object", "xmlhttprequest", "ping", "media", "websocket", "other",
]

OUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "my-adblock", "rules.json")


def main():
    domains = set()
    for url in BLOCKLIST_SOURCES:
        try:
            print(f"[*] 다운로드 중: {url[:70]}...")
            found = parse_domains(download(url))
            domains |= found
            print(f"    → {len(found):,}개 도메인")
        except Exception as e:
            print(f"    [!] 실패 (건너뜀): {e}")

    if not domains:
        print("[!] 목록을 받지 못했습니다. 인터넷 연결을 확인하세요.")
        return

    sorted_domains = sorted(domains)
    rules = []
    for i in range(0, len(sorted_domains), CHUNK_SIZE):
        chunk = sorted_domains[i:i + CHUNK_SIZE]
        rules.append({
            "id": len(rules) + 1,          # 규칙 id는 1 이상의 고유 정수
            "priority": 1,
            "action": {"type": "block"},
            "condition": {
                "requestDomains": chunk,   # 이 도메인(및 하위 도메인)으로 가는 요청 차단
                "resourceTypes": RESOURCE_TYPES,
            },
        })

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(rules, f, ensure_ascii=False, indent=1)

    size_mb = os.path.getsize(OUT_PATH) / 1024 / 1024
    print(f"[+] 완료: 도메인 {len(domains):,}개 → 규칙 {len(rules)}개")
    print(f"[+] 저장 위치: {OUT_PATH} ({size_mb:.1f} MB)")
    print("    Chrome 확장을 이미 로드해 뒀다면 chrome://extensions 에서 새로고침 하세요.")


if __name__ == "__main__":
    main()
