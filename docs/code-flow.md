# Code Flow

This document explains the current project flow in execution order. It is meant
for contributors who need to understand where a change belongs before editing
the monitor.

## 1. User Entry Point

Most users start in `apuana/run_slurm_monitor.sh`.

The script accepts three modes:

| Mode | What happens |
| --- | --- |
| default / `--web` | Creates or reuses the Python venv and starts Streamlit |
| `--painel` | Opens only the terminal tmux panel |
| `--tudo` / `--all` | Starts Streamlit in the background, then opens the tmux panel |

This file is the correct place for startup behavior: virtualenv checks,
dependency installation, Streamlit port selection, and mode routing.

## 2. Environment Resolution

`apuana/run_slurm_monitor.sh` sources `apuana/lib_env.sh`.

`lib_env.sh` defines the runtime configuration used by the shell scripts:

| Variable | Purpose |
| --- | --- |
| `MONITOR_PORT` | Streamlit port |
| `MONITOR_VENV` | Python virtualenv path |
| `MONITOR_SESSION` | tmux session name |
| `MONITOR_LOG_OUT` / `MONITOR_LOG_ERR` | log files followed by the panel |

The generic `SLURM_MONITOR_*` names are preferred. Legacy `APUANA_MONITOR_*`
names are still accepted so older usage does not break.

## 3. Streamlit Application

When web mode starts, Streamlit runs `apuana/app.py`.

`app.py` owns the user interface:

1. It sets page configuration and sidebar controls.
2. It renders the global Apuana queue first through `squeue`.
3. It builds tabs for overview, job details, GPU, logs, cluster state,
   processes, and advanced SLURM views.
4. It shows friendly errors when SLURM commands fail.

The app should not contain raw subprocess logic. It calls functions from
`slurm_core.py`, then renders their results.

## 4. SLURM Boundary

`apuana/slurm_core.py` is the reusable backend layer.

It is responsible for:

| Area | Examples |
| --- | --- |
| Command execution | `run_command`, `_run`, `SubprocessCommandRunner` |
| SLURM wrappers | `run_squeue_global`, `run_sacct_job`, `run_sinfo`, `run_scontrol` |
| Parsing | `parse_squeue_table`, `parse_sacct_parsable2`, `parse_nvsmi_noheader` |
| Safety | `normalize_job_id`, `validate_log_path`, `allowed_log_roots` |
| Diagnostics | `cluster_health_snapshot`, `build_diag_text`, `human_slurm_failure` |
| Charts | `plot_gpu_util`, `plot_partition_idle`, `plot_partition_heatmap` |

This is where command behavior should be changed. Because the command runner is
isolated, core behavior can be self-tested without launching Streamlit.

## 5. Accounting Behavior

The monitor tries to use `sacct` for history and per-job accounting, but it does
not require accounting to be available.

On the current Apuana login node, `sacct -j <JOB_ID>` fails because the SLURM
accounting service connection is refused. That is not an admin-only permission
failure. The app therefore keeps the `sacct` views but degrades gracefully when
accounting is unavailable.

If a future cluster disables `sacct` by policy, the same error boundary should
remain in `slurm_core.py` and the UI should continue to show live `squeue`
information.

## 6. Terminal Panel

`apuana/painel_slurm.sh` provides a tmux 2x2 operational view:

1. user queue through `squeue`
2. job logs through `tail_slurm_logs.sh`
3. GPU or node context through `watch_gpu_context.sh`
4. accounting history through `sacct`, when available

The panel is intentionally separate from Streamlit. It is useful when a browser
tunnel is not available or when the user only needs a terminal view.

## 7. Compatibility Files

These files exist only to preserve older command names:

| File | Delegates to |
| --- | --- |
| `run_apuana_monitor.sh` | `run_slurm_monitor.sh` |
| `painel_apuana.sh` | `painel_slurm.sh` |
| `tail_apuana_logs.sh` | `tail_slurm_logs.sh` |
| `dashboard_apuana.py` | `app.py` |

New code should target the `slurm_*` names.

## 8. Validation Flow

`scripts/validate_monitoring.sh` is the baseline validation gate.

It runs, in order:

1. Python version detection
2. shell syntax checks
3. Python syntax checks
4. `slurm_core.py` self-tests
5. import checks for `app.py` and `slurm_core.py`
6. live `squeue` and `sinfo`
7. a `sacct` smoke test with graceful warning behavior

Every feature should define how it will be validated before implementation, then
pass this script before it is accepted.

## 9. Where To Change Things

Use this routing rule before editing:

| Change type | File to edit |
| --- | --- |
| UI layout, labels, tabs, Streamlit state | `apuana/app.py` |
| SLURM command flags, parsing, error handling | `apuana/slurm_core.py` |
| startup, venv, Streamlit process behavior | `apuana/run_slurm_monitor.sh` |
| shared shell environment variables | `apuana/lib_env.sh` |
| terminal panel layout | `apuana/painel_slurm.sh` |
| validation gate | `scripts/validate_monitoring.sh` |
| user-facing usage instructions | `README.md` |
