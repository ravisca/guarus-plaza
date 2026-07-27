# Guia de Instalação - Sistema Guarus Plaza

## Pré-requisitos

### Servidor do Shopping (Agente Local)
- Computador com Linux (Ubuntu 22.04+) ou Windows
- Conectado à rede local do shopping
- Docker instalado
- **Tailscale instalado e conectado** — é a VPS que se conecta ao WebSocket do agente (porta 9200) para buscar as leituras, não o agente que envia para a VPS. Como a maioria dos links comerciais no Brasil usa CGNAT (sem IP público real), usamos Tailscale para os dois lados se enxergarem sem port-forward nem DDNS

### VPS (Dashboard)
- VPS com Ubuntu 22.04+ (mínimo 2 vCPU, 2GB RAM)
- Docker + Docker Compose instalados
- Domínio configurado (dashboard.guarusplaza.com.br)

> **Arquitetura real:** a API na VPS conecta-se ao WebSocket do agente (porta 9200) e puxa as leituras a cada 10s (`agentSync`). O endpoint `POST /api/ingest` ainda existe no código mas não é usado por nada — não configure o agente para dar push nele.

---

## Passo 1: Preparar a VPS

### 1.1 Conectar via SSH
```bash
ssh root@IP_DA_VPS
```

### 1.2 Instalar Docker e Tailscale
```bash
curl -fsSL https://get.docker.com | sh

curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
```

### 1.3 Copiar os arquivos
```bash
# No seu computador local
scp -r sistema-guarus-plaza root@IP_DA_VPS:/opt/guarus
```

### 1.4 Configurar variáveis de ambiente
```bash
cd /opt/guarus
cp .env.example .env
nano .env
```

Editar o `.env`:
```
DB_PASSWORD=SUA_SENHA_SEGURA_AQUI
JWT_SECRET=$(openssl rand -hex 32)
INGEST_API_KEY=$(openssl rand -hex 24)
AGENT_WS_URL=ws://100.x.y.z:9200
AGENT_API_KEY=$(openssl rand -hex 24)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=seu@email.com
SMTP_PASS=sua_senha_de_app
SMTP_FROM=Guarus Plaza <seu@email.com>
```

`100.x.y.z` é o **IP da tailnet** do servidor do shopping, não IP público — pegue com `tailscale ip -4` rodando naquela máquina (Passo 2.2). `AGENT_API_KEY` deve ser **idêntico** ao `API_KEY` configurado no agente (Passo 2.4) - é o segredo que autentica a conexão WebSocket entre a VPS e o servidor do shopping.

### 1.5 Deploy
```bash
chmod +x deploy.sh
./deploy.sh
```

### 1.6 Configurar SSL
```bash
apt install certbot -y
docker compose -f docker-compose.prod.yml stop nginx
certbot certonly --standalone -d dashboard.guarusplaza.com.br
docker compose -f docker-compose.prod.yml start nginx
```

### 1.7 Configurar DNS
No painel do domínio, criar registro A:
- **host:** `dashboard`
- **value:** IP da VPS

---

## Passo 2: Instalar Agente no Shopping

### 2.1 Conectar no servidor do shopping
```bash
ssh usuario@IP_SERVIDOR_SHOPPING
```

### 2.2 Instalar Docker e Tailscale
```bash
curl -fsSL https://get.docker.com | sh

curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
tailscale ip -4     # anote este IP - é o AGENT_WS_URL da VPS (Passo 1.4)
```

### 2.3 Copiar apenas a pasta do agente
```bash
mkdir -p /opt/guarus
scp -r agent/ docker-compose.yml mosquitto/ .env root@IP_SERVIDOR:/opt/guarus/
```

### 2.4 Configurar .env
```bash
cd /opt/guarus
nano .env
```

Editar:
```
MQTT_BROKER=mqtt://mosquitto:1883
API_KEY=mesma_chave_configurada_como_AGENT_API_KEY_na_vps
LOCAL_PORT=9100
```

