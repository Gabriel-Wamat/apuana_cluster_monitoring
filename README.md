<p align="center">
  <img src="apuana/dashboard/static/assets/apuana-logo-transparent.png" alt="Apuana Monitor" width="120">
</p>

<h1 align="center">Apuana Monitor</h1>

<p align="center">
  Dashboard local para acompanhar filas, jobs, GPUs, logs, arquivos remotos e transferências no cluster Apuana.
</p>

---

## Motivação

O **Apuana Monitor** foi criado para facilitar o uso cotidiano do cluster Apuana por estudantes, pesquisadores e pessoas vinculadas ao CIn/UFPE. A ideia é reduzir a fricção de tarefas comuns, como acompanhar filas SLURM, verificar jobs, consultar GPUs, ler logs e navegar por arquivos remotos, sem exigir que tudo passe manualmente pelo terminal.

O projeto não substitui o aprendizado sobre o cluster; ele organiza informações importantes em uma interface local, segura e mais acessível. Assim, quem está começando consegue ganhar autonomia mais rápido, e quem já usa o Apuana com frequência evita consultas repetitivas e acompanha execuções longas com mais clareza.

## O que ele faz

- mostra o estado geral do cluster e das partições SLURM
- acompanha jobs, filas e uso de GPU
- abre logs `.out` e `.err`
- navega por arquivos remotos em `/home/CIN/<usuario>`
- faz upload e download por sessão SSH autenticada
- cria um atalho **Apuana Monitor** na Área de Trabalho na primeira execução

## Requisitos

- Python 3.9+
- conta SSH ativa no Apuana
- VPN/rede com acesso aos hosts do CIn, quando necessário

O repositório inclui `.tool-versions` para `asdf`/`mise`, com Python 3.12.12 e fallback para o Python do sistema. Quem não usa gerenciador de versões precisa apenas manter Python 3.9+ instalado.

## Rodar pela primeira vez

Clone o projeto e entre na pasta:

```bash
git clone <repository-url>
cd apuana_cluster_monitoring
```

No macOS ou Linux:

```bash
./run.sh
```

No Windows:

```bat
run.bat
```

Na primeira execução, o script cria `.venv`, instala as dependências do `requirements.txt` apenas quando necessário, cria o atalho **Apuana Monitor** na Área de Trabalho e abre:

```text
http://127.0.0.1:8501/
```

## Próximas execuções

Depois da primeira execução, basta abrir o atalho **Apuana Monitor** na Área de Trabalho. Ele inicia o servidor local em segundo plano e abre o navegador padrão do sistema, sem precisar abrir IDE ou terminal.

## Login e segurança

O servidor roda apenas na máquina do usuário, em `127.0.0.1`, e só abre uma sessão SSH com o Apuana depois do login no navegador.

Faça login com seu usuário e senha SSH do Apuana. Se marcar **Lembrar neste computador**, a senha é salva no cofre seguro do sistema operacional via `keyring` e usada apenas para abrir novas sessões SSH locais. Nenhuma senha é salva no repositório.

## Opções

```bash
./run.sh --port 8520
./run.sh --host slurm-client1.cin.ufpe.br
./run.sh --transfer-host slurm-client1.cin.ufpe.br
./run.sh --no-browser
```

Também é possível configurar por ambiente:

```bash
SLURM_MONITOR_PORT=8520 ./run.sh
SLURM_MONITOR_SSH_HOST=slurm-client1.cin.ufpe.br ./run.sh
SLURM_MONITOR_TRANSFER_HOST=slurm-client1.cin.ufpe.br ./run.sh
```

## Estrutura

```text
run.py
run.sh
run.bat
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
bash -n run.sh
bash -n apuana/dashboard/run.sh
```

Se tiver Node.js instalado:

```bash
find apuana/dashboard/static/scripts -name '*.js' -print0 | xargs -0 -n1 node --check
```

## Licença

Este projeto usa a **PolyForm Noncommercial License 1.0.0**.

Você pode estudar, usar, modificar e contribuir para fins não comerciais, mantendo os créditos e avisos de licença. Uso comercial, revenda, redistribuição paga ou incorporação em produto/serviço comercial exige autorização prévia por escrito.
