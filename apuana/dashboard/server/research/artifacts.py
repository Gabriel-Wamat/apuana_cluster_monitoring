import json
import mimetypes
import posixpath

from ..remote_files import _safe_remote_path
from ..runtime import _run_bytes, _run_with_stdin
from ..slurm import _normalize_job_id
from .runs import _research_manifest_for_job


MAX_ARTIFACT_BYTES = 50 * 1024 * 1024


_READ_JSON_PY = r"""
import json
import pathlib
import sys

base = pathlib.Path(sys.argv[1])
name = sys.argv[2]
target = base / name
if not target.exists():
    print(json.dumps({"ok": True, "exists": False, "data": None}))
    raise SystemExit
try:
    data = json.loads(target.read_text(encoding="utf-8"))
except Exception as exc:
    print(json.dumps({"ok": False, "error": str(exc)}))
    raise SystemExit
print(json.dumps({"ok": True, "exists": True, "data": data}))
"""


_DISCOVER_ARTIFACTS_PY = r"""
import json
import os
import pathlib
import sys

roots = [pathlib.Path(p) for p in sys.argv[1:] if p]
suffixes = {
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".tif", ".tiff",
    ".pt", ".pth", ".ckpt", ".safetensors", ".json", ".csv", ".txt", ".log"
}
items = []
seen = set()
for root in roots:
    if not root.exists():
        continue
    if root.is_file():
        candidates = [root]
    else:
        candidates = [p for p in root.rglob("*") if p.is_file()]
    for path in candidates:
        if path.suffix.lower() not in suffixes:
            continue
        key = str(path)
        if key in seen:
            continue
        seen.add(key)
        try:
            stat = path.stat()
        except Exception:
            continue
        kind = "image" if path.suffix.lower() in {".png",".jpg",".jpeg",".webp",".gif",".tif",".tiff"} else "file"
        if path.suffix.lower() in {".pt",".pth",".ckpt",".safetensors"}:
            kind = "checkpoint"
        if path.name in {"metrics.json", "artifacts.json"}:
            kind = "metadata"
        items.append({
            "name": path.name,
            "path": str(path),
            "kind": kind,
            "size": stat.st_size,
            "mtime": int(stat.st_mtime),
        })
items.sort(key=lambda item: (-item["mtime"], item["name"]))
print(json.dumps({"ok": True, "items": items[:200]}))
"""


def _read_run_json(run_dir: str, name: str) -> dict:
    rc, out, err = _run_with_stdin(["python3", "-", run_dir, name], _READ_JSON_PY.encode("utf-8"), timeout=10)
    if rc != 0:
        return {"ok": False, "error": err or out or f"Falha ao ler {name}."}
    try:
        return json.loads(out or "{}")
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def research_metrics_payload(job_id: str) -> dict:
    manifest_payload = _research_manifest_for_job(job_id)
    if not manifest_payload.get("ok"):
        return manifest_payload
    manifest = manifest_payload.get("manifest") or {}
    run_dir = manifest.get("run_dir") or ""
    output_dir = manifest.get("output_dir") or ""
    payload = _read_run_json(run_dir, "metrics.json")
    if payload.get("ok") and not payload.get("exists") and output_dir and output_dir != run_dir:
        payload = _read_run_json(output_dir, "metrics.json")
    if not payload.get("ok"):
        return payload
    return {
        "ok": True,
        "job_id": _normalize_job_id(job_id),
        "run_id": manifest.get("run_id", ""),
        "exists": bool(payload.get("exists")),
        "metrics": payload.get("data") or {},
    }


def research_artifacts_payload(job_id: str) -> dict:
    manifest_payload = _research_manifest_for_job(job_id)
    if not manifest_payload.get("ok"):
        return manifest_payload
    manifest = manifest_payload.get("manifest") or {}
    run_dir = manifest.get("run_dir") or ""
    output_dir = manifest.get("output_dir") or ""
    explicit = _read_run_json(run_dir, "artifacts.json")
    if explicit.get("ok") and not explicit.get("exists") and output_dir and output_dir != run_dir:
        explicit = _read_run_json(output_dir, "artifacts.json")
    if explicit.get("ok") and explicit.get("exists"):
        data = explicit.get("data") or {}
        items = data.get("items") if isinstance(data, dict) else data
        return {"ok": True, "job_id": _normalize_job_id(job_id), "run_id": manifest.get("run_id", ""), "items": items or []}
    rc, out, err = _run_with_stdin(
        ["python3", "-", output_dir, run_dir],
        _DISCOVER_ARTIFACTS_PY.encode("utf-8"),
        timeout=20,
    )
    if rc != 0:
        return {"ok": False, "error": err or out or "Falha ao descobrir artefatos."}
    try:
        data = json.loads(out or "{}")
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    return {
        "ok": True,
        "job_id": _normalize_job_id(job_id),
        "run_id": manifest.get("run_id", ""),
        "items": data.get("items") or [],
    }


def research_artifact_file_payload(raw_path: str) -> dict:
    path, error = _safe_remote_path(raw_path, allow_home=True)
    if error:
        return {"ok": False, "error": error}
    script = f"""
set -euo pipefail
target={shlex_quote(path)}
if [ ! -f "$target" ]; then
  echo "Arquivo não encontrado." >&2
  exit 66
fi
size=$(stat -c%s "$target")
if [ "$size" -gt {MAX_ARTIFACT_BYTES} ]; then
  echo "Arquivo muito grande para preview." >&2
  exit 67
fi
cat "$target"
"""
    rc, out, err = _run_bytes(["bash", "-lc", script], timeout=30)
    if rc != 0:
        return {"ok": False, "error": err.decode("utf-8", errors="replace") or "Falha ao ler artefato."}
    content_type = mimetypes.guess_type(posixpath.basename(path))[0] or "application/octet-stream"
    return {"ok": True, "path": path, "content_type": content_type, "body": out}


def shlex_quote(value: str) -> str:
    import shlex

    return shlex.quote(str(value))
