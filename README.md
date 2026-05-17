<p align="center">
  <img src="apuana/dashboard/static/assets/apuana-logo-transparent.png" alt="Apuana Monitor" width="120">
</p>

<h1 align="center">Apuana Monitor</h1>

<p align="center">
  Dashboard local para acompanhar filas, jobs, GPUs, logs, arquivos remotos e transferências no cluster Apuana.
</p>

---

O servidor roda apenas na máquina do usuário, em `127.0.0.1`, e abre uma sessão SSH com o Apuana somente depois do login no navegador. Nenhuma senha é salva no repositório.

## Motivação

O **Apuana Monitor** nasceu para tornar o uso do cluster Apuana mais simples, direto e acessível para estudantes, pesquisadores e pessoas vinculadas ao CIn/UFPE. Embora o Apuana seja uma infraestrutura essencial para experimentos, disciplinas, pesquisa e desenvolvimento em computação, o acesso cotidiano ao cluster ainda pode exigir familiaridade com terminal, comandos SLURM, navegação remota por SSH, leitura manual de logs e acompanhamento constante de filas e recursos.

A proposta deste projeto é reduzir essa barreira sem esconder o funcionamento do cluster. Ele oferece uma interface local, segura e organizada para acompanhar jobs, partições, GPUs, arquivos remotos, logs e transferências, ajudando o usuário a entender melhor o estado do ambiente antes de executar, depurar ou recuperar seus experimentos. Em vez de substituir o aprendizado sobre o Apuana, o monitor serve como uma camada de apoio para que esse aprendizado aconteça com menos atrito e mais clareza.

Na prática, o Apuana Monitor ajuda quem está começando a usar o cluster e também quem já usa com frequência: evita consultas repetitivas, diminui erros operacionais, centraliza informações importantes e torna mais confortável acompanhar execuções longas. O objetivo é que qualquer pessoa autorizada no Apuana consiga abrir o projeto, fazer login com sua própria conta do CIn/UFPE e trabalhar com mais autonomia, sem depender de configurações específicas de uma máquina ou de um usuário.

## Rodar

Requisitos:

- Python 3.9+
- Conta SSH ativa no Apuana
- VPN/rede com acesso aos hosts do CIn, quando necessário

```bash
git clone <repository-url>
cd apuana_cluster_monitoring
./run.sh
```

No Windows, use:

```bat
run.bat
```

O script cria `.venv`, instala as dependências do `requirements.txt` apenas quando necessário e inicia:

```text
http://127.0.0.1:8501/
```

O repositório inclui `.tool-versions` para `asdf`/`mise`, com Python 3.12.12 e fallback para o Python do sistema. Quem não usa gerenciador de versões pode simplesmente manter Python 3.9+ instalado.

Depois, faça login no navegador com seu usuário e senha SSH do Apuana.
Se marcar **Lembrar neste computador**, a senha é salva no cofre seguro do sistema operacional via `keyring` e usada apenas para abrir novas sessões SSH locais.

Na primeira execução, o `run.py` também cria um atalho **Apuana Monitor** na Área de Trabalho com a logo do projeto. Depois disso, basta abrir por esse atalho: ele inicia o servidor local em segundo plano e abre o navegador, sem precisar de IDE ou terminal.

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

## O que inclui

- visão geral do cluster e das partições SLURM
- inspeção de jobs e uso de GPU
- leitura de logs `.out` e `.err`
- navegador de arquivos em `/home/CIN/<usuario>`
- upload e download via sessão SSH autenticada

## Licença

Este projeto usa a **PolyForm Noncommercial License 1.0.0**.

Você pode estudar, usar, modificar e contribuir para fins não comerciais, mantendo os créditos e avisos de licença. Uso comercial, revenda, redistribuição paga ou incorporação em produto/serviço comercial exige autorização prévia por escrito.

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
bash -n apuana/dashboard/run.sh
```

Se tiver Node.js instalado:

```bash
find apuana/dashboard/static/scripts -name '*.js' -print0 | xargs -0 -n1 node --check
```
