import json
import posixpath
import re
import time
import uuid

from ..remote_files import _safe_remote_path
from ..runtime import _run, _run_with_stdin, _session_public
from ..slurm import _job_info_payload, _normalize_job_id
from .sbatch import render_sbatch
from .schemas import ResearchValidationError, normalize_params, normalize_resources, safe_slug
from .templates import ResearchTemplateError, get_research_template


RUNS_RELATIVE_ROOT = ".apuana/research/runs"


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _new_run_id(template_id: str) -> str:
    return f"{safe_slug(template_id)}-{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:8]}"


def _research_root() -> str:
    home = (_session_public().get("home") or "").rstrip("/")
    if not home:
        raise ResearchValidationError("SSH login required.")
    return posixpath.join(home, RUNS_RELATIVE_ROOT)


def _run_dir(run_id: str) -> str:
    return posixpath.join(_research_root(), safe_slug(run_id, "run"))


def _resolve_user_path(raw: str, *, run_id: str, fallback: str, allow_home: bool = True) -> str:
    value = str(raw or fallback or "").replace("${run_id}", run_id).strip()
    path, error = _safe_remote_path(value or fallback, allow_home=allow_home)
    if error:
        raise ResearchValidationError(error)
    return path


def _base_manifest(run_id: str, template: dict, params: dict, resources: dict, work_dir: str, output_dir: str) -> dict:
    session = _session_public()
    return {
        "schema_version": "apuana.research.run.v1",
        "run_id": run_id,
        "slurm_job_id": "",
        "project": safe_slug(params.get("project") or template.get("project") or "research"),
        "template": template["id"],
        "template_name": template.get("name") or template["id"],
        "params": params,
        "resources": resources,
        "work_dir": work_dir,
        "output_dir": output_dir,
        "run_dir": _run_dir(run_id),
        "created_at": _now_iso(),
        "created_by": session.get("login") or "",
        "host": session.get("host") or "",
        "status": "created",
    }


def _prepare_request(payload: dict, *, preview_only: bool) -> tuple[dict, str]:
    template = get_research_template(payload.get("template") or payload.get("template_id") or "")
    run_id = safe_slug(payload.get("run_id") or "", "") or _new_run_id(template["id"])
    params = normalize_params(template, payload.get("params") or {}, run_id)
    resources = normalize_resources(payload.get("resources") or {})
    if not (payload.get("resources") or {}).get("job_name"):
        resources["job_name"] = safe_slug(f"{template['id']}-{params.get('project') or 'research'}")
    work_dir = _resolve_user_path(
        params.get("work_dir"),
        run_id=run_id,
        fallback=template.get("default_work_dir") or "~",
        allow_home=True,
    )
    output_dir = _resolve_user_path(
        params.get("output_dir"),
        run_id=run_id,
        fallback=template.get("default_output_dir") or f"~/{RUNS_RELATIVE_ROOT}/{run_id}/outputs",
        allow_home=False,
    )
    manifest = _base_manifest(run_id, template, params, resources, work_dir, output_dir)
    manifest["preview_only"] = bool(preview_only)
    sbatch = render_sbatch(
        template,
        run_id=run_id,
        run_dir=manifest["run_dir"],
        manifest=manifest,
        params=params,
        resources=resources,
        work_dir=work_dir,
        output_dir=output_dir,
    )
    return manifest, sbatch


def research_preview_payload(payload: dict) -> dict:
    try:
        manifest, sbatch = _prepare_request(payload, preview_only=True)
        return {"ok": True, "manifest": manifest, "sbatch": sbatch}
    except (ResearchValidationError, ResearchTemplateError) as exc:
        return {"ok": False, "error": str(exc)}
    except Exception as exc:
        return {"ok": False, "error": f"Falha ao gerar preview: {exc}"}


def _write_remote_text(path: str, text: str, timeout: int = 12) -> tuple[bool, str]:
    script = f"""
set -euo pipefail
target={shlex_quote(path)}
mkdir -p "$(dirname "$target")"
cat > "$target"
"""
    rc, out, err = _run_with_stdin(["bash", "-lc", script], text.encode("utf-8"), timeout=timeout)
    return rc == 0, err or out


