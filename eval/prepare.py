"""Generate a pinned SWE-bench dataset and runner manifest for a task set.

Usage: python eval/prepare.py SET
Reads eval/tasks/SET.json, checks the selected rows (in selection order)
against eval/tasks/SET.sha256, and writes eval/runs/swebench-SET.json and
eval/runs/tasks-SET.json. Requires the `datasets` package.
"""

import hashlib
import json
import re
import sys
from pathlib import Path

from datasets import load_dataset

ROOT = Path(__file__).resolve().parent
REVISION = "78f471bf655a3137b2e8a75af1501690ec009ec3"
if len(sys.argv) != 2 or not re.fullmatch(r"[a-z0-9-]+", sys.argv[1]):
    raise SystemExit("Usage: python eval/prepare.py SET")
name = sys.argv[1]
tasks = json.loads((ROOT / "tasks" / f"{name}.json").read_text())["tasks"]
ids = [task["id"] for task in tasks]
if len(set(ids)) != len(ids):
    raise RuntimeError("Duplicate task instance")

rows = load_dataset("SWE-bench/SWE-bench_Verified", split="test", revision=REVISION)
by_id = {row["instance_id"]: row for row in rows if row["instance_id"] in ids}
if set(by_id) != set(ids):
    raise RuntimeError("Pinned benchmark revision is missing a selected instance")
selected = [by_id[id_] for id_ in ids]
contents = json.dumps(selected, ensure_ascii=False) + "\n"
expected = (ROOT / "tasks" / f"{name}.sha256").read_text().strip()
if hashlib.sha256(contents.encode()).hexdigest() != expected:
    raise RuntimeError("Pinned dataset digest mismatch; check the selection order and revision")

manifest = []
for task in tasks:
    row = by_id[task["id"]]
    if row["base_commit"] != task["commit"] or task["repo"] != f"https://github.com/{row['repo']}.git":
        raise RuntimeError(f"Task selection differs from benchmark: {task['id']}")
    manifest.append({**task, "benchmark": "SWE-bench Verified",
                     "prompt": row["problem_statement"].replace("\r\n", "\n")})

output = ROOT / "runs"
output.mkdir(exist_ok=True)
(output / f"swebench-{name}.json").write_text(contents)
(output / f"tasks-{name}.json").write_text(json.dumps({"tasks": manifest}, ensure_ascii=False, indent=2) + "\n")
print(output / f"tasks-{name}.json")
