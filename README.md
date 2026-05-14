# Slurm monitor (Streamlit + tmux)

Dashboard web e painel de terminal para **clusters Slurm** com GPU NVIDIA opcional. Pensado para correr num **nó de login** (onde existem `squeue`, `sacct`, `srun`, etc.).

## Requisitos

- Python 3.10+ (no nó de login)
- `slurm-client` / comandos: `squeue`, `sinfo`, `sacct`, `scontrol`, `srun`
- Opcional: `nvidia-smi`, `tmux`, `bash`

## Arranque rápido

```bash
cd monitoring/apuana
chmod +x run_slurm_monitor.sh painel_slurm.sh tail_slurm_logs.sh watch_gpu_context.sh
./run_slurm_monitor.sh
```

Ou, a partir da raiz de um clone deste repositório:

```bash
chmod +x run_slurm_monitor.sh
./run_slurm_monitor.sh
```

O script cria `.venv-monitor` (ou o caminho em `SLURM_MONITOR_VENV`) e abre o Streamlit em `http://127.0.0.1:8501` por defeito.

### Túnel SSH (desde o portátil)

```bash
ssh -N -L 8501:localhost:8501 USER@LOGIN_NODE
```

Abra no browser: `http://localhost:8501`.

### Painel tmux (4 painéis: fila, logs, GPU, sacct)

```bash
./run_slurm_monitor.sh --painel
# ou
./painel_slurm.sh
```

## Variáveis de ambiente (prefixo `SLURM_MONITOR_`)


| Variável                                                                | Descrição                                                                                                        |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `SLURM_MONITOR_APP_TITLE`                                               | Título da página Streamlit (defeito: *Slurm monitor*)                                                            |
| `SLURM_MONITOR_DEFAULT_LOG_OUT`                                         | Caminho inicial sugerido para stdout do job na UI                                                                |
| `SLURM_MONITOR_LOG_SCAN_DIRS`                                           | Pastas extra para descobrir ficheiros `*.out` (separadas por `:`)                                                |
| `SLURM_MONITOR_LOG_ALLOW_PREFIXES`                                      | Prefixos de caminho permitidos para leitura de logs (além de `$HOME`, raiz do repo, `/scratch`, `/data`, `/tmp`) |
| `SLURM_MONITOR_VENV`                                                    | Caminho do virtualenv Python                                                                                     |
| `SLURM_MONITOR_STREAMLIT_PORT`                                          | Porta do Streamlit (defeito: 8501)                                                                               |
| `SLURM_MONITOR_SESSION`                                                 | Nome da sessão tmux (padrão: `SlurmMonitor`)                                                                     |
| `SLURM_MONITOR_LOG_OUT` / `SLURM_MONITOR_LOG_ERR`                       | Logs seguidos no painel tmux                                                                                     |
| `SLURM_MONITOR_SQUEUE_SEC` / `_GPU_SEC` / `_SACCT_SEC` / `_SACCT_LINES` | Intervalos do painel                                                                                             |


### Compatibilidade

Variáveis `APUANA_MONITOR_`* continuam aceites (mesmos sufixos) para não partir instalações antigas.

O codigo vive em `monitoring/apuana/` por historial deste repositorio; pode copiar **só** essa pasta para outro repo ou renomear a pasta localmente — a logica nao depende do nome "apuana".

## Estrutura


| Ficheiro               | Função                                                               |
| ---------------------- | -------------------------------------------------------------------- |
| `app.py`               | Aplicação Streamlit principal                                        |
| `slurm_core.py`        | Chamadas Slurm, parsers, gráficos (testável: `python slurm_core.py`) |
| `run_slurm_monitor.sh` | Instala deps e inicia Streamlit ou painel                            |
| `painel_slurm.sh`      | Layout tmux 2×2                                                      |
| `tail_slurm_logs.sh`   | `tail` de `.out` / `.err`                                            |
| `watch_gpu_context.sh` | Contexto GPU / `sinfo` no allocation                                 |


Ficheiros `run_apuana_monitor.sh`, `painel_apuana.sh`, `tail_apuana_logs.sh` e `dashboard_apuana.py` são **aliases** de compatibilidade.

## Licença e contribuições

Use e adapte ao vosso centro de computação: ajuste variáveis de ambiente, políticas de `srun` e caminhos de logs. Pull requests bem-vindos para manter o código agnóstico de site (sem URLs ou utilizadores hardcoded).