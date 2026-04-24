#!/usr/bin/env python3
"""
HTB Writeup Scraper
-------------------
Downloads and converts official HackTheBox machine writeups (PDF → Markdown).
Fetches the machine avatar and saves it alongside the Markdown for use in viewers.

TOKEN SETUP:
    Store your HTB App Token in ~/.htb_client/config.json:
        {"api_token": "<your_app_token>"}

USAGE EXAMPLES:

  Single machine:
      python3 htb_writeup_scraper.py -m Cap

  Multiple machines (comma-separated):
      python3 htb_writeup_scraper.py -m "Cap,Lame,Era"

  From a file (one machine name per line, # = comment):
      python3 htb_writeup_scraper.py -m machines.txt

  Force re-download even if already done:
      python3 htb_writeup_scraper.py -m Cap --force

  Download ALL retired machines:
      python3 htb_writeup_scraper.py

  Download a specific ID range (skip auto-discovery):
      python3 htb_writeup_scraper.py --range 1-766     # IDs 1 to 766
      python3 htb_writeup_scraper.py --range 766        # IDs 1 to 766 
      python3 htb_writeup_scraper.py --range 100-200   # IDs 100 to 200 only

  Custom output directory:
      python3 htb_writeup_scraper.py -m Cap -o /path/to/HTB_Writeups

  Adjust delay between downloads (default: 5s, minimum recommended: 4s):
      python3 htb_writeup_scraper.py --delay 4
"""
import os
import sys
import json
import time
import urllib.request
import urllib.error
import urllib.parse
import ssl
import subprocess
import argparse
from pathlib import Path
from datetime import datetime


# ─────────────────────────────────────────────
#  Logging utilities
# ─────────────────────────────────────────────

class Tee:
    """Mirrors stdout to a log file."""
    def __init__(self, filename):
        self.terminal = sys.stdout
        self.log = open(filename, "w", encoding="utf-8")

    def write(self, message):
        self.terminal.write(message)
        self.log.write(message)

    def flush(self):
        self.terminal.flush()
        self.log.flush()


# ─────────────────────────────────────────────
#  Auth / context
# ─────────────────────────────────────────────

def get_htb_token():
    config_path = Path.home() / ".htb_client" / "config.json"
    if not config_path.exists():
        print("[-] HTB token not found at ~/.htb_client/config.json")
        print('    Create it: {"api_token": "<your_app_token>"}')
        return None
    with open(config_path) as f:
        return json.load(f).get("api_token")


def build_headers(token):
    return {
        "Authorization": f"Bearer {token}",
        "User-Agent": "HTBWriteupScraper/1.0",
        "Accept": "*/*",
    }


def make_ctx():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


# ─────────────────────────────────────────────
#  API helpers
# ─────────────────────────────────────────────

BASE = "https://labs.hackthebox.com"


