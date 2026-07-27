# Checklist - O que vai para o Servidor (VPS)

> Esse checklist cobre só o lado da **VPS** (dashboard). O agente coletor
> (Mosquitto + Node.js) roda no servidor do shopping, não aqui - ver
> `INSTALACAO.md` Passo 2 para aquele lado.

## 1. Requisitos da máquina

- [ ] Ubuntu 22.04+ (mínimo 2 vCPU / 2GB RAM)
- [ ] Acesso root via SSH

## 2. Software a instalar

```bash
# Docker + Compose
curl -fsSL https://get.docker.com | sh
apt install -y docker-compose-plugin

# Certbot (SSL)
apt install certbot -y

# Tailscale (para alcançar o agente do shopping sem IP público/port-forward)
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
```

## 3. DNS

- [ ] Registro **A** do domínio (ex: `dashboard.guarusplaza.com.br`) apontando para o IP da VPS

## 4. Arquivos do projeto a copiar

```
backend/
frontend/
infra/nginx/default.conf
docker-compose.prod.yml
.env.example
deploy.sh
```

```bash
scp -r sistema-guarus-plaza root@IP_DA_VPS:/opt/guarus
```

## 5. Variáveis de ambiente (`.env`)

Copiar `.env.example` → `.env` e preencher:

| Variável | Descrição |
|---|---|
| `DB_PASSWORD` | Senha forte do Postgres (não usar a padrão) |
| `JWT_SECRET` | `openssl rand -hex 32` (mínimo 32 chars) |
| `INGEST_API_KEY` | `openssl rand -hex 24` (mínimo 16 chars - exigido pelo schema, mesmo o endpoint estando sem uso) |
| `AGENT_WS_URL` | `ws://100.x.y.z:9200` - **IP da tailnet** do servidor do shopping (não IP público, não `localhost`) |
| `AGENT_API_KEY` | `openssl rand -hex 24` - **deve ser idêntica** ao `API_KEY` configurado no agente |
| `CORS_ORIGIN` | Domínio do frontend |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Para envio de e-mails de alerta |
| `DB_USER` | Usuário do Postgres |

> ⚠️ A arquitetura real é **WebSocket pull**: é a API na VPS que se conecta
> ao agente e busca as leituras a cada 10s (`agentSync`), não o agente que
> envia para a VPS. O endpoint `POST /api/ingest` existe no código mas está
> sem uso.

## 6. Rede / Conectividade

- [ ] Portas **80** e **443** abertas na VPS (Nginx) - únicas portas expostas à internet pública
- [ ] Tailscale rodando na VPS (`tailscale status` deve mostrar o agente do shopping como peer online)
- [ ] `AGENT_WS_URL` usando o IP da tailnet do shopping (`100.x.y.z`), **não** IP público nem port-forward

> Não usamos port-forward/DDNS: a maioria dos links comerciais no Brasil usa
> CGNAT, o que torna isso inviável. O container `api` alcança o agente
> através da interface Tailscale do host da VPS (não precisa de configuração
> extra de rede no Docker - o tráfego é roteado normalmente pelo host).

## 7. Deploy

```bash
cd /opt/guarus
chmod +x deploy.sh
./deploy.sh
```

Isso sobe via `docker-compose.prod.yml`:
- `postgres` (TimescaleDB)
- `api` (Fastify)
- `frontend` (React, build estático servido por Nginx)
- `nginx` (proxy reverso)

## 8. SSL (depois do primeiro deploy)

```bash
docker compose -f docker-compose.prod.yml stop nginx
certbot certonly --standalone -d dashboard.guarusplaza.com.br
docker compose -f docker-compose.prod.yml start nginx
```

## 9. Pós-deploy

- [ ] Rodar migrations: `docker compose -f docker-compose.prod.yml exec api npx drizzle-kit push`
- [ ] Popular dados iniciais (opcional): `docker compose -f docker-compose.prod.yml exec api npx tsx src/utils/seed.ts`
- [ ] Testar login admin em `https://dashboard.guarusplaza.com.br`
- [ ] Confirmar nos logs (`docker compose -f docker-compose.prod.yml logs api -f`) que o `agentSync` conectou no agente do shopping (`[AGENT-SYNC] Connected to agent at ws://100.x.y.z:9200` e depois `Authenticated`)
