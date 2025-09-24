# Introdução

Este guia resume os passos essenciais para colocar o Crypto Daily Discord Bot em funcionamento e entender a estrutura do repositório.

## Arquitetura

O projeto é dividido em módulos que coletam dados de exchanges, calculam indicadores técnicos e publicam mensagens formatadas no Discord. Alguns diretórios importantes:

- `src/` — código fonte principal do bot e dos jobs agendados.
- `config/` — arquivos JSON com as configurações padrão de alerts, ativos e templates.
- `data/` — cache local com candles, resultados de indicadores e snapshots de performance.
- `charts/` — imagens dos gráficos gerados para publicação.
- `docs/` — documentação técnica gerada automaticamente a partir do código via `jsdoc`.

## Pré-requisitos

- Node.js 18 LTS ou superior.
- Conta do Discord com permissão para criar aplicações e webhooks.
- Chaves de APIs externas (Binance, serviços de notícias e métricas on-chain) quando aplicável.

## Configuração inicial

1. Instale as dependências do projeto raiz:
   ```bash
   npm install
   ```
2. Copie o arquivo de variáveis de ambiente e ajuste os valores:
   ```bash
   cp .env.example .env
   ```
3. Atualize tokens, webhooks e parâmetros extras conforme necessidade.

## Executando localmente

Use os scripts definidos no `package.json` para iniciar o bot:

```bash
npm start
```

Para um ciclo único de coleta/publicação, utilize:

```bash
npm run once
```

Os testes unitários estão disponíveis via:

```bash
npm test
```

Com isso você valida integrações antes de hospedar o serviço em produção.