def shlex_quote(value: str) -> str:
    import shlex

    return shlex.quote(str(value))


def research_submit_payload(payload: dict) -> dict:
    try:
        manifest, sbatch = _prepare_request(payload, preview_only=False)
        run_dir = manifest["run_dir"]
        setup = f"set -euo pipefail; mkdir -p {shlex_quote(run_dir)}/logs {shlex_quote(manifest['output_dir'])}"
        rc, out, err = _run(["bash", "-lc", setup], timeout=12)
        if rc != 0:
            return {"ok": False, "error": err or out or "Não foi possível criar diretórios remotos."}

        ok, error = _write_remote_text(f"{run_dir}/run_manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        if not ok:
            return {"ok": False, "error": f"Falha ao gravar manifest remoto: {error}"}
        ok, error = _write_remote_text(f"{run_dir}/sbatch.sh", sbatch)
        if not ok:
            return {"ok": False, "error": f"Falha ao gravar sbatch remoto: {error}"}

        rc, out, err = _run(["bash", "-lc", f"sbatch {shlex_quote(run_dir + '/sbatch.sh')}"], timeout=12)
        if rc != 0:
            return {"ok": False, "error": err or out or "sbatch falhou.", "manifest": manifest, "sbatch": sbatch}
        match = re.search(r"Submitted batch job\s+(\d+)", out or "")
        job_id = match.group(1) if match else ""
        manifest["slurm_job_id"] = job_id
        manifest["status"] = "submitted"
        manifest["submitted_at"] = _now_iso()
        _write_remote_text(f"{run_dir}/run_manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        return {
            "ok": True,
            "job_id": job_id,
            "run_id": manifest["run_id"],
            "run_dir": run_dir,
            "manifest": manifest,
            "sbatch": sbatch,
            "stdout": out,
            "stderr": err,
        }
    except (ResearchValidationError, ResearchTemplateError) as exc:
        return {"ok": False, "error": str(exc)}
    except Exception as exc:
        return {"ok": False, "error": f"Falha ao submeter experimento: {exc}"}


_FIND_MANIFEST_PY = r"""
import json
import os
import pathlib
import sys

job_id = sys.argv[1].split(".", 1)[0]
root = pathlib.Path(os.path.expanduser("~/.apuana/research/runs"))
matches = []
if root.exists():
    for manifest_path in sorted(root.glob("*/run_manifest.json"), reverse=True):
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if str(manifest.get("slurm_job_id") or "").split(".", 1)[0] != job_id:
            continue
        status_path = manifest_path.parent / "status.json"
        status = {}
        if status_path.exists():
            try:
                status = json.loads(status_path.read_text(encoding="utf-8"))
            except Exception:
                status = {}
        matches.append({"manifest": manifest, "status": status})
        break
print(json.dumps({"ok": bool(matches), "result": matches[0] if matches else {}}))
"""


def _research_manifest_for_job(job_id: str) -> dict:
    normalized = _normalize_job_id(job_id)
    if not normalized:
        return {"ok": False, "code": "invalid_job", "error": "Job ID inválido."}
    rc, out, err = _run_with_stdin(["python3", "-", normalized], _FIND_MANIFEST_PY.encode("utf-8"), timeout=12)
    if rc != 0:
        return {"ok": False, "code": "manifest_lookup_failed", "error": err or out or "Falha ao procurar manifest."}
    try:
        payload = json.loads(out or "{}")
    except Exception as exc:
        return {"ok": False, "code": "manifest_parse_failed", "error": str(exc)}
    if not payload.get("ok"):
        return {"ok": False, "code": "not_research_job", "error": "Job sem manifest Research."}
    result = payload.get("result") or {}
    return {"ok": True, "manifest": result.get("manifest") or {}, "status": result.get("status") or {}}


def research_job_payload(job_id: str) -> dict:
    payload = _research_manifest_for_job(job_id)
    if not payload.get("ok"):
        return payload
    info = _job_info_payload(job_id)
    payload["job"] = info.get("summary", {}) if info.get("ok") else {}
    payload["resources"] = info.get("resources", {}) if info.get("ok") else {}
    return payload
