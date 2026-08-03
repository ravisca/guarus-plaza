# O que precisa ser instalado — Guarus Plaza

Dois servidores separados. Não confundir os `.env` dos dois — são arquivos diferentes.

```
VPS (pública, com domínio)          Servidor do Shopping (rede local)
┌──────────────────────┐            ┌──────────────────────┐
│ Postgres/TimescaleDB │            │ Mosquitto (MQTT)     │
│ API (Fastify)        │◀──WS pull──│ Agente (Node.js)     │
│ Frontend (React)     │  (VPS      │ WS server :9200      │
│ Nginx (proxy)        │  conecta)  └──────────────────────┘
└──────────────────────┘
```

A VPS é quem **inicia** a conexão com o agente (WebSocket, a cada 10s). O agente nunca conecta na VPS. O endpoint `POST /api/ingest` existe no código mas está sem uso — não configurar nada para dar push nele.

---

## 1. VPS (dashboard/API/banco)

### Requisitos da máquina
- Ubuntu 22.04+, mínimo 2 vCPU / 2GB RAM
- Acesso root via SSH
- Domínio apontado (registro **A** → IP da VPS)

### Instalar
```bash
curl -fsSL https://get.docker.com | sh
apt install -y docker-compose-plugin
apt install certbot -y
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
```

### Copiar os arquivos do projeto
```bash
scp -r sistema-guarus-plaza root@IP_DA_VPS:/opt/guarus
```
Necessário: `backend/`, `frontend/`, `infra/nginx/default.conf`, `docker-compose.prod.yml`, `.env.example`, `deploy.sh`

### Configurar `.env`
```bash
cd /opt/guarus
cp .env.example .env
nano .env
```