def _get(url, headers, ctx, retries=5, backoff=15.0):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            res = urllib.request.urlopen(req, context=ctx)
            return json.loads(res.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                # Honour Retry-After if server provides it, else exponential backoff
                retry_after = e.headers.get('Retry-After')
                wait = float(retry_after) if retry_after else backoff * (attempt + 1)
                print(f"  [!] Rate-limited (429) — waiting {wait:.0f}s… (attempt {attempt+1}/{retries})")
                time.sleep(wait)
            else:
                raise
    raise RuntimeError(f"Gave up after {retries} retries (all 429): {url}")


def _check_ratelimit(response_headers):
    """Read x-ratelimit-remaining and pause if we're about to be throttled."""
    remaining = response_headers.get('x-ratelimit-remaining')
    limit      = response_headers.get('x-ratelimit-limit')
    if remaining is not None:
        remaining = int(remaining)
        lim_str = f"/{limit}" if limit else ""
        if remaining <= 1:
            print(f"  [!] Rate-limit almost reached ({remaining}{lim_str} left) — pausing 60s…")
            time.sleep(60)
        elif remaining <= 3:
            print(f"  [~] Rate-limit low ({remaining}{lim_str} left) — pausing 5s…")
            time.sleep(5)


def get_machine_profile(machine_id_or_name, headers, ctx):
    url = f"{BASE}/api/v4/machine/profile/{machine_id_or_name}"
    try:
        data = _get(url, headers, ctx)
        return data.get("info", {})
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    except RuntimeError:
        # All retries exhausted (persistent 429)
        return None


def discover_retired_machines(headers, ctx, max_id=None, from_id=1, delay=0.15):
    """
    Iterate over machine IDs from_id…max_id, collecting retired machines via profile.
    Binary-searches for max_id if not provided.
    IDs below from_id are handled separately via direct download.
    """
    if max_id is None:
        max_id = _find_max_machine_id(headers, ctx)
        print(f"[*] Highest machine ID discovered: {max_id}")

    scan_start = max(1, from_id)
    print(f"[*] Scanning machine IDs {scan_start} → {max_id} for retired machines…")
    machines = []
    for mid in range(scan_start, max_id + 1):
        try:
            info = get_machine_profile(mid, headers, ctx)
        except Exception as e:
            print(f"  [-] Could not fetch profile for id={mid}: {e} — skipping")
            continue
        if info is None:
            continue
        if info.get("retired"):
            machines.append(info)
            name = info.get("name", "?")
            print(f"  [{len(machines):>4}] {name} (id={mid})")
        time.sleep(delay)

    return machines


import re as _re

def direct_download_range(id_start, id_end, output_dir, headers, ctx, force=False, delay=1.0):
    """
    Attempt to download writeups directly for IDs id_start..id_end without profile scan.
    The machine name is read from Content-Disposition header (filename=Cap.pdf).
    After a successful download, a profile call fetches the avatar.
    """
    print(f"[*] Direct download mode: IDs {id_start} → {id_end} (no profile scan)")
    stats = {"ok": 0, "skipped": 0, "failed": 0, "no_writeup": 0}
    total = id_end - id_start + 1

    for i, mid in enumerate(range(id_start, id_end + 1), 1):
        try:
            req = urllib.request.Request(
                f"{BASE}/api/v4/machine/writeup/{mid}",
                headers=headers,
            )
            res = urllib.request.urlopen(req, context=ctx)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                retry_after = e.headers.get('Retry-After')
                wait = float(retry_after) if retry_after else 60
                print(f"  [!] Rate-limited on id={mid} — waiting {wait:.0f}s…")
                time.sleep(wait)
                stats["failed"] += 1
                continue
            # 400/404 = no writeup for this ID
            stats["no_writeup"] += 1
            continue
        except Exception as e:
            print(f"  [-] id={mid}: {e}")
            stats["failed"] += 1
            continue

        # Detect placeholder JSON response
        if "application/json" in res.headers.get("Content-Type", ""):
            json.loads(res.read())  # drain
            stats["no_writeup"] += 1
            continue

        # Extract machine name from Content-Disposition: attachment; filename=Cap.pdf
        cd = res.headers.get("Content-Disposition", "")
        match = _re.search(r'filename=([^;\r\n]+)', cd)
        if match:
            m_name = match.group(1).strip().replace(".pdf", "")
        else:
            m_name = f"machine_{mid}"

        outdir = Path(output_dir) / m_name
        outdir.mkdir(parents=True, exist_ok=True)
        pdf_path = outdir / f"{m_name}.pdf"
        md_path  = outdir / f"{m_name}.md"

        if md_path.exists() and not force:
            print(f"  [=] '{m_name}' already done — skipping.")
            res.read()  # drain
            stats["skipped"] += 1
            continue

        print(f"\n[★] {m_name}  (id={mid})")

        with open(pdf_path, "wb") as f:
            f.write(res.read())
        print(f"  [+] PDF     → {pdf_path.name}")
        _check_ratelimit(res.headers)

        # Fetch full profile → avatar + save profile.json
        try:
            profile = get_machine_profile(mid, headers, ctx)
            if profile:
                # ── Avatar ──────────────────────────────────────
                avatar = profile.get("avatar")
                download_avatar(avatar, outdir / "icon.png", headers, ctx)

                # ── Save profile.json (full) ─────────────────────
                with open(outdir / "profile.json", "w") as pf:
                    json.dump(profile, pf, indent=2)
                
                os_val = profile.get("os", "?")
                diff_val = profile.get("difficultyText", "?")
                print(f"  [+] Profile → profile.json  ({os_val} / {diff_val})")
        except Exception as e:
            print(f"  [-] Profile fetch failed: {e}")

        convert_pdf_to_markdown(pdf_path, outdir)
        stats["ok"] += 1

        print(f"  Progress: {i}/{total}")
        if i < total:
            time.sleep(delay)

    return stats


def _find_max_machine_id(headers, ctx):
    """Binary-search the largest valid machine ID."""
    low, high = 1, 1000
    while low < high:
        mid = (low + high + 1) // 2
        info = get_machine_profile(mid, headers, ctx)
        if info is not None:
            low = mid
        else:
            high = mid - 1
        time.sleep(0.15)
    return low


# ─────────────────────────────────────────────
#  Download helpers
# ─────────────────────────────────────────────

def download_avatar(avatar_url, icon_path, headers, ctx):
    if not avatar_url:
        return
    if avatar_url.startswith("/"):
        avatar_url = f"{BASE}/storage{avatar_url}"
    elif not avatar_url.startswith("http"):
        avatar_url = f"{BASE}/storage/{avatar_url}"
    try:
        req = urllib.request.Request(avatar_url, headers=headers)
        res = urllib.request.urlopen(req, context=ctx)
        data = res.read()
        # Ignore placeholder avatars (< 500 bytes = 1×1 blank pixel PNG)
        if len(data) < 500:
            print(f"  [~] Avatar is a placeholder ({len(data)} bytes) — skipping.")
            return
        with open(icon_path, "wb") as f:
            f.write(data)
        print(f"  [+] Avatar  → {icon_path.name}")
    except Exception as e:
        print(f"  [-] Avatar download failed: {e}")


def convert_pdf_to_markdown(pdf_path, output_dir):
    md_path = Path(output_dir) / f"{pdf_path.stem}.md"
    img_dir = Path(output_dir) / "images"
    img_dir.mkdir(exist_ok=True)

    try:
        import pymupdf4llm
        md_text = pymupdf4llm.to_markdown(
            str(pdf_path),
            write_images=True,
            image_path=str(img_dir),
            ignore_graphics=True,
            force_text=True,
        )
        # Make image paths relative to the Markdown file location
        md_text = md_text.replace(f"{img_dir}/", "images/")
        md_path.write_text(md_text, encoding="utf-8")
        print(f"  [+] Markdown → {md_path.name}")
        return md_path
    except ImportError:
        print("  [-] pymupdf4llm not found – falling back to pdftotext")

    try:
        subprocess.run(
            ["pdftotext", "-layout", str(pdf_path), str(md_path)],
            check=True, capture_output=True,
        )
        print(f"  [+] Markdown → {md_path.name} (pdftotext fallback)")
        return md_path
    except (FileNotFoundError, subprocess.CalledProcessError) as e:
        print(f"  [-] PDF conversion failed: {e}")
        return None


def download_writeup(machine_id, machine_name, output_dir, headers, ctx,
                     avatar_url=None, force=False):
    outdir = Path(output_dir)
    outdir.mkdir(parents=True, exist_ok=True)

    pdf_path  = outdir / f"{machine_name}.pdf"
    md_path   = outdir / f"{machine_name}.md"
    icon_path = outdir / "icon.png"

    if md_path.exists() and not force:
        print(f"  [=] '{machine_name}' already done — skipping. (--force to redo)")
        return "skipped"

    print(f"\n[★] {machine_name}  (id={machine_id})")

    # ── PDF ────────────────────────────────────
    try:
        req = urllib.request.Request(
            f"{BASE}/api/v4/machine/writeup/{machine_id}",
            headers=headers,
        )
        res = urllib.request.urlopen(req, context=ctx)
        if "application/json" in res.headers.get("Content-Type", ""):
            msg = json.loads(res.read()).get("message", "unknown")
            print(f"  [-] No writeup: {msg}")
            return "no_writeup"
        with open(pdf_path, "wb") as f:
            f.write(res.read())
        print(f"  [+] PDF     → {pdf_path.name}")
        # Check rate-limit headers and auto-pause if needed
        _check_ratelimit(res.headers)
    except urllib.error.HTTPError as e:
        if e.code == 429:
            retry_after = e.headers.get('Retry-After')
            wait = float(retry_after) if retry_after else 60
            print(f"  [!] Rate-limited (429) on PDF — waiting {wait:.0f}s…")
            time.sleep(wait)
            return "failed"
        print(f"  [-] HTTP {e.code} — writeup unavailable (active?/VIP?)")
        return "failed"
    except Exception as e:
        print(f"  [-] Error: {e}")
        return "failed"

    # ── Avatar ─────────────────────────────────
    if not icon_path.exists() or force:
        download_avatar(avatar_url, icon_path, headers, ctx)

    # ── Markdown ───────────────────────────────
    convert_pdf_to_markdown(pdf_path, outdir)
    return "ok"


# ─────────────────────────────────────────────
#  Main
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Download & convert official HTB machine writeups to Markdown",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("-m", "--machine",
                        help=(
                            "Machine(s) to download. Accepts:\n"
                            "  - A single name or ID:       Cap  /  784\n"
                            "  - Comma-separated list:      Cap,Lame,Era\n"
                            "  - Path to a text file:       machines.txt\n"
                            "    (one name/ID per line, lines starting with # are ignored)"
                        ))
    parser.add_argument("-o", "--output", default="../HTB_Writeups",
                        help="Root output directory (default: ../HTB_Writeups)")
    parser.add_argument("--force", action="store_true",
                        help="Re-download and re-convert even if already done")
    parser.add_argument("--delay", type=float, default=5.0,
                        help="Seconds between PDF downloads (default: 5.0). ≥4s recommended to stay under rate limit.")
    parser.add_argument("--range", dest="id_range", default=None,
                        help=(
                            "ID range to scan. Formats:\n"
                            "  766        → scan IDs 1 to 766\n"
                            "  1-766      → scan IDs 1 to 766\n"
                            "  100-200    → scan only IDs 100 to 200\n"
                            "If omitted, auto-discovers the max ID (~30s extra)."
                        ))
    parser.add_argument("--log", action="store_true",
                        help="Save output to a timestamped log file in the logs/ directory")
    args = parser.parse_args()

    if args.log:
        log_dir = Path("logs")
        log_dir.mkdir(exist_ok=True)
        timestamp = datetime.now().strftime("%d_%m_%y-%H_%M")
        log_file = log_dir / f"log_{timestamp}.txt"
        sys.stdout = Tee(log_file)
        print(f"[*] Logging to {log_file}")

    token = get_htb_token()
    if not token:
        sys.exit(1)

    headers = build_headers(token)
    ctx     = make_ctx()

    # ── Resolve machine list from -m argument ─────────────────────────────────
    if args.machine:
        # Expand input: could be a file path, a comma-separated list, or a single name/id
        raw_names = []

        m_arg = args.machine.strip()
        # Check if it's a path to a file
        if os.path.isfile(m_arg):
            print(f"[*] Reading machine list from file: {m_arg}")
            with open(m_arg) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#'):
                        raw_names.append(line)
        else:
            # Support comma-separated list: "Era,Lame,Cap" or "Era, Lame"
            raw_names = [n.strip() for n in m_arg.split(',') if n.strip()]

        print(f"[*] {len(raw_names)} machine(s) to process.\n")
        stats = {"ok": 0, "skipped": 0, "failed": 0, "no_writeup": 0}

        for i, name in enumerate(raw_names, 1):
            lookup = int(name) if name.isdigit() else name
            m_info = get_machine_profile(lookup, headers, ctx)
            if m_info is None:
                print(f"[-] Machine '{name}' not found — skipping.")
                stats["failed"] += 1
                continue

            m_id   = m_info["id"]
            m_name = m_info["name"]
            avatar = m_info.get("avatar")
            out    = Path(args.output) / m_name

            result = download_writeup(m_id, m_name, out, headers, ctx,
                                      avatar_url=avatar, force=args.force)
            stats[result if result in stats else "failed"] += 1

            if i < len(raw_names):
                time.sleep(args.delay)

        if len(raw_names) > 1:
            print(f"\n{'─'*50}")
            print(f"  Total  : {len(raw_names)}")
            print(f"  OK     : {stats['ok']}")
            print(f"  Skipped: {stats['skipped']}")
            print(f"  No PDF : {stats['no_writeup']}")
            print(f"  Failed : {stats['failed']}")
            print(f"{'─'*50}")
        return

    # ── Bulk mode: direct download for all IDs in range ──────────────────────
    # No profile scan: 404/400 = skip, 200 = retired machine with writeup.
    # On success, a profile call fetches name + avatar.

    # Parse --range argument
    id_start, id_end = 1, None
    if args.id_range:
        parts = args.id_range.strip().split('-')
        if len(parts) == 1:
            # Single value → treat as max-id, start from 1
            id_end = int(parts[0])
        elif len(parts) == 2:
            id_start = int(parts[0])
            id_end   = int(parts[1])
        else:
            print(f"[-] Invalid --range format '{args.id_range}'. Use '766' or '100-200'.")
            sys.exit(1)

    if id_end is None:
        print("[*] Auto-discovering max machine ID…")
        id_end = _find_max_machine_id(headers, ctx)
        print(f"[*] Max machine ID: {id_end}\n")

    print(f"[*] Downloading writeups for IDs {id_start} → {id_end}\n")

    stats = direct_download_range(
        id_start=id_start,
        id_end=id_end,
        output_dir=args.output,
        headers=headers,
        ctx=ctx,
        force=args.force,
        delay=args.delay,
    )

    print(f"\n{'─'*50}")
    print(f"  OK     : {stats['ok']}")
    print(f"  Skipped: {stats['skipped']}")
    print(f"  No PDF : {stats['no_writeup']}")
    print(f"  Failed : {stats['failed']}")
    print(f"{'─'*50}")



if __name__ == "__main__":
    main()
