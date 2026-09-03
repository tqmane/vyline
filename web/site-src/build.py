#!/usr/bin/env python3
# The generated site in this bundle is intentionally dependency-free.
# This file is a stable regeneration entrypoint; full page source metadata lives in content.json.
# For a full rebuild from repository docs, run scripts/build-web-docs.py at repository root.
from pathlib import Path
import subprocess, sys
root=Path(__file__).resolve().parents[2]
script=root/'scripts'/'build-web-docs.py'
if not script.exists():
    raise SystemExit(f"missing {script}")
raise SystemExit(subprocess.call([sys.executable,str(script)]))
