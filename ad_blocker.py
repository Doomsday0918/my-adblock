# -*- coding: utf-8 -*-
"""
ad_blocker.py — Windows 11 / Chrome 150+ 대응 시스템 전역 광고 차단기
WinPython (Python 3.10) 전용 · 표준 라이브러리만 사용 (pip 설치 불필요)

원리:
  광고/추적 서버 도메인 목록(StevenBlack, AdAway 등)을 내려받아
  Windows hosts 파일에 0.0.0.0으로 등록 → 광고 서버 접속 자체를 차단.
  Chrome을 포함한 모든 브라우저/앱에 적용됨 (Pi-hole과 같은 원리).

사용법 (관리자 권한 필요 — 자동으로 UAC 승격 시도):
  python ad_blocker.py            # 차단 설치/업데이트
  python ad_blocker.py off        # 차단 해제 (원상 복구)
  python ad_blocker.py status     # 현재 차단 상태 확인
"""

import ctypes
import os
import re
import subprocess
import sys
import urllib.request
from datetime import datetime

HOSTS_PATH = r"C:\Windows\System32\drivers\etc\hosts"
BACKUP_PATH = HOSTS_PATH + ".adblock_backup"

# 우리 스크립트가 추가한 구간을 표시하는 마커 (이 구간만 안전하게 추가/제거)
MARK_BEGIN = "# === AD-BLOCKER BEGIN (ad_blocker.py) ==="
MARK_END = "# === AD-BLOCKER END (ad_blocker.py) ==="

# 차단 목록 소스 (hosts 형식 또는 도메인 나열 형식 모두 지원)
BLOCKLIST_SOURCES = [
    # 광고 + 트래킹 + 멀웨어 통합 목록 (수십만 도메인, 가장 널리 쓰임)
    "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts",
    # 모바일/웹 광고 위주 목록
    "https://adaway.org/hosts.txt",
    # 광고 서버 목록 (yoyo.org)
    "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=0&mimetype=plaintext",
]

# 차단하면 안 되는 필수 도메인 (오차단 방지 화이트리스트)
WHITELIST = {
    "localhost",
    "localhost.localdomain",
    "local",
    "broadcasthost",
    "0.0.0.0",
    # 아래 도메인이 막히면 로그인/결제 등이 깨지는 경우가 있어 제외
    "www.googleadservices.com",  # 구글 검색 결과 링크 이동에 쓰이는 경우가 있음
}

DOMAIN_RE = re.compile(r"^[a-zA-Z0-9]([a-zA-Z0-9\-_]*\.)+[a-zA-Z]{2,}$")


def is_admin() -> bool:
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def relaunch_as_admin():
    """UAC 프롬프트를 띄워 관리자 권한으로 자신을 재실행."""
    params = " ".join(f'"{a}"' for a in sys.argv)
    ret = ctypes.windll.shell32.ShellExecuteW(
        None, "runas", sys.executable, params, None, 1
    )
    if ret <= 32:
        print("[!] 관리자 권한 승격이 거부되었습니다. 관리자 권한으로 다시 실행해 주세요.")
    sys.exit(0)


