"""
Reusable SLURM logic, parsers, and plots without Streamlit.

Configuration: SLURM_MONITOR_* variables, with APUANA_MONITOR_* fallback.
"""

from __future__ import annotations

import io
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Protocol

import matplotlib.pyplot as plt
import pandas as pd
import seaborn as sns

DASHBOARD_DIR = Path(__file__).resolve().parent


def infer_repo_root(dashboard: Path) -> Path:
    """
    Return the project root when the dashboard is embedded in a larger repo.
    If this module is copied alone, return `dashboard`.
    """
    cand = dashboard.parent.parent
    if (cand / "mmsegmentation").is_dir() or (cand / "evaluation").is_dir():
        return cand
    return dashboard


REPO_ROOT = infer_repo_root(DASHBOARD_DIR)

JOB_ID_RE = re.compile(r"^(\d+)(\.(batch|\d+))?$")

T_FAST = 5.0
T_SRUN = 6.0
T_TAIL = 4.0


@dataclass
class CmdResult:
    code: int
    stdout: str
    stderr: str

    @property
    def ok(self) -> bool:
        return self.code == 0


@dataclass(frozen=True)
class HealthCheck:
    name: str
    status: str
    summary: str
    detail: str = ""


class CommandRunner(Protocol):
    def run(self, cmd: list[str], timeout: float = T_FAST) -> CmdResult:
        ...


class SubprocessCommandRunner:
    """Small boundary around subprocess so Slurm wrappers stay testable."""

    def run(self, cmd: list[str], timeout: float = T_FAST) -> CmdResult:
        try:
            p = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
            )
            return CmdResult(p.returncode, p.stdout or "", p.stderr or "")
        except FileNotFoundError:
            return CmdResult(127, "", f"command not found: {cmd[0]}")
        except subprocess.TimeoutExpired:
            return CmdResult(124, "", "timeout")


DEFAULT_RUNNER = SubprocessCommandRunner()


def run_command(
    cmd: list[str],
    timeout: float = T_FAST,
    runner: Optional[CommandRunner] = None,
) -> CmdResult:
    active_runner = runner or DEFAULT_RUNNER
    return active_runner.run(cmd, timeout=timeout)


def _run(cmd: list[str], timeout: float = T_FAST) -> CmdResult:
    return run_command(cmd, timeout=timeout)


def _user() -> str:
    return os.environ.get("USER") or os.environ.get("LOGNAME") or "unknown"


def env_monitor(key: str, default: str = "") -> str:
    """
    Read generic environment variables with legacy-name fallback.

    Order: SLURM_MONITOR_<KEY> -> APUANA_MONITOR_<KEY> -> default.
    """
    sl = os.environ.get(f"SLURM_MONITOR_{key}")
    if sl is not None and str(sl).strip() != "":
        return str(sl)
    leg = os.environ.get(f"APUANA_MONITOR_{key}")
    if leg is not None and str(leg).strip() != "":
        return str(leg)
    return default


