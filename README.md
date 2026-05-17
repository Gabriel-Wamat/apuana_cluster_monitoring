<p align="center">
  <img src="apuana/dashboard/static/assets/apuana-app-icon.png" alt="Apuana Monitor" width="136">
</p>

<h1 align="center">Apuana Monitor - CIn UFPE</h1>

<p align="center">
  Dashboard local para acompanhar filas, jobs, GPUs, logs, arquivos remotos e transferências no cluster Apuana.
</p>

<p align="center">
  <a href="https://www.python.org/"><img src="https://img.shields.io/badge/Python-3.9+-3776AB?style=flat&logo=python&logoColor=white" alt="Python 3.9+"></a>
  <a href="https://www.paramiko.org/"><img src="https://img.shields.io/badge/Paramiko-SSH-2F6DB3?style=flat" alt="Paramiko SSH"></a>
  <a href="https://pypi.org/project/keyring/"><img src="https://img.shields.io/badge/Keyring-OS%20Credential%20Store-6A5ACD?style=flat" alt="Keyring credential store"></a>
  <a href="https://pywebview.flowrl.com/"><img src="https://img.shields.io/badge/pywebview-Native%20Window-14C77B?style=flat" alt="pywebview native window"></a>
  <img src="https://img.shields.io/badge/Frontend-HTML%20%7C%20CSS%20%7C%20JS-F7DF1E?style=flat&logo=javascript&logoColor=black" alt="HTML CSS JavaScript">
  <img src="https://img.shields.io/badge/SLURM-Apuana%20Cluster-18A999?style=flat" alt="SLURM Apuana Cluster">
  <img src="https://img.shields.io/badge/%E2%9A%96%EF%B8%8F%20License-MIT-yellow?style=flat" alt="MIT License">
</p>

---

## Motivação

O **Apuana Monitor** foi desenvolvido para facilitar o acompanhamento e gerenciamento de atividades no cluster Apuana do CIn/UFPE de forma mais prática e organizada. A rotina de verificar filas, jobs, GPUs, logs e arquivos remotos normalmente exige múltiplos comandos e conexões manuais, o que pode tornar o fluxo de trabalho desafiador e pouco intuitivo, principalmente durante desenvolvimento, depuração e execução de experimentos.

O projeto reúne essas operações em uma interface local simples, permitindo acompanhar o estado do cluster, acessar logs e gerenciar arquivos com maior praticidade. Essa iniciativa visa fornecer uma ferramenta de apoio que torne o uso do ambiente mais direto e eficiente, preservando o fluxo operacional e as ferramentas nativas do ambiente.

## Referências oficiais

- [Página do Apuana](https://apuana.cin.ufpe.br/)
- [Helpdesk CIn: Cluster Apuana](https://helpdesk.cin.ufpe.br/servicos/cluster-apuana)

<p align="center">
  <img src="apuana/dashboard/static/assets/front.png" alt="Dashboard do Apuana Monitor" width="900">
</p>

## O que ele faz

- mostra o estado geral do cluster e das partições SLURM
- acompanha jobs, filas e uso de GPU
- abre logs `.out` e `.err`
- navega por arquivos remotos em `/home/CIN/<usuario>`
- faz upload e download por sessão SSH autenticada
- cria um app/atalho **Apuana Monitor** na Área de Trabalho na primeira execução

## Requisitos

- Python 3.9+
- conta SSH ativa no Apuana
- VPN/rede com acesso aos hosts do CIn (obrigatório)

O repositório inclui `.tool-versions` para `asdf`/`mise`, com Python 3.12.12 e fallback para o Python do sistema. Quem não usa gerenciador de versões precisa apenas manter Python 3.9+ instalado.

## Rodar pela primeira vez

Primeiro, clone o projeto e entre na pasta:

```bash
git clone <repository-url>
cd apuana_cluster_monitoring
```

Depois escolha uma das formas abaixo. Em todos os sistemas, a primeira execução instala as dependências locais apenas quando necessário e prepara uma forma simples de abrir o Apuana Monitor novamente.

| Sistema | Como rodar | O que é criado |
| --- | --- | --- |
| macOS | `./run.sh` | `Apuana Monitor.app` na Área de Trabalho |
| Linux | `./run.sh` | atalho `.desktop` na Área de Trabalho |
| Windows | `run.bat` | launcher `Apuana Monitor` na Área de Trabalho |

### 1. macOS

<p align="center">
  <img src="apuana/dashboard/static/assets/apuana-app-icon.png" alt="Apuana Monitor para macOS" width="108">
</p>

Use esta opção se quiser abrir o projeto como um app local, com nome e ícone próprios na Área de Trabalho.

```bash
./run.sh
```

Depois da primeira preparação, basta abrir **Apuana Monitor.app** pelo ícone.

Para apenas preparar o app sem abrir a interface imediatamente:

```bash
python run.py --prepare-only
```

### 2. Linux

Use esta opção para iniciar o servidor local e criar um atalho de Área de Trabalho compatível com ambientes Linux que suportam arquivos `.desktop`.

```bash
./run.sh
```

### 3. Windows

No Windows, use o script `.bat`:

```bat
run.bat
```

Em qualquer uma das opções, a primeira execução instala dependências apenas quando necessário e abre a interface local em:

```text
http://127.0.0.1:8501/
```

Quando a janela nativa estiver disponível, o Apuana Monitor abre como app local. Caso contrário, o projeto mantém fallback para o navegador padrão.

## Próximas execuções

<p align="center">
  <img src="apuana/dashboard/static/assets/apuana-app-icon.png" alt="Ícone do app Apuana Monitor" width="96">
</p>

Depois da primeira execução, você pode abrir o **Apuana Monitor** pela Área de Trabalho quando o app/atalho tiver sido criado, ou rodar novamente `./run.sh` no macOS/Linux e `run.bat` no Windows. Se o app já estiver rodando, o launcher reaproveita a sessão local.

Logs de inicialização ficam no diretório padrão do sistema:

```text
macOS: ~/Library/Logs/Apuana Monitor/
Windows: %LOCALAPPDATA%\Apuana Monitor\logs\
Linux: ~/.cache/apuana-monitor/
```

## Login e segurança

O servidor roda apenas na máquina do usuário, em `127.0.0.1`, e só abre uma sessão SSH com o Apuana depois do login no navegador.

Faça login com seu usuário e senha SSH do Apuana. Se marcar **Lembrar neste computador**, a senha é salva no cofre seguro do sistema operacional via `keyring` e usada apenas para abrir novas sessões SSH locais. Nenhuma senha é salva no repositório.

<p align="center">
  <img src="apuana/dashboard/static/assets/readme-login.png" alt="Tela de login do Apuana Monitor" width="780">
</p>

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

Este projeto usa a **MIT License**.

Você pode usar, estudar, modificar e contribuir livremente. A única exigência é manter o aviso de copyright e a licença nas cópias ou partes substanciais do projeto.
