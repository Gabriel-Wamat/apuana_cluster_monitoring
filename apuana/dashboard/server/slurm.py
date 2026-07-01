import os
import re
import socket
import threading
import time
from pathlib import Path

from .config import JOB_ID_RE, TRANSFER_HOST
from .runtime import _run, _session_public

_cache: dict = {}
_prev: dict = {}
_lock = threading.Lock()

def _int(v: str) -> int:
    try:
        return int(v)
    except Exception:
        return 0


def _float(v: str) -> float:
    try:
        return float((v or "").replace("[Not Supported]", "").replace("N/A", "").strip())
    except Exception:
        return 0.0


def _metric_value(v: str) -> str:
    value = (v or "").strip()
    return "" if not value or value.upper() in {"N/A", "[N/A]"} else value


def _human_size(size: int) -> str:
    value = float(max(size, 0))
    for unit in ("B", "KiB", "MiB", "GiB"):
        if value < 1024 or unit == "GiB":
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024
    return f"{int(size)} B"


def _slurm_ok(stderr: str) -> bool:
    lower = (stderr or "").lower()
    return "fatal" not in lower and "error:" not in lower


def _memory_to_mb(raw: str) -> int:
    value = (raw or "").strip()
    if not value or value.upper() == "N/A":
        return 0

    match = re.match(r"^(\d+(?:\.\d+)?)([KMGT]?)([cn]?)$", value, re.IGNORECASE)
    if not match:
        return 0

    amount = float(match.group(1))
    unit = match.group(2).upper() or "M"
    scale = {"K": 1 / 1024, "M": 1, "G": 1024, "T": 1024 * 1024}
    return int(amount * scale.get(unit, 1))


def _memory_scope(raw: str) -> str:
    match = re.match(r"^\d+(?:\.\d+)?[KMGT]?([cn]?)$", (raw or "").strip(), re.IGNORECASE)
    return match.group(1).lower() if match else ""


def _memory_total_mb(raw: str, cpus: int, nodes: int) -> int:
    base_mb = _memory_to_mb(raw)
    if _memory_scope(raw) == "c":
        return base_mb * max(cpus, 1)
    return base_mb * max(nodes, 1)


def _memory_human(mb: int) -> str:
    if mb <= 0:
        return "-"
    if mb >= 1024 * 1024:
        return f"{mb / (1024 * 1024):.1f} TiB"
    if mb >= 1024:
        return f"{mb / 1024:.1f} GiB"
    return f"{mb} MiB"


def _gpu_request_count(raw: str) -> int:
    value = raw or ""
    total = 0
    for match in re.finditer(r"(?:gres:)?gpu(?::[^:,=]+)?:(\d+)", value):
        total += _int(match.group(1))
    for match in re.finditer(r"gres/gpu=(\d+)", value):
        total += _int(match.group(1))
    if total == 0:
        for match in re.finditer(r"\bgpu=(\d+)", value):
            total += _int(match.group(1))
    return total


def _tres_value(raw: str, key: str) -> int:
    for item in (raw or "").split(","):
        name, _, value = item.partition("=")
        if name == key:
            return _int(value)
    return 0


def _parse_scontrol_fields(raw: str) -> dict:
    text = " ".join(line.strip() for line in (raw or "").splitlines() if line.strip())
    matches = list(re.finditer(r"(?<!\S)([A-Za-z][A-Za-z0-9_:/]*)=", text))
    fields = {}
    for idx, match in enumerate(matches):
        key = match.group(1)
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        fields[key] = text[match.end():end].strip()
    return fields


def _strip_slurm_identity(value: str) -> str:
    match = re.match(r"^(.+?)\(\d+\)$", value or "")
    return match.group(1) if match else (value or "")


