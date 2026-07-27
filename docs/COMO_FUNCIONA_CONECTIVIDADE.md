# Como Funciona a Conectividade VPS ↔ Shopping

> Documento para aprovação. Explica a arquitetura corrigida de comunicação
> entre a VPS (dashboard) e o servidor do shopping (agente coletor).

## O problema que foi identificado

A pergunta que gerou a correção:

> "Se a VPS tentar buscar desse websocket, como ele vai encontrar a máquina
> se não tem IP Público?"

O código real tem a **VPS como cliente WebSocket** e o **agente como servidor** (porta 9200). Ou seja, a VPS precisa alcançar o servidor do shopping pela rede. O problema: a maioria dos links comerciais no Brasil usa **CGNAT** (IP público compartilhado entre vários clientes), o que torna port-forward impossível.

Além disso, o doc `ARQUITETURA_COMUNICACAO.md` original descrevia o fluxo invertido (dizia que "o agente conecta outbound" e que "o shopping não tem porta de entrada aberta") — mas o código real é o oposto. O documento descrevia uma garantia de segurança que o código não cumpria.

## A solução: Tailscale

Os dois lados (VPS e servidor do shopping) entram na mesma **tailnet** — uma rede privada virtual criada pelo Tailscale. Cada máquina recebe um IP fixo dentro dela (`100.x.y.z`), alcançável pela outra independentemente de IP público, port-forward ou CGNAT.

```
┌─────────────────────────────┐          ┌─────────────────────────────┐
│       VPS (nuvem)           │          │    Servidor do Shopping     │
│                             │          │                             │
│  Tailscale: 100.1.1.1      │◄────────►│  Tailscale: 100.2.2.2      │
│  (IP da tailnet)            │  rede    │  (IP da tailnet)            │
│                             │  privada │                             │
│  API (Fastify:3001)         │  virtual │  Agente (Node.js)           │
│  └─ agentSync (cliente WS)  │          │  └─ WebSocket Server (:9200)│
│                             │          │  └─ MQTT Broker (:1883)     │
│  PostgreSQL + TimescaleDB   │          │  └─ HTTP API (:9100)        │
│  Nginx (443)                │          │                             │
└─────────────────────────────┘          └─────────────────────────────┘
```

**Como funciona na prática:**
1. Ambos rodam `tailscale up` (uma vez) e recebem IPs `100.x.y.z`
2. O `.env` da VPS usa `AGENT_WS_URL=ws://100.2.2.2:9200` (IP da tailnet do shopping)
3. A VPS conecta ao agente como se estivesse na mesma rede local
4. Nenhuma porta é exposta à internet pública — a 9200 só existe dentro da tailnet

## Fluxo de dados (pull via WebSocket)

```
Medidores (Kron Konect)
  │  publicam MQTT a cada 30s
  ▼
Mosquitto (broker, porta 1883 - rede local do shopping)
  │  roteia para o agente
  ▼
Agente Local (servidor do shopping)
  │  coleta, armazena em buffer (memória, máx 5000)
  │  expõe WebSocket na porta 9200 (só na tailnet)
  ▲
  │  VPS conecta aqui (a cada 10s)
  │
VPS (Backend API)
  │  agentSync: cliente WebSocket
  │  puxa batch de leituras, insere no PostgreSQL
  ▼
Dashboard (frontend React via Nginx:443)
```

**Por que pull e não push?**
- A VPS controla quando puxar dados
- Dashboard pode atualizar sob demanda
- A porta do agente só existe dentro da tailnet (mais segurança)
- Funciona mesmo atrás de CGNAT

## O que foi alterado

| Arquivo | O que mudou |
|---|---|
| `.env.example` | `AGENT_WS_URL` documentado como IP de tailnet (`100.x.y.z`), não IP público. Comentário explicando o fluxo. |
| `docs/ARQUITETURA_COMUNICACAO.md` | Corrigida a descrição errada de que "o agente conecta outbound". Agora reflete que o agente é o servidor WS e a porta 9200 só é alcançável dentro da tailnet. Adicionada nota de correção. |
| `docs/CHECKLIST_SHOPPING.md` | Seção 2: Tailscale adicionado. Seção 5: rede trocada de "port-forward/DDNS" para "conectar na tailnet". Troubleshooting atualizado com comandos Tailscale. |
| `docs/CHECKLIST_SERVIDOR.md` | Seção 2: Tailscale adicionado. Seção 6: rede/firewall reescrita. Nota de que container `api` alcança a tailnet do host sem config extra de Docker. |
| `docs/INSTALACAO.md` | Passos 1.2 e 2.2 agora instalam e configuram Tailscale. `.env` de exemplo usa IP de tailnet. Nota explicativa sobre CGNAT. |

## Arquivos que NÃO foram alterados

- `agent/src/index.ts` — o código do agente continua igual (servidor WS na 9200)
- `backend/src/modules/agentSync/index.ts` — o código da VPS continua igual (cliente WS)
- `docker-compose.yml` / `docker-compose.prod.yml` — sem mudança (o tráfego Tailscale passa pela interface do host, Docker roteia normalmente)

## Segurança

| Componente | Porta | Exposta à internet? |
|---|---|---|
| Agente WS (shopping) | 9200 | **Não** — só na tailnet |
| MQTT (shopping) | 1883 | **Não** — rede local do shopping |
| HTTP API (shopping) | 9100 | **Não** — rede local do shopping |
| Nginx (VPS) | 443 | Sim (HTTPS) |
| PostgreSQL (VPS) | 5432 | **Não** — interna |

O shopping **não expõe nenhuma porta para a internet pública**. A porta 9200 só é acessível de dentro da tailnet Tailscale, à qual só a VPS (e máquinas autorizadas) pertence.

## Passo manual pendente

Para ativar a conexão, é necessário rodar `tailscale up` nas duas máquinas:

```bash
# No servidor do shopping:
tailscale up
tailscale ip -4    # anotar IP (ex: 100.2.2.2)

# Na VPS:
tailscale up
# No .env da VPS, usar: AGENT_WS_URL=ws://100.2.2.2:9200
```

Na primeira vez, cada máquina abre um link de autenticação no navegador.