`API_KEY` precisa bater exatamente com o `AGENT_API_KEY` do `.env` da VPS (Passo 1.4).

### 2.5 Iniciar agente
```bash
docker compose up -d
```

### 2.6 Verificar conexão
```bash
docker compose logs agent
```

Deve mostrar:
```
[MQTT] Connected to mqtt://mosquitto:1883
[MQTT] Subscribed to konect/+/readings
```

---

## Passo 3: Configurar Medidores Konect

### 3.1 Cada medidor deve publicar MQTT no tópico:
```
konect/{MAC_ADDRESS}/readings
```

### 3.2 Formato do payload JSON:
```json
{
  "device": "AA:BB:CC:DD:EE:FF",
  "timestamp": "2026-07-15T14:30:00Z",
  "readings": {
    "kwh": 1250.45,
    "voltage": 220.3,
    "current": 45.2,
    "power": 9.95,
    "power_factor": 0.95
  },
  "status": "online"
}
```

### 3.3 Configurar每个 medidor para enviar para:
- **Broker:** IP do servidor do shopping
- **Porta:** 1883
- **Tópico:** `konect/{MAC}/readings`

---

## Passo 4: Cadastrar Lojas e Medidores

### 4.1 Acessar o painel admin
- URL: http://dashboard.guarusplaza.com.br
- Login: admin@guarusplaza.com.br

### 4.2 Cadastrar loja
1. Ir em "Lojas" → "Nova Loja"
2. Preencher nome, número, metragem
3. Salvar

### 4.3 Associar medidor
1. Ir em "Medidores"
2. Cadastrar medidor com MAC address do Konect
3. Associar à loja

---

## Passo 5: Configurar Alertas

### 5.1 Configurar SMTP (Gmail)
1. Ativar verificação em 2 etapas
2. Gerar "Senha de app" em https://myaccount.google.com/apppasswords
3. Colocar no `.env` da VPS

### 5.2 Lojistas configuram alertas pelo painel
- Consumo mensal
- Fator de potência
- Tensão fora do padrão

---

## Comandos Úteis

```bash
# Ver logs do agente
docker compose logs agent -f

# Ver logs da API
docker compose -f docker-compose.prod.yml logs api -f

# Reiniciar agente
docker compose restart agent

# Verificar status
docker compose ps

# Backup do banco
docker compose -f docker-compose.prod.yml exec postgres pg_dump -U guarus guarus_energy > backup.sql

# Restaurar backup
cat backup.sql | docker compose -f docker-compose.prod.yml exec -T postgres psql -U guarus guarus_energy
```

---

## Troubleshooting

### Agente não conecta ao MQTT
```bash
# Verificar se Mosquitto está rodando
docker compose logs mosquitto

# Testar conexão manual
docker compose exec mosquitto mosquitto_pub -t "test" -m "hello"
```

### Dados não aparecem no dashboard
1. Verificar se agente está enviando: `docker compose logs agent`
2. Verificar se API recebeu: `docker compose -f docker-compose.prod.yml logs api`
3. Verificar se dados estão no banco:
```bash
docker compose -f docker-compose.prod.yml exec postgres psql -U guarus guarus_energy -c "SELECT count(*) FROM readings;"
```

### Alertas não chegam por e-mail
1. Verificar SMTP no `.env`
2. Testar manualmente:
```bash
docker compose -f docker-compose.prod.yml exec api npx tsx -e "
const nodemailer = require('nodemailer');
const t = nodemailer.createTransport({host:'smtp.gmail.com',port:587,auth:{user:'SEU_EMAIL',pass:'SENHA_APP'}});
t.sendMail({from:'test@test.com',to:'dest@test.com',subject:'Teste',html:'<h1>Funcionou!</h1>'}).then(()=>console.log('OK')).catch(e=>console.error(e));
"
```
