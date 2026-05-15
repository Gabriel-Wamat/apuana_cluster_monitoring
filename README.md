# Apuana Monitor 

Dashboard web e painel de terminal para monitorar o **Apuana/CIn-UFPE** via
SLURM. O projeto tambem funciona como monitor generico de clusters SLURM com GPU
NVIDIA opcional.

O sistema foi desenhado para funcionar para **qualquer usuario do Apuana**. Ele
usa `$USER`, `$HOME` e variaveis `SLURM_MONITOR_*`; nao depende do usuario
`gwam` nem de caminhos absolutos de uma conta especifica.

## Requisitos

- Python 3.10+ (no nó de login)
- `slurm-client` / comandos: `squeue`, `sinfo`, `sacct`, `scontrol`, `srun`
- Opcional: `nvidia-smi`, `tmux`, `bash`

## Uso rapido no Apuana

No seu computador local, entre em um no de login:

```bash
ssh <USUARIO>@slurm-client2.cin.ufpe.br
# ou
ssh <USUARIO>@slurm-client1.cin.ufpe.br
```

No Apuana, acesse a pasta do projeto:

```bash
cd ~/monitoring/apuana
```

Se a pasta ainda nao existir na sua conta, copie ou clone este repositorio para
`~/monitoring` primeiro. O dashboard nao precisa ficar em uma pasta especifica,
mas os exemplos abaixo assumem `~/monitoring`.

Inicie o dashboard:

```bash
chmod +x run_slurm_monitor.sh painel_slurm.sh tail_slurm_logs.sh watch_gpu_context.sh
./run_slurm_monitor.sh
```

O script cria `.venv-monitor` dentro da pasta `apuana/` por padrao, instala as
dependencias Python se necessario e abre o Streamlit em
`http://127.0.0.1:8501`.

Se outra pessoa ja estiver usando a porta `8501` no mesmo no de login, escolha
outra porta:

```bash
SLURM_MONITOR_STREAMLIT_PORT=8502 ./run_slurm_monitor.sh
```

Para manter o ambiente Python fora do repositorio:

```bash
SLURM_MONITOR_VENV="$HOME/.cache/apuana-monitor-venv" ./run_slurm_monitor.sh
```

Se a pasta `.venv-monitor` foi copiada de outro caminho/usuario e o Streamlit
falhar com `bad interpreter`, remova a venv antiga ou aponte para uma nova:

```bash
rm -rf .venv-monitor
./run_slurm_monitor.sh
```

### Tunel SSH para abrir no navegador

```bash
ssh -N -L 8501:localhost:8501 <USUARIO>@slurm-client2.cin.ufpe.br
```

Abra no navegador local:

```text
http://localhost:8501
```

Se voce iniciou o dashboard com outra porta, use a mesma porta no tunel e no
navegador.

### Painel tmux (4 painéis: fila, logs, GPU, sacct)

```bash
./run_slurm_monitor.sh --painel
# ou
./painel_slurm.sh
```

### Validar o projeto no Apuana

Antes de implementar ou aceitar qualquer feature/refactor, rode:

```bash
cd ~/monitoring
bash scripts/validate_monitoring.sh
```

Esse comando valida sintaxe dos scripts, imports Python, self-tests do core,
`squeue`, `sinfo` e o comportamento degradado esperado quando `sacct` estiver
indisponivel.

Regra do projeto: uma feature so entra em implementacao depois de ter criterio
de aceite e comando de validacao definido. O comando canonico de validacao e
`bash scripts/validate_monitoring.sh`.

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