def _job_info_payload(raw_job_id: str) -> dict:
    job_id = _normalize_job_id(raw_job_id)
    if not job_id:
        return {"ok": False, "error": "Invalid job ID.", "job_id": raw_job_id, "fields": {}, "raw": ""}

    rc, out, err = _run(["scontrol", "show", "job", job_id], timeout=8)
    raw = out or err
    if rc != 0 or not out:
        return {
            "ok": False,
            "error": raw or "scontrol returned no job data.",
            "job_id": job_id,
            "fields": {},
            "raw": raw,
        }

    fields = _parse_scontrol_fields(out)
    tres = fields.get("TRES", "")
    resources = {
        "nodes": _int(fields.get("NumNodes", "")),
        "cpus": _int(fields.get("NumCPUs", "")) or _tres_value(tres, "cpu"),
        "tasks": _int(fields.get("NumTasks", "")),
        "cpus_per_task": _int(fields.get("CPUs/Task", "")),
        "memory": fields.get("MinMemoryNode") or fields.get("MinMemoryCPU") or "-",
        "gpus": _gpu_request_count(tres) or _gpu_request_count(fields.get("TresPerNode", "")),
        "tres": tres,
        "tres_per_node": fields.get("TresPerNode", ""),
    }

    summary = {
        "job_id": fields.get("JobId", job_id),
        "name": fields.get("JobName", "-"),
        "state": fields.get("JobState", "-"),
        "reason": fields.get("Reason", "-"),
        "user": _strip_slurm_identity(fields.get("UserId", "")),
        "account": fields.get("Account", "-"),
        "qos": fields.get("QOS", "-"),
        "partition": fields.get("Partition", "-"),
        "runtime": fields.get("RunTime", "-"),
        "time_limit": fields.get("TimeLimit", "-"),
        "submit_time": fields.get("SubmitTime", "-"),
        "start_time": fields.get("StartTime", "-"),
        "end_time": fields.get("EndTime", "-"),
        "scheduler": fields.get("Scheduler", "-"),
        "node_list": fields.get("NodeList", "-"),
        "batch_host": fields.get("BatchHost", "-"),
        "command": fields.get("Command", "-"),
        "work_dir": fields.get("WorkDir", "-"),
        "stdout": fields.get("StdOut", "-"),
        "stderr": fields.get("StdErr", "-"),
        "exit_code": fields.get("ExitCode", "-"),
    }

    return {
        "ok": True,
        "error": "",
        "job_id": job_id,
        "summary": summary,
        "resources": resources,
        "fields": fields,
        "raw": out,
    }

def _load_payload() -> dict:
    cpu_count = os.cpu_count() or 0
    load1 = load5 = load15 = 0.0
    try:
        # Linux
        parts = Path("/proc/loadavg").read_text(encoding="utf-8").split()
        load1, load5, load15 = float(parts[0]), float(parts[1]), float(parts[2])
    except Exception:
        try:
            # macOS / BSD via uptime -s not available; use getloadavg()
            load1, load5, load15 = os.getloadavg()
        except Exception:
            pass

    return {
        "cpus": cpu_count,
        "load1": load1,
        "load5": load5,
        "load15": load15,
        "load_pct": round(load1 / cpu_count * 100) if cpu_count else 0,
    }


def _resource_summary(rows: list[dict]) -> dict:
    cpus = sum(r["cpus"] for r in rows)
    mem_mb = sum(r["mem_total_mb"] for r in rows)
    gpus = sum(r["gpus"] for r in rows)
    return {
        "jobs": len(rows),
        "cpus": cpus,
        "mem_mb": mem_mb,
        "mem_human": _memory_human(mem_mb),
        "gpus": gpus,
    }


def _current_login() -> str:
    return (_session_public().get("login") or "").strip()


