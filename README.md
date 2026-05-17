<p align="center">
  <img src="apuana/dashboard/static/assets/apuana-logo-transparent.png" alt="Apuana Monitor" width="120">
</p>

<h1 align="center">Apuana Monitor</h1>

<p align="center">
  Dashboard local para acompanhar filas, jobs, GPUs, logs, arquivos remotos e transferências no cluster Apuana.
</p>

---

O servidor roda apenas na máquina do usuário, em `127.0.0.1`, e abre uma sessão SSH com o Apuana somente depois do login no navegador. Nenhuma senha é salva no repositório.

## Rodar

Requisitos:

- Python 3.9+
- Conta SSH ativa no Apuana
- VPN/rede com acesso aos hosts do CIn, quando necessário

```bash
git clone <repository-url>
cd apuana_cluster_monitoring
python run.py
```

O script cria `.venv`, instala as dependências do `requirements.txt` apenas quando necessário e inicia:

```text
http://127.0.0.1:8501/
```

Depois, faça login no navegador com seu usuário e senha SSH do Apuana.

## Opções

```bash
python run.py --port 8520
python run.py --host slurm-client1.cin.ufpe.br
python run.py --transfer-host slurm-client1.cin.ufpe.br
python run.py --no-browser
```

Também é possível configurar por ambiente:

```bash
SLURM_MONITOR_PORT=8520 python run.py
SLURM_MONITOR_SSH_HOST=slurm-client1.cin.ufpe.br python run.py
SLURM_MONITOR_TRANSFER_HOST=slurm-client1.cin.ufpe.br python run.py
```

## O que inclui

- visão geral do cluster e das partições SLURM
- inspeção de jobs e uso de GPU
- leitura de logs `.out` e `.err`
- navegador de arquivos em `/home/CIN/<usuario>`
- upload e download via sessão SSH autenticada

## Estrutura

```text
run.py
requirements.txt
apuana/dashboard/
  run.sh
  server/
  static/
apuana/bin/
apuana/lib/
```

## Validação local

```bash
python -m compileall -q apuana/dashboard/server
bash -n apuana/dashboard/run.sh
```

Se tiver Node.js instalado:

```bash
find apuana/dashboard/static/scripts -name '*.js' -print0 | xargs -0 -n1 node --check
```
