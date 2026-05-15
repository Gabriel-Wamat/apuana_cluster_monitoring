# HPC - Apuana Monitor

Web dashboard and terminal panel for monitoring **Apuana/CIn-UFPE** through
SLURM. The project also works as a generic SLURM cluster monitor with optional
NVIDIA GPU visibility.

The system is designed to work for **any Apuana user**. It uses `$USER`, `$HOME`,
and `SLURM_MONITOR_*` environment variables; it does not depend on the `gwam`
account or on absolute paths from a specific home directory.

## Requirements

- Python 3.10+ on a login node
- SLURM commands: `squeue`, `sinfo`, `sacct`, `scontrol`, `srun`
- Optional: `nvidia-smi`, `tmux`, `bash`

## Quick Start On Apuana

From your local machine, connect to a login node:

```bash
ssh <USER>@slurm-client2.cin.ufpe.br
# or
ssh <USER>@slurm-client1.cin.ufpe.br
```

On Apuana, enter the project directory:

```bash
cd ~/monitoring/apuana
```

If the directory does not exist in your account yet, copy or clone this
repository to `~/monitoring` first. The dashboard does not require this exact
path, but the examples below assume `~/monitoring`.

Start the dashboard:

```bash
chmod +x run_slurm_monitor.sh painel_slurm.sh tail_slurm_logs.sh watch_gpu_context.sh
./run_slurm_monitor.sh
```

The script creates `.venv-monitor` inside `apuana/` by default, installs Python
dependencies when needed, and starts Streamlit on `http://127.0.0.1:8501`.

If another user is already using port `8501` on the same login node, choose a
different port:

```bash
SLURM_MONITOR_STREAMLIT_PORT=8502 ./run_slurm_monitor.sh
```

To keep the Python environment outside the repository:

```bash
SLURM_MONITOR_VENV="$HOME/.cache/apuana-monitor-venv" ./run_slurm_monitor.sh
```

If `.venv-monitor` was copied from another path or user and Streamlit fails with
`bad interpreter`, remove the stale venv or point to a fresh one:

```bash
rm -rf .venv-monitor
./run_slurm_monitor.sh
```

### SSH Tunnel For Browser Access

```bash
ssh -N -L 8501:localhost:8501 <USER>@slurm-client2.cin.ufpe.br
```

Open this URL in your local browser:

```text
http://localhost:8501
```

If you started the dashboard with another port, use that same port in the tunnel
and in the browser.

### tmux Panel

```bash
./run_slurm_monitor.sh --painel
# or
./painel_slurm.sh
```

The tmux panel shows four views: user queue, logs, GPU/context, and `sacct`.

### Validate The Project On Apuana

Before implementing or accepting any feature/refactor, run:

```bash
cd ~/monitoring
bash scripts/validate_monitoring.sh
```

This command validates shell syntax, Python imports, core self-tests, `squeue`,
`sinfo`, and the expected degraded behavior when `sacct` is unavailable.

Project rule: a feature only enters implementation after its acceptance criteria
and validation command are defined. The canonical validation command is
`bash scripts/validate_monitoring.sh`.

## Environment Variables

| Variable | Description |
| --- | --- |
| `SLURM_MONITOR_APP_TITLE` | Streamlit page title, default: `Slurm monitor` |
| `SLURM_MONITOR_DEFAULT_LOG_OUT` | Initial stdout log path suggested in the UI |
| `SLURM_MONITOR_LOG_SCAN_DIRS` | Extra directories for discovering `*.out` files, separated by `:` |
| `SLURM_MONITOR_LOG_ALLOW_PREFIXES` | Allowed path prefixes for log reads, in addition to `$HOME`, repo root, `/scratch`, `/data`, and `/tmp` |
| `SLURM_MONITOR_VENV` | Python virtualenv path |
| `SLURM_MONITOR_STREAMLIT_PORT` | Streamlit port, default: `8501` |
| `SLURM_MONITOR_SESSION` | tmux session name, default: `SlurmMonitor` |
| `SLURM_MONITOR_LOG_OUT` / `SLURM_MONITOR_LOG_ERR` | Log files followed by the tmux panel |
| `SLURM_MONITOR_SQUEUE_SEC` / `_GPU_SEC` / `_SACCT_SEC` / `_SACCT_LINES` | Panel refresh intervals and output size |

### Compatibility

Legacy `APUANA_MONITOR_*` variables remain accepted with the same suffixes.

The code lives in `monitoring/apuana/` for historical reasons. You can copy only
that directory into another repository or rename the local folder; the logic does
not depend on the name `apuana`.

## Structure

For a chronological explanation of how the code runs and how the files relate
to each other, see [`docs/code-flow.md`](docs/code-flow.md).

| File | Purpose |
| --- | --- |
| `app.py` | Main Streamlit application |
| `slurm_core.py` | SLURM commands, parsers, and plots; testable with `python slurm_core.py` |
| `run_slurm_monitor.sh` | Installs dependencies and starts Streamlit or the tmux panel |
| `painel_slurm.sh` | tmux 2x2 layout |
| `tail_slurm_logs.sh` | `tail` for `.out` / `.err` files |
| `watch_gpu_context.sh` | GPU/context view through `sinfo` or an active allocation |

`run_apuana_monitor.sh`, `painel_apuana.sh`, `tail_apuana_logs.sh`, and
`dashboard_apuana.py` are compatibility aliases.

## License And Contributions

Use and adapt this monitor for your computing center: adjust environment
variables, `srun` policies, and log paths. Pull requests are welcome to keep the
code site-agnostic, without hardcoded URLs or users.