def download(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def parse_domains(text: str) -> set:
    """hosts 형식(0.0.0.0 domain) 또는 도메인 나열 형식에서 도메인만 추출."""
    domains = set()
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        parts = line.split()
        # "0.0.0.0 domain" / "127.0.0.1 domain" / "domain" 모두 처리
        candidate = parts[1] if len(parts) >= 2 else parts[0]
        candidate = candidate.lower().strip(".")
        if candidate in WHITELIST:
            continue
        if DOMAIN_RE.match(candidate):
            domains.add(candidate)
    return domains


def read_hosts() -> str:
    with open(HOSTS_PATH, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def write_hosts(content: str):
    with open(HOSTS_PATH, "w", encoding="utf-8", newline="\r\n") as f:
        f.write(content)


def strip_our_block(content: str) -> str:
    """hosts 내용에서 우리가 추가한 구간만 제거해서 반환."""
    pattern = re.compile(
        re.escape(MARK_BEGIN) + r".*?" + re.escape(MARK_END) + r"\r?\n?",
        re.DOTALL,
    )
    return pattern.sub("", content).rstrip() + "\n"


def flush_dns():
    subprocess.run(["ipconfig", "/flushdns"], capture_output=True)
    print("[+] DNS 캐시를 비웠습니다.")


def cmd_install():
    print("=" * 60)
    print(" 광고 차단 목록 설치/업데이트")
    print("=" * 60)

    # 1) 최초 실행 시 원본 백업
    original = read_hosts()
    if not os.path.exists(BACKUP_PATH):
        with open(BACKUP_PATH, "w", encoding="utf-8") as f:
            f.write(original)
        print(f"[+] 원본 hosts 백업 완료 → {BACKUP_PATH}")

    # 2) 차단 목록 다운로드
    all_domains = set()
    for url in BLOCKLIST_SOURCES:
        try:
            print(f"[*] 다운로드 중: {url[:70]}...")
            found = parse_domains(download(url))
            all_domains |= found
            print(f"    → {len(found):,}개 도메인")
        except Exception as e:
            print(f"    [!] 실패 (건너뜀): {e}")

    if not all_domains:
        print("[!] 어떤 목록도 받지 못했습니다. 인터넷 연결을 확인하세요.")
        sys.exit(1)

    # 3) 기존 우리 구간 제거 후 새 구간 삽입
    base = strip_our_block(original)
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    lines = [MARK_BEGIN, f"# 업데이트: {now} / 도메인 {len(all_domains):,}개"]
    lines += [f"0.0.0.0 {d}" for d in sorted(all_domains)]
    lines.append(MARK_END)
    write_hosts(base + "\n" + "\n".join(lines) + "\n")

    print(f"[+] 총 {len(all_domains):,}개 광고/추적 도메인 차단 적용 완료.")
    flush_dns()
    print()
    print("완료! Chrome을 재시작하면 적용됩니다.")
    print("※ Chrome 설정 > 개인 정보 보호 및 보안 > 보안 > '보안 DNS 사용'이")
    print("  켜져 있으면 차단이 우회될 수 있으니 'OS 기본값'으로 두세요.")


def cmd_off():
    content = read_hosts()
    if MARK_BEGIN not in content:
        print("[*] 적용된 차단 목록이 없습니다.")
        return
    write_hosts(strip_our_block(content))
    flush_dns()
    print("[+] 차단 해제 완료. hosts 파일이 원래 상태로 복구되었습니다.")


def cmd_status():
    content = read_hosts()
    if MARK_BEGIN in content:
        count = len(re.findall(r"^0\.0\.0\.0 ", content, re.MULTILINE))
        m = re.search(r"# 업데이트: (.+)", content)
        print(f"[상태] 차단 활성화됨 — {count:,}개 도메인 차단 중")
        if m:
            print(f"[상태] 마지막 업데이트: {m.group(1)}")
    else:
        print("[상태] 차단 비활성화 상태입니다. 'python ad_blocker.py'로 설치하세요.")


def main():
    cmd = sys.argv[1].lower() if len(sys.argv) > 1 else "install"

    if cmd == "status":
        cmd_status()  # 상태 확인은 관리자 권한 불필요
        return

    if not is_admin():
        print("[*] hosts 파일 수정에 관리자 권한이 필요합니다. UAC 승격을 요청합니다...")
        relaunch_as_admin()

    if cmd in ("install", "update", "on"):
        cmd_install()
    elif cmd in ("off", "restore", "uninstall"):
        cmd_off()
    else:
        print(__doc__)

    # UAC로 새 창에서 실행됐을 때 결과를 볼 수 있게 대기
    if os.environ.get("PROMPT") is None:
        input("\n엔터를 누르면 창이 닫힙니다...")


if __name__ == "__main__":
    main()