def _resources_payload() -> dict:
    rc, out, err = _run(
        ["squeue", "-h", "-o", "%i|%u|%P|%j|%T|%C|%m|%b|%D|%M|%R"], timeout=6
    )
    if rc != 0 or not _slurm_ok(err):
        return {
            "ok": False,
            "error": (err or out or "squeue failed").splitlines()[-1],
            "jobs": [],
            "running_jobs": [],
            "pending_jobs": [],
            "running": _resource_summary([]),
            "pending": _resource_summary([]),
            "current_user": _resource_summary([]),
            "by_user": [],
            "login_cpu": _load_payload(),
        }

    jobs = []
    for line in out.splitlines():
        parts = line.split("|", 10)
        if len(parts) < 11:
            continue

        job_id, user, partition, name, state, cpus, mem_raw, tres, nodes, runtime, reason = parts
        cpu_count = _int(cpus)
        node_count = max(_int(nodes), 1)
        mem_mb = _memory_to_mb(mem_raw)
        mem_total_mb = _memory_total_mb(mem_raw, cpu_count, node_count)
        jobs.append(
            {
                "job_id": job_id,
                "user": user,
                "partition": partition,
                "name": name,
                "state": state,
                "cpus": cpu_count,
                "mem_raw": mem_raw,
                "mem_mb": mem_mb,
                "mem_total_mb": mem_total_mb,
                "mem_human": _memory_human(mem_total_mb),
                "gpus": _gpu_request_count(tres),
                "nodes": node_count,
                "time": runtime,
                "reason": reason,
            }
        )

    running = [job for job in jobs if job["state"] == "RUNNING"]
    pending = [job for job in jobs if job["state"] == "PENDING"]
    by_user: dict[str, dict] = {}
    for job in running:
        entry = by_user.setdefault(
            job["user"], {"user": job["user"], "jobs": 0, "cpus": 0, "mem_mb": 0, "gpus": 0}
        )
        entry["jobs"] += 1
        entry["cpus"] += job["cpus"]
        entry["mem_mb"] += job["mem_total_mb"]
        entry["gpus"] += job["gpus"]

    users = sorted(by_user.values(), key=lambda item: (-item["cpus"], item["user"]))
    for item in users:
        item["mem_human"] = _memory_human(item["mem_mb"])

    current_login = _current_login()

    return {
        "ok": True,
        "error": "",
        "jobs": jobs,
        "running_jobs": running,
        "pending_jobs": pending,
        "running": _resource_summary(running),
        "pending": _resource_summary(pending),
        "current_user": _resource_summary([job for job in running if current_login and job["user"] == current_login]),
        "by_user": users,
        "login_cpu": _load_payload(),
    }

def _normalize_job_id(raw: str) -> str:
    job_id = (raw or "").strip().split()[0] if (raw or "").strip() else ""
    return job_id if JOB_ID_RE.match(job_id) else ""


def _parse_nvidia_smi_csv(out: str) -> list[dict]:
    gpus = []
    for line in out.splitlines():
        parts = [part.strip() for part in line.split(",")]
        if len(parts) < 6:
            continue
        power_draw = _metric_value(parts[6]) if len(parts) > 6 else ""
        power_limit = _metric_value(parts[7]) if len(parts) > 7 else ""
        gpus.append(
            {
                "index": parts[0],
                "name": parts[1],
                "util": _int(parts[2]),
                "mem_used": _int(parts[3]),
                "mem_total": max(_int(parts[4]), 1),
                "temp": _int(parts[5]),
                "power_draw": power_draw,
                "power_limit": power_limit,
                "power_draw_w": _float(power_draw),
                "power_limit_w": _float(power_limit),
                "driver": parts[8] if len(parts) > 8 else "",
            }
        )
    return gpus


def _parse_cuda_version(raw: str) -> str:
    match = re.search(r"CUDA Version:\s*([0-9.]+)", raw or "")
    return match.group(1) if match else ""


def _job_gpu_access(base_job_id: str) -> tuple[bool, str]:
    rc, out, err = _run(
        ["squeue", "-h", "-j", base_job_id, "-o", "%i|%u|%T|%b"], timeout=5
    )
    if rc != 0 or not _slurm_ok(err):
        return False, err or out or "Could not inspect job access."

    candidates = []
    for line in out.splitlines():
        parts = line.split("|", 3)
        if len(parts) == 4:
            candidates.append(
                {
                    "job_id": parts[0],
                    "user": parts[1],
                    "state": parts[2],
                    "gpus": _gpu_request_count(parts[3]),
                }
            )

    if not candidates:
        return False, "Job is not active in the current queue."

    current_login = _current_login()
    own_running_gpu_jobs = [
        job for job in candidates
        if current_login and job["user"] == current_login and job["state"] == "RUNNING" and job["gpus"] > 0
    ]
    if own_running_gpu_jobs:
        return True, ""

    if any(not current_login or job["user"] != current_login for job in candidates):
        return False, "GPU telemetry is only available for your own jobs."
    if any(job["state"] != "RUNNING" for job in candidates):
        return False, "GPU telemetry is only available for RUNNING jobs."
    return False, "This job does not request a GPU."


