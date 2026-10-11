"""Load a relay.env style file into os.environ, then run the target script.

Usage: python run_with_env.py <envfile> <script> [args...]
Existing environment variables are NOT overwritten (setdefault).
"""
import os
import runpy
import sys

envfile, script = sys.argv[1], sys.argv[2]
with open(envfile, encoding="utf-8") as fh:
    for raw in fh:
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())

sys.argv = [script] + sys.argv[3:]
runpy.run_path(script, run_name="__main__")