def path_under(parent: Path, child: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def allowed_log_roots() -> list[Path]:
    roots: list[Path] = [Path.home().resolve(), REPO_ROOT.resolve()]
    for extra in ("/scratch", "/data", "/tmp"):
        p = Path(extra)
        try:
            if p.is_dir():
                roots.append(p.resolve())
        except OSError:
            continue
    raw = env_monitor("LOG_ALLOW_PREFIXES", "")
    for part in raw.split(":"):
        part = part.strip()
        if not part:
            continue
        try:
            roots.append(Path(part).expanduser().resolve())
        except OSError:
            continue
    seen: set[str] = set()
    out: list[Path] = []
    for r in roots:
        k = str(r)
        if k not in seen:
            seen.add(k)
            out.append(r)
    return out


def validate_log_path(raw: str) -> tuple[Optional[Path], str]:
    if not raw.strip():
        return None, "Empty path."
    expanded = Path(raw).expanduser()
    try:
        resolved = expanded.resolve()
    except OSError as e:
        return None, str(e)
    for root in allowed_log_roots():
        if path_under(root, resolved):
            return resolved, ""
    return (
        None,
        "Path is not allowed. Use $HOME, the repo root, /scratch, /data, /tmp, "
        "or set SLURM_MONITOR_LOG_ALLOW_PREFIXES "
        "(or legacy APUANA_MONITOR_LOG_ALLOW_PREFIXES) as a ':'-separated prefix list.",
    )


def normalize_job_id(raw: str) -> Optional[str]:
    s = raw.strip().split()[0] if raw.strip() else ""
    if not s:
        return None
    if not JOB_ID_RE.match(s):
        return None
    return s


def job_base_id(jid: str) -> str:
    return jid.split(".", 1)[0]


def human_slurm_failure(stderr: str, stdout: str) -> str:
    blob = (stderr + stdout).lower()
    if "connection refused" in blob or "slurm_persist" in blob:
        return (
            "Could not connect to a SLURM service, such as accounting/slurmdbd. "
            "Try another login node or check SLURM_CONF and SLURM environment variables."
        )
    if "timeout" in blob or "timed out" in blob:
        return "Timed out while talking to SLURM. The cluster may be overloaded."
    if "invalid job id" in blob or ("invalid" in blob and "job" in blob):
        return "Invalid JobID, or the job has already expired from the controller."
    if "access" in blob or "permission" in blob:
        return "Missing permission for this command or job information."
    return "The SLURM command returned an error. See technical details below."


def accounting_failed(stderr: str, stdout: str) -> bool:
    blob = (stderr + stdout).lower()
    return "connection refused" in blob or "slurm_persist" in blob


def health_from_result(
    name: str,
    result: CmdResult,
    ok_summary: str,
    unavailable_summary: str,
) -> HealthCheck:
    if result.code == 0:
        return HealthCheck(name, "ok", ok_summary, (result.stdout or result.stderr)[:2000])
    if result.code == 124:
        return HealthCheck(
            name,
            "degraded",
            "timeout while querying component",
            result.stderr or result.stdout,
        )
    if result.code == 127:
        return HealthCheck(name, "unavailable", unavailable_summary, result.stderr)
    return HealthCheck(
        name,
        "degraded",
        human_slurm_failure(result.stderr, result.stdout),
        (result.stderr or result.stdout)[:2000],
    )


def cluster_health_snapshot(user: str) -> list[HealthCheck]:
    checks: list[HealthCheck] = [
        HealthCheck("Login", "ok", f"{os.uname().nodename} responds", env_block_compact()),
    ]

    sq = CmdResult(*run_squeue_user(user))
    checks.append(
        health_from_result(
            "Queue",
            sq,
            "squeue responded for the user",
            "squeue was not found on this node",
        )
    )

    si = CmdResult(*run_sinfo())
    checks.append(
        health_from_result(
            "Partitions",
            si,
            "sinfo responded",
            "sinfo was not found on this node",
        )
    )

    acct = CmdResult(*run_sacct_ping(user))
    if acct.code == 0 and not accounting_failed(acct.stderr, acct.stdout):
        checks.append(HealthCheck("Accounting", "ok", "sacct responded", acct.stdout[:2000]))
    elif accounting_failed(acct.stderr, acct.stdout):
        checks.append(
            HealthCheck(
                "Accounting",
                "degraded",
                "sacct/slurmdbd unavailable; history should degrade with a warning",
                (acct.stderr or acct.stdout)[:2000],
            )
        )
    else:
        checks.append(
            health_from_result(
                "Accounting",
                acct,
                "sacct responded",
                "sacct was not found on this node",
            )
        )

    gpu = nvsmi_query()
    if gpu.ok and gpu.stdout.strip():
        checks.append(HealthCheck("GPU login", "ok", "nvidia-smi responded", gpu.stdout[:2000]))
    else:
        checks.append(
            HealthCheck(
                "GPU login",
                "degraded",
                "GPU is not visible on the login node; use srun when there is a GPU job",
                (gpu.stderr or gpu.stdout)[:2000],
            )
        )
    return checks


def run_squeue_user(user: str) -> tuple[int, str, str]:
    fmt = "%.18i %.12P %.22j %.8u %.2t %.12M %.12l %.6D %R"
    r = _run(["squeue", "-u", user, "-o", fmt], timeout=T_FAST)
    return r.code, r.stdout, r.stderr


def run_squeue_global(max_lines: int) -> tuple[int, str, str]:
    fmt = "%.18i %.12P %.18j %.8u %.2t %.12M %.12l %.6D %R"
    r = _run(["squeue", "-o", fmt], timeout=T_FAST)
    if r.code != 0 or not r.stdout.strip():
        return r.code, r.stdout, r.stderr
    lines = r.stdout.strip().splitlines()
    if len(lines) < 2:
        return r.code, r.stdout, r.stderr
    header, body = lines[0], lines[1 : 1 + max(0, int(max_lines))]
    out = "\n".join([header] + body)
    return r.code, out, r.stderr


def run_squeue_users_raw() -> tuple[int, str, str]:
    r = _run(["squeue", "-h", "-o", "%u"], timeout=T_FAST)
    return r.code, r.stdout, r.stderr


def run_sinfo() -> tuple[int, str, str]:
    r = _run(["sinfo"], timeout=T_FAST)
    return r.code, r.stdout, r.stderr


def run_sacct_user(user: str, hours: int, max_lines: int) -> tuple[int, str, str]:
    since = (datetime.now() - timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M")
    fmt = "JobID,JobName%20,Partition,State,ExitCode,Elapsed,MaxRSS,AllocTRES%40,NodeList%22"
    r = _run(
        [
            "sacct",
            "-u",
            user,
            "--starttime",
            since,
            "--format",
            fmt,
            "-n",
            str(max_lines),
            "-X",
            "--parsable2",
        ],
        timeout=T_FAST,
    )
    return r.code, r.stdout, r.stderr


def run_sacct_job(job_id: str, max_lines: int) -> tuple[int, str, str]:
    fmt = "JobID,JobName%20,Partition,State,ExitCode,Elapsed,MaxRSS,AllocTRES%40,NodeList%22"
    r = _run(
        [
            "sacct",
            "-j",
            job_id,
            "--format",
            fmt,
            "-n",
            str(max_lines),
            "-X",
            "--parsable2",
        ],
        timeout=T_FAST,
    )
    return r.code, r.stdout, r.stderr


def run_sacct_ping(user: str) -> tuple[int, str, str]:
    """Minimal accounting query for the dashboard health check."""
    r = _run(
        ["sacct", "-u", user, "-n", "3", "-X", "--format=JobID,State", "--parsable2"],
        timeout=T_FAST,
    )
    return r.code, r.stdout, r.stderr


def run_scontrol(job_id: str) -> tuple[int, str, str]:
    base = job_base_id(job_id)
    r = _run(["scontrol", "show", "job", base], timeout=T_FAST)
    return r.code, r.stdout, r.stderr


def run_sstat(job_id: str) -> tuple[int, str, str]:
    """
    Runtime job statistics (sstat): MaxRSS, AveCPU, etc.
    Only works with RUNNING jobs.
    """
    base = job_base_id(job_id)
    fmt = "JobID,MaxRSS,AveCPU,AvePages,AveVMSize"
    r = _run(["sstat", "-j", base, "--format", fmt, "--parsable"], timeout=T_FAST)
    return r.code, r.stdout, r.stderr


def run_seff(job_id: str) -> tuple[int, str, str]:
    """
    Job efficiency (seff): CPU and memory usage percentages.
    Requires a completed or running job.
    """
    base = job_base_id(job_id)
    r = _run(["seff", base], timeout=T_FAST)
    return r.code, r.stdout, r.stderr


def run_sprio(user: str) -> tuple[int, str, str]:
    """Priority for pending jobs in the queue."""
    r = _run(["sprio", "-u", user], timeout=T_FAST)
    return r.code, r.stdout, r.stderr


def run_scontrol_nodes() -> tuple[int, str, str]:
    """Complete information for all cluster nodes."""
    r = _run(["scontrol", "show", "nodes"], timeout=10.0)
    return r.code, r.stdout, r.stderr


def run_scontrol_partitions() -> tuple[int, str, str]:
    """Complete information for all partitions: limits, QoS, etc."""
    r = _run(["scontrol", "show", "partition"], timeout=T_FAST)
    return r.code, r.stdout, r.stderr


def parse_squeue_table(out: str) -> tuple[list[str], list[list[str]]]:
    lines = [ln for ln in out.strip().splitlines() if ln.strip()]
    if len(lines) < 2:
        return [], []
    header = lines[0].split()
    rows = []
    for ln in lines[1:]:
        parts = ln.split(None, len(header) - 1)
        if len(parts) < len(header):
            parts = parts + [""] * (len(header) - len(parts))
        rows.append(parts[: len(header)])
    return header, rows


def squeue_to_df(out: str) -> pd.DataFrame:
    header, rows = parse_squeue_table(out)
    if not header:
        return pd.DataFrame()
    return pd.DataFrame(rows, columns=header)


def queue_running_pending(df: pd.DataFrame) -> tuple[int, int]:
    """
    Count jobs with ST (or S) equal to R and PD.
    """
    if df is None or df.empty:
        return 0, 0
    col = "ST" if "ST" in df.columns else ("S" if "S" in df.columns else None)
    if col is None:
        return 0, 0
    s = df[col].astype(str).str.strip().str.upper()
    return int((s == "R").sum()), int((s == "PD").sum())


def sacct_problem_job_count(df: pd.DataFrame) -> int:
    """
    Jobs with problematic sacct states.
    Excludes .batch and .extern rows to avoid duplicates.
    """
    if df is None or df.empty:
        return 0
    st_col = next((c for c in df.columns if str(c).lower() == "state"), None)
    jid_col = next((c for c in df.columns if str(c).lower() == "jobid"), None)
    if st_col is None:
        return 0
    bad = 0
    for _, row in df.iterrows():
        if jid_col is not None:
            jid = str(row[jid_col]).strip()
            if ".batch" in jid or ".extern" in jid:
                continue
        state = str(row[st_col]).strip().upper()
        token = state.split()[0] if state else ""
        if token in (
            "FAILED",
            "CANCELLED",
            "TIMEOUT",
            "OUT_OF_MEMORY",
            "NODE_FAIL",
            "PREEMPTED",
        ):
            bad += 1
            continue
        if token.startswith("CANCELLED"):
            bad += 1
            continue
        if "OUT_OF_MEMORY" in state or "OOM" in state:
            bad += 1
    return bad


def parse_nvsmi_noheader(text: str) -> pd.DataFrame:
    cols = ["index", "name", "util_gpu", "mem_used", "mem_total", "temp_gpu"]
    rows: list[list[str]] = []
    for ln in text.strip().splitlines():
        if not ln.strip():
            continue
        parts = [p.strip() for p in ln.split(",")]
        rows.append(parts)
    if not rows:
        return pd.DataFrame()
    ncol = max(len(r) for r in rows)
    for r in rows:
        while len(r) < ncol:
            r.append("")
    names = cols[:ncol]
    return pd.DataFrame(rows, columns=names)


def parse_sacct_parsable2(out: str) -> pd.DataFrame:
    lines = [ln for ln in out.strip().splitlines() if ln.strip()]
    if len(lines) < 2:
        return pd.DataFrame()
    header = lines[0].split("|")
    rows = []
    for ln in lines[1:]:
        rows.append(ln.split("|"))
    ncol = len(header)
    for r in rows:
        while len(r) < ncol:
            r.append("")
        r[:] = r[:ncol]
    return pd.DataFrame(rows, columns=header)


def newest_logs_in_dir(d: Path, pattern: str = "*.out", limit: int = 12) -> list[Path]:
    if not d.is_dir():
        return []
    paths = [p for p in d.glob(pattern) if p.is_file()]
    paths.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return paths[:limit]


def discover_log_candidates(limit: int = 40) -> list[Path]:
    found: list[Path] = []
    dirs: list[Path] = [Path.home(), REPO_ROOT]
    ev_logs = REPO_ROOT / "evaluation" / "logs"
    if ev_logs.is_dir():
        dirs.append(ev_logs)
    for raw in env_monitor("LOG_SCAN_DIRS", "").split(":"):
        raw = raw.strip()
        if raw:
            dirs.append(Path(raw).expanduser())
    seen: set[str] = set()
    for d in dirs:
        for p in newest_logs_in_dir(d, "*.out", 15):
            k = str(p.resolve())
            if k not in seen:
                seen.add(k)
                found.append(p)
    found.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return found[:limit]


def find_best_log_fallback(requested: str, extension: str = ".out") -> Optional[Path]:
    """
    If the requested log does not exist, return the newest available fallback.
    
    Search locations:
    - $HOME and common subdirectories: logs, slurm-logs, output, out, jobs
    - Repo root and evaluation/logs
    - Directories configured in SLURM_MONITOR_LOG_SCAN_DIRS
    
    Args:
        requested: requested path, which may not exist
        extension: desired extension, such as .out or .err
    
    Returns:
        Best matching file path, or None if no candidate exists.
    """
    req_path = Path(requested).expanduser()
    if req_path.exists() and req_path.is_file():
        return req_path
    
    # Base directories.
    dirs: list[Path] = [Path.home(), REPO_ROOT]
    
    # Common $HOME subdirectories where logs are often stored.
    home = Path.home()
    for subdir in ["logs", "slurm-logs", "slurm_logs", "output", "out", "jobs", "slurm", ".slurm"]:
        candidate = home / subdir
        if candidate.is_dir():
            dirs.append(candidate)
    
    # evaluation/logs is common in ML repositories.
    ev_logs = REPO_ROOT / "evaluation" / "logs"
    if ev_logs.is_dir():
        dirs.append(ev_logs)
    
    # User-configured directories.
    for raw in env_monitor("LOG_SCAN_DIRS", "").split(":"):
        raw = raw.strip()
        if raw:
            p = Path(raw).expanduser()
            if p.is_dir():
                dirs.append(p)
    
    pattern = f"*{extension}"
    candidates: list[Path] = []
    
    for d in dirs:
        if not d.is_dir():
            continue
        # Search the directory and one level below it.
        for p in d.glob(pattern):
            if p.is_file():
                candidates.append(p)
        for p in d.glob(f"*/{pattern}"):
            if p.is_file():
                candidates.append(p)
    
    if not candidates:
        return None
    
    # Return the newest candidate.
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0]


def active_users_from_squeue_stdout(stdout: str) -> list[str]:
    users = {ln.strip() for ln in stdout.splitlines() if ln.strip()}
    return sorted(users)


def nvsmi_query() -> CmdResult:
    q = "index,name,utilization.gpu,memory.used,memory.total,temperature.gpu"
    return _run(
        ["nvidia-smi", "--query-gpu=" + q, "--format=csv,noheader,nounits"],
        timeout=T_FAST,
    )


def nvsmi_query_srun(job_base: str) -> CmdResult:
    q = "index,name,utilization.gpu,memory.used,memory.total,temperature.gpu"
    return _run(
        [
            "srun",
            f"--jobid={job_base}",
            "--immediate=1",
            "nvidia-smi",
            "--query-gpu=" + q,
            "--format=csv,noheader,nounits",
        ],
        timeout=T_SRUN,
    )


def nvsmi_raw() -> CmdResult:
    return _run(["nvidia-smi"], timeout=T_FAST)


def ps_mem_snapshot() -> CmdResult:
    return _run(["ps", "aux", "--sort=-%mem"], timeout=T_FAST)


def ps_aux_to_dataframe(text: str, max_rows: int = 200) -> pd.DataFrame:
    lines = [ln for ln in text.strip().splitlines() if ln.strip()]
    if len(lines) < 2:
        return pd.DataFrame()
    cols = [
        "USER",
        "PID",
        "%CPU",
        "%MEM",
        "VSZ",
        "RSS",
        "TTY",
        "STAT",
        "START",
        "TIME",
        "COMMAND",
    ]
    rows: list[list[str]] = []
    for ln in lines[1:]:
        parts = ln.split(None, 10)
        if len(parts) < 11:
            continue
        rows.append(parts)
        if len(rows) >= max_rows:
            break
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows, columns=cols)
    for c in ("%CPU", "%MEM", "PID", "VSZ", "RSS"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def top_snapshot() -> CmdResult:
    return _run(["top", "-bn1"], timeout=T_FAST)


def run_tail(path: str, n_lines: int) -> CmdResult:
    return _run(["tail", "-n", str(int(n_lines)), path], timeout=T_TAIL)


def gpu_context_snapshot_text(user: str) -> str:
    """One-shot equivalent of watch_gpu_context.sh with srun --immediate=1."""
    lines: list[str] = []
    jid = ""
    r = _run(["squeue", "-u", user, "-h", "-t", "R,CG", "-o", "%i"], timeout=T_FAST)
    if r.ok and r.stdout.strip():
        jid = r.stdout.strip().splitlines()[0].strip()
    if not jid:
        r2 = _run(["squeue", "-u", user, "-h", "-t", "PD", "-o", "%i"], timeout=T_FAST)
        if r2.ok and r2.stdout.strip():
            jid = r2.stdout.strip().splitlines()[0].strip()
    lines.append(f"User={user} highlighted_job={jid or '<none>'}")
    lines.append("-" * 60)
    if jid:
        base = job_base_id(jid)
        sc_r = _run(["scontrol", "show", "job", base], timeout=T_FAST)
        lines.append("scontrol show job (start):")
        lines.append((sc_r.stdout or sc_r.stderr)[:8000])
        lines.append("-" * 60)
        lines.append("nvidia-smi (srun --immediate=1):")
        nv = nvsmi_query_srun(base)
        lines.append((nv.stdout or nv.stderr or "(no output)")[:12000])
    else:
        si = _run(["sinfo", "-s"], timeout=T_FAST)
        lines.append("sinfo -s:")
        lines.append((si.stdout or si.stderr or "(no sinfo output)")[:8000])
    return "\n".join(lines)


def painel_like_snapshot(
    user: str,
    log_out_raw: str,
    log_err_raw: str,
    tail_n: int,
    sacct_hours: int,
    sacct_n: int,
    skip_sacct: bool,
) -> dict[str, tuple[bool, str]]:
    """
    One pass through the four tmux-panel quadrants: queue, logs, GPU, sacct.
    Values are keyed as (ok, display_text).
    """
    out: dict[str, tuple[bool, str]] = {}
    c, o, e = run_squeue_user(user)
    queue_text = (o or "") + (("\n" + e) if e else "")
    out["queue"] = (c == 0, queue_text if queue_text.strip() else "(empty)")

    log_chunks: list[str] = []
    for label, raw in (("stdout", log_out_raw), ("stderr", log_err_raw)):
        p, msg = validate_log_path(raw)
        if p is None:
            log_chunks.append(f"=== {label} ===\n{msg}")
            continue
        if not p.is_file():
            log_chunks.append(f"=== {label} {p} ===\n(file does not exist yet)")
            continue
        t = run_tail(str(p), tail_n)
        log_chunks.append(
            f"=== {label} {p} ===\n" + (t.stdout if t.ok else t.stderr or "(tail error)")
        )
    out["logs"] = (True, "\n\n".join(log_chunks))

    out["gpu"] = (True, gpu_context_snapshot_text(user))

    if skip_sacct:
        out["sacct"] = (
            True,
            "(sacct skipped: accounting is unavailable on this login node.)\n"
            "Use another login node or see the warning at the top of the page.",
        )
    else:
        cs, os_, es = run_sacct_user(user, sacct_hours, sacct_n)
        ok = cs == 0 and not accounting_failed(es, os_)
        body = (os_ or "") if ok else ""
        if es:
            body = body + ("\n--- stderr ---\n" + es if body else es)
        out["sacct"] = (ok, body if body.strip() else "(empty or error; see stderr details if present)")
    return out


def ps_via_srun(job_base: str) -> CmdResult:
    return _run(
        ["srun", f"--jobid={job_base}", "--immediate=1", "ps", "aux", "--sort=-%mem"],
        timeout=T_SRUN,
    )


def env_block_compact() -> str:
    return (
        f"Python: {sys.executable}\n"
        f"Version: {sys.version.splitlines()[0]}\n"
        f"Venv: {os.environ.get('VIRTUAL_ENV', '-')}\n"
        f"Conda: {os.environ.get('CONDA_PREFIX', '-')}\n"
        f"Host: {os.uname().nodename}\n"
        f"Dashboard: {DASHBOARD_DIR}\n"
        f"Repo: {REPO_ROOT}"
    )


def build_diag_text(sacct_hint: str) -> str:
    full = [
        env_block_compact(),
        "",
        f"SLURM_CONF={os.environ.get('SLURM_CONF', '')}",
        f"CUDA_VISIBLE_DEVICES={os.environ.get('CUDA_VISIBLE_DEVICES', '')}",
    ]
    if sacct_hint:
        full.extend(["", "--- last sacct stderr ---", sacct_hint[:4000]])
    return "\n".join(full)


def effective_job_id(job_source: str, pick: str, manual: str) -> Optional[str]:
    if job_source == "Manual":
        return normalize_job_id(manual) if manual.strip() else None
    return normalize_job_id(pick) if pick.strip() else None


def partition_idle_series(sinfo_df: pd.DataFrame) -> tuple[list[str], list[float]]:
    if sinfo_df is None or sinfo_df.empty or sinfo_df.shape[1] < 2:
        return [], []
    aio_col = None
    for c in sinfo_df.columns:
        v = str(sinfo_df[c].iloc[0]) if len(sinfo_df) else ""
        if re.match(r"^\d+/\d+/\d+/\d+$", v.strip()):
            aio_col = c
            break
    if aio_col is None:
        return [], []
    part_col = sinfo_df.columns[0]
    parts: list[str] = []
    idle_frac: list[float] = []
    for _, row in sinfo_df.head(24).iterrows():
        f = str(row[aio_col])
        m = re.match(r"(\d+)/(\d+)/(\d+)/(\d+)", f)
        if not m:
            continue
        _a, i, _o, t = map(int, m.groups())
        if t <= 0:
            continue
        parts.append(str(row[part_col])[:22])
        idle_frac.append(i / t)
    return parts, idle_frac


def plot_gpu_util(df: pd.DataFrame, title: str):
    if df is None or df.empty or df.shape[1] < 3:
        return None
    fig, ax = plt.subplots(figsize=(7, 3))
    try:
        util_col = "util_gpu" if "util_gpu" in df.columns else df.columns[2]
        name_col = "name" if "name" in df.columns else df.columns[1]
        util = pd.to_numeric(df[util_col], errors="coerce").fillna(0)
        names = df[name_col].astype(str)
        colors = sns.color_palette("husl", n_colors=max(1, len(names)))
        ax.barh(names, util, color=colors)
        ax.set_xlabel("GPU util (%)")
        ax.set_title(title)
        ax.set_xlim(0, 100)
        fig.patch.set_facecolor("#0e1117")
        ax.set_facecolor("#161b22")
        ax.tick_params(colors="#e6edf3")
        ax.xaxis.label.set_color("#e6edf3")
        ax.title.set_color("#e6edf3")
    except Exception:
        plt.close(fig)
        return None
    fig.tight_layout()
    return fig


def plot_partition_idle(sinfo_df: pd.DataFrame, title: str):
    parts, idle_frac = partition_idle_series(sinfo_df)
    if not parts:
        return None
    fig, ax = plt.subplots(figsize=(7, max(2.5, 0.25 * len(parts))))
    colors = sns.color_palette("crest", n_colors=max(1, len(parts)))
    ax.barh(parts, idle_frac, color=colors)
    ax.set_xlabel("Fracao idle (I/T)")
    ax.set_title(title)
    ax.set_xlim(0, 1)
    fig.patch.set_facecolor("#0e1117")
    ax.set_facecolor("#161b22")
    ax.tick_params(colors="#e6edf3")
    ax.xaxis.label.set_color("#e6edf3")
    ax.title.set_color("#e6edf3")
    fig.tight_layout()
    return fig


def plot_partition_heatmap(sinfo_df: pd.DataFrame, title: str):
    """1 x N partition heatmap for small partition tables."""
    parts, idle_frac = partition_idle_series(sinfo_df)
    if len(parts) < 2 or len(parts) > 20:
        return None
    fig, ax = plt.subplots(figsize=(max(6, 0.35 * len(parts)), 2.2))
    try:
        mat = pd.DataFrame([idle_frac], columns=parts)
        sns.heatmap(
            mat,
            ax=ax,
            cmap="viridis",
            vmin=0,
            vmax=1,
            cbar_kws={"label": "Idle I/T"},
            annot=True,
            fmt=".2f",
        )
        ax.set_title(title)
        ax.set_ylabel("")
        fig.patch.set_facecolor("#0e1117")
    except Exception:
        plt.close(fig)
        return None
    fig.tight_layout()
    return fig


def _self_tests() -> None:
    class FakeRunner:
        def __init__(self) -> None:
            self.calls: list[tuple[list[str], float]] = []

        def run(self, cmd: list[str], timeout: float = T_FAST) -> CmdResult:
            self.calls.append((cmd, timeout))
            return CmdResult(0, "ok", "")

    fake = FakeRunner()
    rc = run_command(["squeue", "-u", "u1"], timeout=1.25, runner=fake)
    assert rc.ok and rc.stdout == "ok"
    assert fake.calls == [(["squeue", "-u", "u1"], 1.25)]

    ps_out = """USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root         1  0.0  0.0 123456 7890 ?        Ss   Apr01   0:01 /sbin/init
user      9999 10.5  2.0 200000 50000 pts/0   Sl+  10:00   0:10 python train.py --epochs 1
"""
    dfp = ps_aux_to_dataframe(ps_out, max_rows=10)
    assert len(dfp) == 2
    assert dfp["PID"].iloc[1] == 9999

    sacct_out = "JobID|State\n12345|COMPLETED\n12345.batch|COMPLETED\n"
    dfa = parse_sacct_parsable2(sacct_out)
    assert "JobID" in dfa.columns
    assert len(dfa) == 2

    sq = "JOBID PARTITION NAME USER ST TIME\n123 debug j1 u1 R 0:01\n"
    dfq = squeue_to_df(sq)
    assert not dfq.empty
    r, p = queue_running_pending(dfq)
    assert r == 1 and p == 0

    sacct_mix = (
        "JobID|State|JobName\n"
        "100|FAILED|jbad\n"
        "100.batch|FAILED|jbad\n"
        "101|COMPLETED|jok\n"
    )
    dfb = parse_sacct_parsable2(sacct_mix)
    assert sacct_problem_job_count(dfb) == 1

    parts, fr = partition_idle_series(
        pd.DataFrame(
            {
                "PARTITION": ["p1", "p2"],
                "NODES": ["1/1/0/2", "0/2/0/2"],
            }
        )
    )
    assert len(parts) == 2 and fr[0] == 0.5

    os.environ["SLURM_MONITOR__TESTKEY"] = "slurm-wins"
    os.environ["APUANA_MONITOR__TESTKEY"] = "legacy"
    assert env_monitor("_TESTKEY", "d") == "slurm-wins"
    del os.environ["SLURM_MONITOR__TESTKEY"]
    assert env_monitor("_TESTKEY", "d") == "legacy"
    del os.environ["APUANA_MONITOR__TESTKEY"]
    assert env_monitor("_TESTKEY", "d") == "d"

    ok_h = health_from_result("Queue", CmdResult(0, "jobs", ""), "ok", "missing")
    assert ok_h.status == "ok" and ok_h.summary == "ok"
    timeout_h = health_from_result("Queue", CmdResult(124, "", "timeout"), "ok", "missing")
    assert timeout_h.status == "degraded"
    missing_h = health_from_result("Queue", CmdResult(127, "", "command not found"), "ok", "missing")
    assert missing_h.status == "unavailable"


if __name__ == "__main__":
    _self_tests()
    print("slurm_core: self-tests OK")