def _job_gpu_payload(raw_job_id: str) -> dict:
    job_id = _normalize_job_id(raw_job_id)
    if not job_id:
        return {"ok": False, "error": "Invalid job ID.", "job_id": raw_job_id, "gpus": []}

    base_job_id = job_id.split(".", 1)[0]
    allowed, access_error = _job_gpu_access(base_job_id)
    if not allowed:
        return {
            "ok": False,
            "error": access_error,
            "job_id": job_id,
            "base_job_id": base_job_id,
            "gpus": [],
            "stdout": "",
            "stderr": "",
            "code": 0,
        }

    query_fields = "index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit,driver_version"
    query_cmd = f"nvidia-smi --query-gpu={query_fields} --format=csv,noheader,nounits"
    cmd = [
        "srun",
        "--immediate=1",
        f"--jobid={base_job_id}",
        "bash",
        "-lc",
        f"{query_cmd}; printf '\\n--APUANA-NVIDIA-SMI--\\n'; nvidia-smi",
    ]
    rc, out, err = _run(cmd, timeout=12)
    csv_out, _, smi_raw = (out or "").partition("--APUANA-NVIDIA-SMI--")
    gpus = _parse_nvidia_smi_csv(csv_out) if rc == 0 else []
    if rc != 0 or not gpus:
        fallback_cmd = [
            "srun",
            "--immediate=1",
            f"--jobid={base_job_id}",
            "nvidia-smi",
            "--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu",
            "--format=csv,noheader,nounits",
        ]
        fallback_rc, fallback_out, fallback_err = _run(fallback_cmd, timeout=10)
        if fallback_rc == 0 and _parse_nvidia_smi_csv(fallback_out):
            cmd, rc, out, err = fallback_cmd, fallback_rc, fallback_out, fallback_err
            smi_raw = ""
            gpus = _parse_nvidia_smi_csv(fallback_out)
    job_info = _job_info_payload(base_job_id)
    return {
        "ok": rc == 0 and bool(gpus),
        "error": "" if rc == 0 and gpus else (err or out or "No GPU telemetry returned."),
        "job_id": job_id,
        "base_job_id": base_job_id,
        "command": " ".join(cmd),
        "job": job_info.get("summary", {}) if job_info.get("ok") else {},
        "resources": job_info.get("resources", {}) if job_info.get("ok") else {},
        "cuda_version": _parse_cuda_version(smi_raw),
        "gpus": gpus,
        "stdout": out,
        "stderr": err,
        "code": rc,
    }


