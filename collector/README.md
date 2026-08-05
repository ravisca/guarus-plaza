# Coletor Modbus → MQTT

Lê os medidores Kron por Modbus TCP e publica as leituras no broker MQTT, no formato
que o agent espera.

```
medidores Kron (Modbus/502)  ->  [coletor]  ->  Mosquitto  ->  agent  ->  VPS
```

## Por que este componente existe

O `agent/` assina o tópico `konect/+/readings`, mas **nada publicava nele**. Os medidores
Kron falam Modbus TCP, não MQTT — sem esta ponte, o sistema não recebe uma leitura
sequer. A peça não existia no projeto original.

## Instalação

```bash
cd collector
npm install
cp medidores.example.json medidores.json   # e edite
npm run testar                             # um ciclo só, para conferir
npm start                                  # roda continuamente
```

## Configuração

Por variável de ambiente:

| Variável | Padrão | Para que serve |
|---|---|---|
| `MQTT_BROKER` | `mqtt://localhost:1883` | Broker onde publicar |
| `MEDIDORES_CONFIG` | `./medidores.json` | Lista de medidores |
| `INTERVALO_SEG` | `30` | Segundos entre ciclos de leitura |
| `MODBUS_UNIT_ID` | `255` | Unit id (confirmado nos Kron do Guarus) |
| `MODBUS_TIMEOUT_MS` | `3000` | Timeout por leitura |
| `CONCORRENCIA` | `5` | Medidores lidos em paralelo |
| `VERBOSE` | — | `1` imprime cada leitura |

### `medidores.json`

O campo `device` precisa ser **idêntico ao `macAddress` cadastrado no dashboard**. É por
ele que o backend liga a leitura à loja — `agentSync` faz
`where(eq(meters.macAddress, item.device))`. Se não casar, a leitura é **silenciosamente
descartada**: o agent entrega, o backend recebe e o `continue` do laço a joga fora sem
erro no log. É a falha mais provável na primeira instalação.

## Mapa de registradores

Função 4 (input registers), unit 255, float32 **little-endian (DCBA)**:

| Campo | Registrador |
|---|---|
| `kwh` | 200 |
| `voltage` | 10 |
| `current` | 16 (média) |
| `power` | 34 (total) |
| `power_factor` | **58** |

O fator de potência está no 58, não no 20 — o 20 é corrente de fase. Detalhes e como
foi validado: `scripts/dash_Plaza/05-mapa-modbus-kron.md`.

## Validação da escala

O mapa veio de engenharia reversa, mas a escala foi confirmada por coerência interna,
sem depender de documentação:

```
P1+P2+P3 = 37.832 W  vs  P0 = 37.819 W        (potências por fase somam o total)
P0/S0    = 0,9188    vs  reg 58 = 0,9161      (FP é P/S, por definição)
3 × V × I × FP = 37.863 W  vs  lido 37.819 W  (erro de 0,12%)
```

Se a relação do TC não estivesse aplicada, corrente e potência não fechariam entre si.
Com 0,12% de erro, o medidor entrega valores primários com o TC já aplicado.

## ⚠️ Ainda assim, antes da primeira fatura

A validação acima prova coerência e escala, **não aferição**. Confiar no faturamento
pressupõe medidor com certificação metrológica válida do INMETRO — isso é do parque
físico, não do software.

Recomendado no primeiro ciclo: conferir a leitura inicial e final registradas pelo
sistema contra o display de uma amostra de medidores, e comparar a soma das lojas com a
fatura da concessionária. Se o contrato do shopping tiver demanda contratada ou tarifa
horossazonal, essa soma não fecha por construção — o sistema cobra energia por tarifa
única.

## Notas de implementação

- **CommonJS, não ESM.** O backend deste projeto quebrou em produção por `"type":
  "module"` com imports sem extensão. Aqui não há build nem essa classe de erro.
- **Leitura por bloco, não por grandeza.** São 3 requisições por medidor, não 5.
- **Energia ausente invalida o ciclo.** Sem `kwh` o coletor não publica, em vez de mandar
  registro incompleto que viraria consumo zero no faturamento.
- **O bloco 200 é lido com quantidade 10.** Com 20 o medidor responde "quantidade
  inválida".
