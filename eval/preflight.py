"""Check that each task's unmodified base fails and its reference patch resolves.

Usage: python eval/preflight.py SET   (after eval/prepare.py SET)
Run with the interpreter that has `swebench` installed, Node 24 on PATH, and
Docker running. Artifacts stay in ignored eval/runs/SET-preflight/.
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if len(sys.argv) != 2 or not re.fullmatch(r"[a-z0-9-]+", sys.argv[1]):
    raise SystemExit("Usage: python eval/preflight.py SET")
name = sys.argv[1]
DATASET = ROOT / "runs" / f"swebench-{name}.json"
MANIFEST = ROOT / "runs" / f"tasks-{name}.json"
rows = {row["instance_id"]: row for row in json.loads(DATASET.read_text())}
tasks = json.loads(MANIFEST.read_text())["tasks"]
if set(rows) != {task["id"] for task in tasks}:
    raise RuntimeError("Dataset and manifest differ")

BASE = ("diff --git a/preflight-marker.txt b/preflight-marker.txt\n"
        "new file mode 100644\n--- /dev/null\n+++ b/preflight-marker.txt\n"
        "@@ -0,0 +1 @@\n+baseline grader check\n")
for task in tasks:
    instance = task["id"]
    for label, patch in (("base", BASE), ("gold", rows[instance]["patch"])):
        directory = ROOT / "runs" / f"{name}-preflight" / instance / label
        directory.mkdir(parents=True, exist_ok=True)
        patch_path = directory / "patch.diff"
        patch_path.write_text(patch)
        env = {**os.environ, "SWE_BENCH_DATASET_PATH": str(DATASET),
               "SWE_BENCH_PYTHON": sys.executable,
               "EVAL_PATCH_PATH": str(patch_path),
               "EVAL_TASK_COMMIT": task["commit"]}
        result = subprocess.run(["node", str(ROOT / "grade-swebench.mjs"), instance],
                                cwd=directory, env=env, capture_output=True, text=True)
        (directory / "grader.log").write_text(result.stdout + result.stderr)
        expected = label == "gold"
        if result.returncode != (0 if expected else 1) or not any(
            json.loads(line).get("resolved") is expected
            for line in result.stdout.splitlines() if line.startswith('{"instance_id":')
        ):
            raise RuntimeError(f"{instance} {label} preflight failed; see {directory / 'grader.log'}")
        print(f"{instance} {label}: resolved={expected}", flush=True)