def _collect() -> None:
    global _prev
    node = socket.gethostname()
    while True:
        session = _session_public()
        if not session.get("token"):
            time.sleep(5)
            continue
        d: dict = {
            "ts": time.strftime("%H:%M:%S"),
            "node": session.get("host") or node,
            "user": session.get("login") or "",
        }

        # squeue: -o and format string as separate arguments
        rc, out, err = _run(["squeue", "-o", "%i|%u|%P|%j|%T|%M|%D|%R", "--noheader"])
        squeue_ok = rc == 0 and _slurm_ok(err)
        rows = [ln.split("|") for ln in out.splitlines() if ln] if squeue_ok else []
        d["queue"] = (
            {"ok": True,
             "headers": ["JOBID", "USER", "PARTITION", "NAME", "STATE", "TIME", "NODES", "REASON"],
             "rows": rows}
            if squeue_ok else {"ok": False, "error": (err or out).splitlines()[-1] if (err or out) else "squeue failed", "headers": [], "rows": []}
        )

        # compute KPI counters
        run = sum(1 for r in rows if len(r) > 4 and r[4] == "RUNNING")
        pnd = sum(1 for r in rows if len(r) > 4 and r[4] == "PENDING")

        # deltas vs previous collection
        with _lock:
            prev_run = _prev.get("run", run)
            prev_pnd = _prev.get("pnd", pnd)
        d["run"]       = run
        d["pnd"]       = pnd
        d["delta_run"] = run - prev_run
        d["delta_pnd"] = pnd - prev_pnd

        # active users (unique users currently in the queue)
        d["active_users"] = sorted({r[1] for r in rows if len(r) > 1})
        d["resources"] = _resources_payload()

        rc, out, err = _run(["sinfo", "-o", "%P|%a|%l|%D|%t", "--noheader"])
        sinfo_ok = rc == 0 and _slurm_ok(err)
        d["sinfo"] = (
            {"ok": True,
             "headers": ["PARTITION", "AVAIL", "TIMELIMIT", "NODES", "STATE"],
             "rows": [ln.split("|") for ln in out.splitlines() if ln]}
            if sinfo_ok else {"ok": False, "error": (err or out).splitlines()[-1] if (err or out) else "sinfo failed"}
        )
        d["transfer"] = {
            "user": session.get("login") or "",
            "host": TRANSFER_HOST,
            "home": session.get("home") or "",
        }

        # disk usage — usa POSIX df (sem --output que é GNU-only)
        rc, out, _ = _run(["df", "-h"])
        disks = []
        if rc == 0:
            for ln in out.splitlines()[1:]:
                p = ln.split()
                # POSIX df: Filesystem Size Used Avail Use% Mounted
                if len(p) < 6:
                    continue
                mount = p[-1]
                pct_field = p[-2]
                if any(mount == x or mount.startswith(x + "/") for x in ("/run", "/dev", "/sys", "/proc")):
                    continue
                try:
                    disks.append({"size": p[1], "used": p[2], "avail": p[3],
                                  "pct": int(pct_field.rstrip("%")), "mount": mount})
                except (ValueError, IndexError):
                    pass
        d["disks"] = disks

        # memory — Linux: free -m; macOS: vm_stat
        d["mem"] = {}
        rc, out, _ = _run(["free", "-m"])
        if rc == 0:
            for ln in out.splitlines():
                if ln.startswith("Mem:"):
                    p = ln.split()
                    if len(p) >= 7:
                        total, free, avail = int(p[1]), int(p[3]), int(p[6])
                        used = total - avail
                        d["mem"] = {
                            "total": f"{total // 1024}Gi",
                            "used": f"{used // 1024}Gi",
                            "available": f"{avail // 1024}Gi",
                            "free": f"{free // 1024}Gi",
                            "total_mb": total,
                            "used_mb": used,
                            "available_mb": avail,
                            "pct": round(used / total * 100) if total else 0,
                        }
        if not d["mem"]:
            # macOS fallback via vm_stat
            rc, out, _ = _run(["vm_stat"])
            if rc == 0:
                page_size = 4096
                stats: dict[str, int] = {}
                for ln in out.splitlines():
                    if ":" in ln:
                        k, _, v = ln.partition(":")
                        try:
                            stats[k.strip()] = int(v.strip().rstrip("."))
                        except ValueError:
                            pass
                wired = stats.get("Pages wired down", 0)
                active = stats.get("Pages active", 0)
                inactive = stats.get("Pages inactive", 0)
                free_pages = stats.get("Pages free", 0)
                total_pages = wired + active + inactive + free_pages
                if total_pages:
                    total_mb = total_pages * page_size // (1024 * 1024)
                    used_mb = (wired + active) * page_size // (1024 * 1024)
                    avail_mb = (inactive + free_pages) * page_size // (1024 * 1024)
                    d["mem"] = {
                        "total": f"{total_mb // 1024}Gi",
                        "used": f"{used_mb // 1024}Gi",
                        "available": f"{avail_mb // 1024}Gi",
                        "free": f"{free_pages * page_size // (1024 * 1024) // 1024}Gi",
                        "total_mb": total_mb,
                        "used_mb": used_mb,
                        "available_mb": avail_mb,
                        "pct": round(used_mb / total_mb * 100) if total_mb else 0,
                    }

        # uptime / load average
        rc, out, _ = _run(["uptime"])
        d["uptime"] = out.strip() if rc == 0 else ""

        # logged-in users (who)
        rc, out, _ = _run(["who"])
        logins = []
        if rc == 0:
            for ln in out.splitlines():
                p = ln.split(None, 4)
                if len(p) >= 4:
                    logins.append({
                        "user":  p[0],
                        "tty":   p[1],
                        "since": f"{p[2]} {p[3]}",
                        "from":  p[4].strip("() ") if len(p) > 4 else "",
                    })
        d["logins"] = logins

        with _lock:
            _prev = {"run": run, "pnd": pnd}
            _cache.clear()
            _cache.update(d)
        time.sleep(5)
