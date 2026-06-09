import base64
import json
import shlex
from pathlib import Path

from .schemas import env_name


def _b64(value: str) -> str:
    return base64.b64encode(str(value or "").encode("utf-8")).decode("ascii")


def _export_lines(params: dict) -> str:
    lines = []
    for key, value in sorted(params.items()):
        lines.append(f"export RESEARCH_PARAM_{env_name(key)}={shlex.quote(str(value))}")
    return "\n".join(lines)


def render_sbatch(
    template: dict,
    *,
    run_id: str,
    run_dir: str,
    manifest: dict,
    params: dict,
    resources: dict,
    work_dir: str,
    output_dir: str,
) -> str:
    template_path = Path(template["_root"]) / template.get("template_file", "run.sbatch.tpl")
    raw_template = template_path.read_text(encoding="utf-8")
    command = params.get("command") or template.get("default_command") or "python main.py"
    env_activation = params.get("env_activation") or params.get("environment") or ""
    gres_line = f"#SBATCH --gres=gpu:{resources['gpus']}" if int(resources.get("gpus") or 0) > 0 else ""
    node_line = f"#SBATCH -w {resources['node']}" if resources.get("node") else ""
    mapping = {
        "job_name": resources["job_name"],
        "partition": resources["partition"],
        "qos": resources["qos"],
        "cpus": str(resources["cpus"]),
        "mem": resources["mem"],
        "time": resources["time"],
        "gres_line": gres_line,
        "node_line": node_line,
        "run_id": run_id,
        "run_dir": shlex.quote(run_dir),
        "work_dir": shlex.quote(work_dir),
        "output_dir": shlex.quote(output_dir),
        "stdout_path": f"{run_dir}/logs/slurm_%j.out",
        "stderr_path": f"{run_dir}/logs/slurm_%j.err",
        "manifest_json": shlex.quote(json.dumps(manifest, ensure_ascii=False, sort_keys=True)),
        "params_exports": _export_lines(params),
        "command_b64": _b64(command),
        "env_activation_b64": _b64(env_activation),
    }
    rendered = raw_template
    for key, value in mapping.items():
        rendered = rendered.replace("{{" + key + "}}", value)
    return rendered.rstrip() + "\n"
