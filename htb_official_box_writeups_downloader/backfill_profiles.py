#!/usr/bin/env python3
"""
Backfill profile.json for already-downloaded HTB machine writeups.
Reads machine name from folder name, fetches profile from API, saves profile.json.

Usage:
    python3 backfill_profiles.py [--output ../HTB_Writeups] [--delay 5]
"""
import sys, os, json, time, argparse, ssl, urllib.request, urllib.error
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
from htb_writeup_scraper import get_htb_token, build_headers, make_ctx, get_machine_profile, BASE

def backfill(output_dir, delay):
    token = get_htb_token()
    if not token:
        sys.exit(1)
    headers = build_headers(token)
    ctx = make_ctx()

    root = Path(output_dir)
    folders = [f for f in root.iterdir() if f.is_dir()]
    total = len(folders)
    print(f"[*] {total} machine folders found in {root}\n")

    ok = skip = failed = 0
    for i, folder in enumerate(sorted(folders), 1):
        profile_path = folder / "profile.json"
        if profile_path.exists():
            print(f"  [=] {folder.name} — already has profile.json")
            skip += 1
            continue

        # Try by name first, then search numerically if needed
        machine_name = folder.name
        print(f"  [{i}/{total}] Fetching profile for '{machine_name}'…", end=" ", flush=True)
        try:
            profile = get_machine_profile(machine_name, headers, ctx)
            if not profile:
                print("not found — skipping")
                failed += 1
                continue

            with open(profile_path, "w") as pf:
                json.dump(profile, pf, indent=2)
            
            os_val = profile.get("os", "?")
            diff_val = profile.get("difficultyText", "?")
            print(f"✓  ({os_val} / {diff_val})")
            ok += 1
        except Exception as e:
            print(f"error: {e}")
            failed += 1

        if i < total:
            time.sleep(delay)

    print(f"\n{'─'*50}")
    print(f"  OK     : {ok}")
    print(f"  Skipped: {skip}")
    print(f"  Failed : {failed}")
    print(f"{'─'*50}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill profile.json for HTB writeup folders")
    parser.add_argument("-o", "--output", default="../HTB_Writeups")
    parser.add_argument("--delay", type=float, default=5.0,
                        help="Seconds between API requests (default: 5.0)")
    args = parser.parse_args()
    backfill(args.output, args.delay)
