# HPC - Apuana Monitor

Monitoring tools for the Apuana SLURM cluster at CIn/UFPE.

The repository keeps two runnable interfaces:

- `apuana/streamlit_dashboard/` plus `apuana/bin/`: the existing Streamlit dashboard, terminal panel, and SLURM helper scripts.
- `apuana/http_dashboard/`: a zero-dependency HTTP dashboard with modular HTML, CSS, and JavaScript.

Both flows are designed for any Apuana user. They use `$USER`, `$HOME`, and
`SLURM_MONITOR_*` variables instead of hardcoded personal paths.

The files directly under `apuana/` are compatibility wrappers for older commands.
The implementation now lives in folders by responsibility.

## Run The Streamlit/Terminal Monitor

```bash
ssh <USER>@slurm-client2.cin.ufpe.br
cd ~/monitoring/apuana
chmod +x run_slurm_monitor.sh painel_slurm.sh tail_slurm_logs.sh watch_gpu_context.sh
./run_slurm_monitor.sh
```

Equivalent direct command:

```bash
./bin/run_slurm_monitor.sh
```

Optional terminal panel:

```bash
./painel_slurm.sh
```

Open the Streamlit dashboard locally through an SSH tunnel:

```bash
ssh -N -L 8501:localhost:8501 <USER>@slurm-client2.cin.ufpe.br
```

Then open:

```text
http://localhost:8501
```

## Run The Modular HTTP Dashboard

This interface uses only Python's standard library. It does not require
Streamlit, Node, or Python package installation.

```bash
ssh <USER>@slurm-client2.cin.ufpe.br
cd ~/monitoring/apuana/http_dashboard
chmod +x run.sh
./run.sh
```

Use another port if needed:

```bash
SLURM_MONITOR_PORT=8502 ./run.sh
```

Create the matching local tunnel:

```bash
ssh -N -L 8502:localhost:8502 <USER>@slurm-client2.cin.ufpe.br
```

## File Transfer Helper

The HTTP dashboard includes a Transfer view that captures the current Apuana
user and generates `rsync -avzP` commands.

Download from Apuana to your local machine:

```bash
rsync -avzP <USER>@slurm-client1.cin.ufpe.br:<REMOTE_PATH> <LOCAL_PATH>
```

Upload a local folder to Apuana:

```bash
rsync -avzP ~/Documents/my_project/ <USER>@slurm-client1.cin.ufpe.br:/home/CIN/<USER>/project/
```

Run generated `rsync` commands on your local machine. The dashboard does not
execute transfers from the login node because local paths exist on the user's
computer, not on Apuana.

## Project Layout

```text
.
|-- README.md
|-- apuana/
|   |-- app.py                         # compatibility wrapper
|   |-- run_slurm_monitor.sh           # compatibility wrapper
|   |-- painel_slurm.sh                # compatibility wrapper
|   |-- bin/
|   |   |-- run_slurm_monitor.sh        # Streamlit launcher
|   |   |-- painel_slurm.sh             # tmux panel
|   |   |-- snapshot_apuana.sh          # one-shot SLURM/system snapshot
|   |   |-- tail_slurm_logs.sh          # log tail helper
|   |   `-- watch_gpu_context.sh        # GPU/context helper
|   |-- lib/
|   |   `-- lib_env.sh                  # shared shell environment defaults
|   |-- streamlit_dashboard/
|   |   |-- app.py                      # Streamlit UI
|   |   |-- dashboard_apuana.py         # legacy Python dashboard entrypoint
|   |   |-- slurm_core.py               # reusable SLURM logic and parsers
|   |   `-- requirements.txt            # Streamlit dashboard dependencies
|   `-- http_dashboard/
|       |-- server.py                   # stdlib HTTP server and API
|       |-- run.sh                      # HTTP dashboard launcher
|       `-- static/
|           |-- index.html              # page structure
|           |-- scripts/
|           |   `-- app.js              # browser behavior
|           `-- styles/
|               `-- app.css             # visual system
`-- scripts/
    `-- validate_monitoring.sh
```

## Validation

Run validation on an Apuana login node:

```bash
bash scripts/validate_monitoring.sh
```

The validator checks shell syntax, Python syntax, the existing Streamlit core,
the modular HTTP dashboard, live `squeue`/`sinfo`, graceful `sacct` degradation,
and HTTP endpoints for `/api`, `/api/fs`, CSS, and JavaScript assets.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `SLURM_MONITOR_PORT` | `8501` | HTTP dashboard port |
| `SLURM_MONITOR_PYTHON` | `python3` | Python executable |
| `SLURM_MONITOR_TRANSFER_HOST` | `slurm-client1.cin.ufpe.br` | Host used in generated `rsync` commands |
| `SLURM_MONITOR_STREAMLIT_PORT` | `8501` | Streamlit port fallback |

Legacy `APUANA_MONITOR_*` variables remain accepted where supported.