| Variável | Como obter |
|---|---|
| `DB_USER` / `DB_PASSWORD` | Usuário e senha forte do Postgres (não usar o valor padrão do exemplo) |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `INGEST_API_KEY` | `openssl rand -hex 24` (exigido pelo schema mesmo o endpoint estando sem uso) |
| `AGENT_WS_URL` | `ws://100.x.y.z:9200` — **IP da tailnet** do servidor do shopping (Passo 2, não IP público) |
| `AGENT_API_KEY` | `openssl rand -hex 24` — **deve ser idêntica** ao `API_KEY` do agente (Passo 2) |
| `CORS_ORIGIN` | Domínio do frontend |
| `SMTP_HOST/PORT/USER/PASS/FROM` | Para e-mail de alerta (Gmail: senha de app em https://myaccount.google.com/apppasswords) |

### Deploy
```bash
chmod +x deploy.sh
./deploy.sh
```
Sobe via `docker-compose.prod.yml`: `postgres` (TimescaleDB) + `api` (Fastify) + `frontend` (build estático via Nginx) + `nginx` (proxy reverso).

### SSL (depois do primeiro deploy)
```bash
docker compose -f docker-compose.prod.yml stop nginx
certbot certonly --standalone -d dashboard.guarusplaza.com.br
docker compose -f docker-compose.prod.yml start nginx
```

### Pós-deploy
```bash
docker compose -f docker-compose.prod.yml exec api npx drizzle-kit push
docker compose -f docker-compose.prod.yml exec api npx tsx src/utils/seed.ts   # opcional, dados de teste
```
- Testar login admin em `https://dashboard.guarusplaza.com.br`
- Conferir logs: `docker compose -f docker-compose.prod.yml logs api -f` — deve aparecer `[AGENT-SYNC] Connected to agent at ws://100.x.y.z:9200` e depois `Authenticated`

### Rede
- Só as portas **80** e **443** expostas à internet (Nginx)
- Tailscale rodando (`tailscale status` deve mostrar o agente do shopping como peer online)
- Não usar port-forward/DDNS — a maioria dos links comerciais no Brasil usa CGNAT, o Tailscale resolve isso

---

## 2. Servidor do Shopping (agente coletor)

### Requisitos da máquina
- Linux (Ubuntu 22.04+) ou Windows, na **rede local do shopping** (mesma rede dos medidores Kron Konect)
- IP fixo ou reservado via DHCP
- Acesso à internet de saída (só para baixar imagens Docker)

### Instalar
```bash
curl -fsSL https://get.docker.com | sh
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
tailscale ip -4     # anotar — é o AGENT_WS_URL do .env da VPS
```
Docker Compose já vem embutido (`docker compose`, sem hífen).

### Copiar os arquivos do projeto (só o necessário)
```bash
mkdir -p /opt/guarus
scp -r agent/ docker-compose.yml mosquitto/ .env usuario@IP_SERVIDOR_SHOPPING:/opt/guarus/
```

### Configurar `.env`
| Variável | Descrição |
|---|---|
| `MQTT_BROKER` | `mqtt://mosquitto:1883` (nome do serviço no compose local) |
| `API_KEY` | Mesmo valor do `AGENT_API_KEY` da VPS — autentica a conexão WebSocket |
| `LOCAL_PORT` | `9100` (API HTTP local de debug/status) |

### Subir o agente
```bash
cd /opt/guarus
docker compose up -d --build
```
Sobe: `mosquitto` (broker MQTT, porta 1883) + `agent` (Node.js — assina MQTT, faz buffer, serve WS na 9200 e HTTP status na 9100).

### Configurar os medidores Kron Konect
Cada medidor publica via MQTT:

| Item | Valor |
|---|---|
| Broker | IP do servidor do shopping |
| Porta | `1883` |
| Tópico | `konect/{MAC_ADDRESS}/readings` |

Payload:
```json
{
  "device": "AA:BB:CC:DD:EE:FF",
  "timestamp": "2026-07-15T14:30:00Z",
  "readings": { "kwh": 1250.45, "voltage": 220.3, "current": 45.2, "power": 9.95, "power_factor": 0.95 },
  "status": "online"
}
```

### Verificação
```bash
docker compose logs agent -f
```
Deve mostrar:
```
[MQTT] Connected to mqtt://mosquitto:1883
[MQTT] Subscribed to konect/+/readings
[LOCAL] HTTP API on http://localhost:9100
[WS] Client connected from <IP_DA_VPS>     ← aparece quando a VPS conectar
```

### Rede
- Porta **1883** (MQTT) só precisa ser acessível **dentro da rede local** pelos medidores — não expor à internet
- Tailscale conectado — é assim que a VPS alcança o agente (`100.x.y.z:9200`) sem IP público, port-forward ou DDNS
- Nenhuma porta precisa ser aberta no roteador do shopping

---

## Depois dos dois servidores no ar

1. Acessar `https://dashboard.guarusplaza.com.br` com `admin@guarusplaza.com.br`
2. Cadastrar loja (Lojas → Nova Loja)
3. Cadastrar medidor (Medidores → informar MAC address → associar à loja)
4. Lojistas configuram alertas pelo próprio painel (consumo mensal, fator de potência, tensão fora do padrão)

---

## Troubleshooting rápido

**VPS não conecta no agente:**
```bash
tailscale status                          # na VPS — agente deve aparecer como peer online
tailscale ping 100.x.y.z                  # na VPS, rodando contra o IP do shopping
```
Conferir: `AGENT_WS_URL` usa IP da tailnet (não `localhost`/IP público); `AGENT_API_KEY` (VPS) == `API_KEY` (agente).

**Medidor não aparece no MQTT:**
```bash
docker compose logs mosquitto
docker compose exec mosquitto mosquitto_pub -t "test" -m "hello"
```

**Dados não aparecem no dashboard:**
```bash
docker compose logs agent -f                                              # no shopping
docker compose -f docker-compose.prod.yml logs api -f                     # na VPS
docker compose -f docker-compose.prod.yml exec postgres psql -U guarus guarus_energy -c "SELECT count(*) FROM readings;"
```

**Alertas não chegam por e-mail:** conferir SMTP no `.env` da VPS.

---

## Comandos úteis

```bash
# Backup do banco (na VPS)
docker compose -f docker-compose.prod.yml exec postgres pg_dump -U guarus guarus_energy > backup.sql

# Restaurar backup
cat backup.sql | docker compose -f docker-compose.prod.yml exec -T postgres psql -U guarus guarus_energy

# Reiniciar agente (no shopping)
docker compose restart agent
```

---

*Detalhe completo, passo a passo, em `docs/INSTALACAO.md`, `docs/CHECKLIST_SERVIDOR.md` e `docs/CHECKLIST_SHOPPING.md`.*
