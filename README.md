# Crypto Daily Discord Bot

[![Test Status](https://img.shields.io/github/actions/workflow/status/OWNER/crypto-daily-discord-bot/test.yml?label=tests&logo=github)](https://github.com/OWNER/crypto-daily-discord-bot/actions/workflows/test.yml)
[![Coverage](https://img.shields.io/badge/coverage-vitest--coverage-blue?logo=vitest)](./package.json)

Bot Discord que entrega análises técnicas, gráficos e alertas diários sobre criptoativos. Ele combina dados de exchanges, cálculos de indicadores e webhooks para manter a comunidade informada sem intervenção manual.

## Visão geral

- Coleta candles e volume da Binance e de outras fontes configuradas.
- Calcula indicadores técnicos e monitora eventos de preço para disparar alertas configuráveis.
- Renderiza gráficos de velas com sobreposições (MAs, bandas, VWAP) e publica imagens diretamente em canais do Discord.
- Agrega notícias, sentimento, métricas on-chain e gera relatórios semanais/mensais via webhook.
- Expõe comandos slash para que qualquer usuário consulte gráficos, análises e configurações on-demand.
- Automatiza execução de trades com salvaguardas, detecção de postura de mercado e logs auditáveis.
- Simula crescimento de portfólio com rebalanceamento, controle de risco e relatórios históricos.
- Prevê fechamentos do próximo timeframe e gera gráficos comparando históricos e projeções.

## O que há de novo

- **Integração Binance de ponta a ponta**: coleta spot/margin, executa ordens e apresenta resumos com o comando `/binance`.
- **Estratégia automática dinâmica**: postura bull/bear altera módulos ativos e o executor respeita limites de drawdown configurados.
- **Previsões e gráficos de tendência**: o módulo de forecasting salva históricos em `reports/forecasts/` e publica visualizações para cada ativo monitorado.
- **Simulação de crescimento 100€ → 10M€**: experimentos longos rodam em background e produzem dashboards com suposições documentadas.
- **Alertas enriquecidos**: payloads ordenados por ativo exibem variação por timeframe e linhas claras de buy/sell/hold.

## Documentação online

- [Site do projeto](https://OWNER.github.io/crypto-daily-discord-bot/) — documentação construída com VitePress e publicada automaticamente via GitHub Pages (ajuste `DOCS_GITHUB_OWNER`, `DOCS_SITE_URL` e `DOCS_BASE` ao gerar o site).
- [Notas de versão](website/docs/guide/releases.md) — resumo das funcionalidades lançadas, cobertura de testes e links úteis para auditorias de regressão.

## Requisitos

| Ferramenta | Versão recomendada | Observações |
|------------|--------------------|-------------|
| Node.js    | 18 LTS ou superior | Necessário para `discord.js` v14 e para módulos ESM.
| npm        | 9 ou superior      | Instala dependências e executa os scripts definidos em `package.json`.
| Conta Discord | — | É preciso criar um aplicativo/bot e registrar os comandos slash no servidor desejado.

Instale as dependências do projeto após clonar o repositório:

```bash
npm install
```

## Configuração do ambiente (`.env`)

1. Duplique o arquivo de exemplo:
   ```bash
   cp .env.example .env
   ```
2. Preencha os tokens do Discord (`DISCORD_BOT_TOKEN`, `DISCORD_WEBHOOK_*`) e chaves externas (Binance, OpenAI, etc.).
3. Ajuste os parâmetros opcionais de performance e indicadores conforme necessário:
   - `MAX_CONCURRENCY` limita quantas análises paralelas podem ocorrer (defina `1` para execução sequencial).
   - `BINANCE_CACHE_TTL_MINUTES` controla a validade do cache de preços compartilhado.
   - Variáveis `INDICATOR_*` permitem sobrescrever períodos de médias, configurações do MACD, multiplicadores de bandas de Bollinger/Keltner, etc.
4. Revise os IDs dos canais/servidores onde os conteúdos serão publicados (`DISCORD_GUILD_ID`, `DISCORD_CHANNEL_CHARTS_ID`, `DISCORD_WEBHOOK_GENERAL`, `DISCORD_WEBHOOK_ALERTS`, ...).
5. Para exportar mensagens para planilhas:
   - Ative o recurso definindo `GOOGLE_SHEETS_ENABLED=true` no `.env` **e** habilitando `googleSheets.enabled` via `npm exec config-cli set googleSheets.enabled true` (o valor do arquivo de configuração vence quando ambos estiverem definidos).
   - Crie uma conta de serviço no [Google Cloud Console](https://console.cloud.google.com/): gere uma chave JSON, compartilhe a planilha com o e-mail da conta e aponte o caminho do arquivo com `GOOGLE_SHEETS_CREDENTIALS_FILE` **ou** cole o JSON no `GOOGLE_SHEETS_CREDENTIALS_JSON`.
   - Obtenha o ID da planilha diretamente da URL (`https://docs.google.com/spreadsheets/d/<ID>/edit`) e informe em `GOOGLE_SHEETS_SPREADSHEET_ID`.
   - Mapeie os canais/relatórios para abas específicas usando `GOOGLE_SHEETS_CHANNEL_MAP` (por exemplo, `{ "1234567890": "alerts-general", "987654321": "portfolio-growth" }`). Webhooks reutilizam a aba mesmo quando mudam o nome exibido.
   - Consulte as [notas de design do exportador](docs/google-sheets-export.md) para detalhes de layout, colunas obrigatórias e regras de normalização.

> 📌 Consulte `.env.example` para descrições completas e exemplos de cada variável disponível.

## Gestão de configuração (`config/default.json`, `.env`, `config-cli`)

- **Não edite `config/default.json` diretamente**: ele contém os valores padrão rastreados no repositório e serve como base de comparação para ambientes locais e produção.
- Para ajustes permanentes, utilize `config/custom.json` — o arquivo é gerado automaticamente quando você aplica alterações pelo utilitário `config-cli` e permanece fora do versionamento.
- Execute `npm exec config-cli list` para visualizar o merge entre `config/default.json` e `config/custom.json`.
- Ajuste opções com `npm exec config-cli set caminho.valor novoValor`; o comando normaliza números/booleanos automaticamente e persiste as alterações em `config/custom.json`.
- Credenciais sensíveis continuam exclusivamente no `.env`. Combine `npm exec config-cli secrets check` com ferramentas de CI/CD para validar se as variáveis obrigatórias foram definidas antes do deploy.
- Em ambientes temporários, exporte variáveis em linha (`ENABLE_BINANCE_COMMAND=false npm run once`) sem alterar arquivos locais.
- Configure o bloco `googleSheets` com `npm exec config-cli set googleSheets.enabled true`, `npm exec config-cli set googleSheets.spreadsheetId "<ID>"` e `npm exec config-cli set googleSheets.channelMap '{"1234567890":"BTC"}'` para redirecionar mensagens automaticamente para abas específicas.

### Frequência das análises automáticas (`analysisFrequency`)

- Controle o agendamento do pipeline principal (`runAll`) via `analysisFrequency` em `config/default.json` ou por `ANALYSIS_FREQUENCY` no ambiente.
- Valores aceites: `5m`, `15m`, `30m`, `hourly`, `2h`, `4h`, `6h`, `12h` e `daily`. Aliases como `5min`, `300s`, `1h`, `60m`, `24h` e `1d` são normalizados para os equivalentes mais próximos.
- Quando um valor inválido for fornecido, o bot regista um aviso nos logs e faz fallback para o modo horário (`hourly`).

## Boas práticas para credenciais da Binance

- Gere chaves **apenas com permissões necessárias**: leitura para alertas e dashboards; ativar "Enable Spot & Margin Trading" somente quando o executor automático for utilizado.
- Restrinja o acesso por **IP allowlist** sempre que possível e mantenha as chaves fora de repositórios, tickets ou screenshots.
- Armazene `BINANCE_API_KEY` e `BINANCE_SECRET` apenas em `.env` locais ou nos segredos do provedor de deploy (GitHub Actions, Railway, etc.).
- Utilize `npm exec config-cli secrets check` (ou pipelines equivalentes) para validar se as variáveis estão presentes antes do deploy.
- Rotacione as chaves periodicamente e monitore os logs de `src/trading/executor.js` para detectar tentativas de uso indevido.

## Fluxo do comando `/binance`

1. **Ative o recurso conscientemente**: por padrão `enableBinanceCommand` vem como `true` no `config/default.json`. Desative-o com `ENABLE_BINANCE_COMMAND=false` ou `enableBinanceCommand: false` sempre que operar em servidores compartilhados.
2. **Forneça credenciais com escopo suficiente**: o resumo precisa de `BINANCE_API_KEY` e `BINANCE_SECRET` válidos com leitura de Spot/Margin. Ative também o flag "Enable Futures" na chave para liberar o saldo USD-M (o bot apenas lê os dados).
3. **Valide antes do deploy**: execute `npm exec config-cli secrets check` para garantir que as variáveis estejam presentes e reinicie o bot para aplicar as mudanças de ambiente/configuração.

- As respostas são sempre **ephemerais** para evitar vazamentos de patrimônio nos canais do Discord.
- Quando alguma permissão (ex.: margem ou futures) estiver desabilitada, o bot degrada o resultado e explica quais seções ficaram indisponíveis em vez de falhar por completo.
- Logs com contexto `accountOverview` registram falhas nas seções individuais para facilitar auditorias sem expor dados sensíveis.
- Ajuste o `binanceCacheTTL` se precisar reduzir chamadas ao endpoint; valores baixos (padrão 10 segundos) deixam o `/binance` mais responsivo durante testes interativos.

## Fluxo do comando `/trade`

1. **Habilite o módulo manualmente**: defina `trading.enabled: true` (via `config/custom.json` ou `npm exec config-cli set trading.enabled true`) e informe `accountEquity` para calcular o limite máximo de exposição.
2. **Conceda permissões apropriadas na chave da Binance**: habilite "Enable Spot & Margin Trading" para operações spot/margem e marque "Enable Futures" quando pretender usar o flag `futures`. Sem essas permissões a API rejeitará as ordens.
3. **Configure limites coerentes**: `trading.minNotional`, `trading.maxPositionPct` e `trading.maxLeverage` são usados para bloquear ordens fora do perfil de risco antes mesmo de chegarem à Binance.

- As respostas são sempre efêmeras e retornam resumos como `Operação BUY BTCUSDT confirmada (MARKET • spot)` com quantidade, valor notional, preço de referência e ID da ordem (quando disponível).
- Quando `margin: true` é informado, o bot invoca automaticamente `transferIn` e, para vendas/shorts, `borrow` no módulo de margem antes de abrir a posição.
- Com `futures: true`, a ordem é encaminhada pelo executor (`openPosition`) compartilhando as mesmas salvaguardas (notional mínimo/máximo) aplicadas nas automações.
- Informe pelo menos `notional` ou a combinação `quantity + price` para que o bot valide os limites — ordens abaixo de `trading.minNotional` ou acima do limite calculado (`accountEquity * maxPositionPct * maxLeverage`) são rejeitadas com mensagens orientativas.

### Logs e auditoria automática

- Ative `TRADING_DISCORD_ENABLED=true` e informe `TRADING_DISCORD_WEBHOOK_URL` para receber no Discord cada decisão da automação (execuções, skips e erros) com contexto de direção, quantidade e motivo.
- Defina `TRADING_LOGGING_SHEET_KEY` (ou configure um `channelMap` no bloco `googleSheets`) para enviar os mesmos eventos para a planilha integrada; cada linha inclui `status`, `action`, `symbol`, `confidence`, `quantity`, `reason` e dados adicionais.
- A menção opcional `TRADING_DISCORD_MENTION` permite sinalizar o time de operações (`@here`, `@risk`, etc.) sempre que uma ação for registrada.

### Exemplos rápidos

- **Spot**: `/trade buy symbol:BTCUSDT quantity:0.01 price:25000` — envia uma ordem MARKET de compra após verificar que o notional (~250) está acima do mínimo.
- **Margem**: `/trade sell symbol:ETHUSDT quantity:0.5 price:1600 margin:true` — transfere fundos para a margem, realiza borrow automático para short e abre a posição via `openPosition`.
- **Futures**: `/trade buy symbol:SOLUSDT quantity:5 price:110 futures:true order_type:LIMIT` — encaminha a ordem para o executor de futures validando o limite de exposição calculado.

## Execução

| Tarefa | Comando | Descrição |
|--------|---------|-----------|
| Rodar o agendador com todos os jobs | `npm start` | Mantém o bot ativo, publica gráficos, notícias e alertas conforme as rotinas configuradas. |
| Executar apenas um ciclo de coleta/postagem | `npm run once` | Útil para validar integrações em ambientes de teste ou CI. |
| Limpeza completa de artefatos | `npm run cleanup:artifacts` | Remove conteúdo de `logs/`, `reports/`, `charts/` e `coverage/`, preservando apenas os `.gitkeep` rastreados. |
| Limpar relatórios antigos | `npm run cleanup:reports` | Remove arquivos obsoletos em `reports/` e `data/`. |
| Documentação do site (modo dev) | `npm run site:dev` | Sobe o VitePress em `http://localhost:5173/crypto-daily-discord-bot/` para edição local. |
| Gerar build estática do site | `npm run site:build` | Compila a documentação para `.vitepress/dist`, usada no deploy do GitHub Pages. |
| Testes unitários | `npm test` | Executa a suíte do Vitest. |
| Cobertura de testes | `npm run test:coverage` | Gera relatório de cobertura V8 (salvo em `coverage/`). |
| Renderização de gráfico isolado | `npm run test:chart` | Gera um gráfico localmente para debug dos assets/timeframes. |
| Lint e formatação | `npm run lint` | Valida sintaxe ESM, indentação (4 espaços) e convenções de aspas. |
| Ajustes automáticos | `npm run lint:fix` | Executa o lint com correções automáticas sempre que possível. |

## Estrutura dos módulos

O repositório segue uma organização modular para manter responsabilidades isoladas e refletidas na suíte de testes:

- **`src/alerts/`** — Coleção de detectores especializados (`trendAlert`, `bollingerAlert`, `variationMetrics`, etc.) que transformam indicadores em payloads prontos para publicação. Os arquivos `dispatcher.js`, `messageBuilder.js` e `decision.js` centralizam enfileiramento, formatação e priorização dos alertas antes de chegarem ao Discord.
- **`src/ai.js`** — Orquestra o agente de análise assistido por IA. Usa indicadores técnicos, notícias (`news.js`), buscas na web (`websearch.js`) e fallback heurístico para gerar relatórios detalhados quando a API da OpenRouter está indisponível.
- **`src/data/`** — Adaptadores para dados externos. `binance.js` e `binanceStream.js` fazem coleta/cache de candles; `economic.js` monitora calendário macroeconômico; `newsapi.js` e `serpapi.js` fornecem notícias e snippets para enriquecer relatórios.
- **`src/reporter.js`** — Converte snapshots técnicos em PDFs, aplica heurísticas de pontuação e exporta helpers (`pct`, `fmt`, `buildSnapshotForReport`) reutilizados em relatórios semanais/mensais e no site.

Cada diretório de `tests/` espelha essa estrutura (`tests/alerts/`, `tests/ai.test.js`, `tests/data/`, `tests/reporter.test.js`) garantindo que novas funcionalidades venham acompanhadas de cobertura automatizada.

### Logs e compatibilidade

- Em ambientes Windows ou com Node.js 22+, o bot força o modo de escrita síncrona dos logs para evitar falhas no worker do transporte rotativo.
- Defina `LOG_SYNC=false` caso queira reativar o transporte assíncrono manualmente (por exemplo, em servidores Linux). Use `LOG_SYNC=true` ou o comando `npm run once` para garantir flush imediato em execuções únicas.
- Se o transporte rotativo não puder ser inicializado, o bot faz fallback automático para o `stdout`, garantindo que as mensagens continuem disponíveis no console.

## CLI de configuração

Gerencie `config/custom.json` sem editar arquivos manualmente utilizando o helper disponível no diretório `bin/`:

```bash
npm exec config-cli list
```

Comandos comuns:

- `npm exec config-cli list` – imprime a configuração mesclada com formatação legível.
- `npm exec config-cli get alerts.modules.rsi` – inspeciona um valor aninhado usando notação por pontos.
- `npm exec config-cli set alerts.modules.rsi false` – persiste valores (números, booleanos e strings JSON são convertidos automaticamente).

## Comandos do Discord

| Comando | Argumentos | O que faz |
|---------|------------|-----------|
| `/help` | — | Lista todos os comandos disponíveis diretamente no Discord. |
| `/chart ativo:<ticker> tf:<timeframe>` | `ativo` (lista de chaves suportadas), `tf` (timeframes como `15m`, `1h`, `4h`, `1d`, `45m`, etc.) | Renderiza um gráfico de candles com indicadores sobrepostos e devolve a imagem no canal/DM. |
| `/watch add ativo:<ticker>` | — | Adiciona o ativo à watchlist pessoal do usuário. |
| `/watch remove ativo:<ticker>` | — | Remove o ativo da watchlist pessoal. |
| `/status` | — | Mostra uptime, watchlist pessoal e previsões bull/bear recentes para cada ativo monitorado. |
| `/analysis ativo:<ticker> tf:<timeframe>` | — | Executa a mesma análise automática usada nos alertas, retornando um resumo textual. |
| `/settings risk percent value:<0-5>` | `value` (percentual) | Atualiza o risco por trade aplicado na estratégia automática. |
| `/settings profit view` | — | Mostra o lucro mínimo padrão, o pessoal (quando configurado) e o valor aplicado nas análises. |
| `/settings profit default value:<0-100>` | `value` (percentual) | Define o lucro mínimo global aplicado aos relatórios e análises. |
| `/settings profit personal value:<0-100>` | `value` (percentual) | Define o seu lucro mínimo pessoal aplicado às suas interações. |
| `/trade buy symbol:<par> quantity/notional order_type price margin futures` | `symbol` (par Binance), `quantity` ou `notional`, `order_type` (`MARKET`/`LIMIT`), `price`, flags `margin` e `futures` | Envia ordens spot, margem ou futures após validar limites de risco/notional configurados. |
| `/binance` | — | Exibe saldo spot, métricas de margem e posições agregadas com base nas credenciais configuradas. |

Todos os comandos são registrados automaticamente quando o bot inicia e exigem permissões de aplicação no servidor configurado.

### Previsões em tempo real no `/status`

O comando `/status` agora adiciona uma seção `🔮` para cada ativo da sua watchlist, listando as previsões mais recentes nos timeframes de 5m, 15m, 30m, 1h e 4h. Cada linha traz:

- **Direção prevista**: o emoji 🐂 indica cenário de alta (delta positivo) e 🐻 sinaliza pressão de baixa (delta negativo). Quando o modelo está neutro, o rótulo aparece como ➖.
- **Preço estimado**: o valor previsto para o próximo fechamento naquele timeframe, já formatado em reais/dólares conforme a localidade configurada.
- **Delta percentual**: variação proporcional em relação ao último fechamento conhecido, útil para contextualizar a magnitude do movimento projetado.

Quando ainda não há histórico para um timeframe específico, o bot mostra `—`, reforçando que nenhuma previsão foi persistida para aquele horizonte.

## Feedback do `/ask` e preparação para fine-tuning

O fluxo do comando `/ask` grava cada resposta em uma tabela Postgres `feedback` com as colunas `id`, `question`, `answer`, `sources`, `rating`, `approved` e `created_at`. Assim que a mensagem é enviada ao usuário, o bot chama `recordInteraction` para persistir a pergunta, a resposta e as fontes; quando alguém clica nos botões 👍/👎 o `recordFeedback` atualiza a mesma linha com a avaliação e expõe contadores em `/metrics` (`app_feedback_interactions_total` e `app_feedback_ratings_total{rating="up|down"}`).

Para moderar exemplos antes de usá-los em fine-tuning:

1. Revise as interações recentes filtrando avaliações pendentes:
   ```sql
   SELECT id, question, answer, sources, rating, created_at
   FROM feedback
   WHERE rating IS NOT NULL AND COALESCE(approved, FALSE) = FALSE
   ORDER BY created_at DESC;
   ```
2. Valide se a resposta está correta, cita fontes adequadas e segue o tom desejado.
   Se estiver tudo certo, aprove com:
   ```sql
   UPDATE feedback SET approved = TRUE WHERE id = <id>;
   ```
3. Gere o dataset de treinamento lendo apenas os exemplos aprovados via `listApprovedExamples()` ou diretamente no banco:
   ```sql
   SELECT question, answer, sources
   FROM feedback
   WHERE approved = TRUE
   ORDER BY created_at;
   ```
4. Execute `npm run build:fine-tune` para transformar os exemplos aprovados em `data/fine-tune.jsonl`. O script consolida os snapshots e indicadores citados nas fontes locais e garante que o arquivo seja criado com final de linha apropriado.

O comando pode ser executado quantas vezes for necessário; ele recria o arquivo de saída sempre que novos exemplos forem aprovados.

O processo garante que apenas respostas revisadas manualmente abasteçam pipelines de fine-tuning ou RAG supervisionado, mantendo a qualidade das instruções.

### Ajuda paginada no Discord

- O comando `/help` agora fraciona a resposta em múltiplas mensagens efêmeras sempre que a listagem completa ultrapassar o limite de 2 000 caracteres imposto pelo Discord.
- A primeira página chega como resposta direta ao slash command e páginas adicionais são entregues como *follow-ups* efêmeros — percorra-as na ordem em que aparecem para consultar detalhes de subcomandos extensos como `/settings`.
- Cada página mantém a mesma formatação hierárquica (indentação e bullets) para facilitar a leitura, mesmo quando uma seção é dividida em mais de um bloco.

## Indicadores calculados

Os módulos de indicadores (`src/indicators.js`) oferecem cálculos reutilizados em relatórios, gráficos e alertas. Entre eles:

- **Médias móveis simples (SMA) e exponenciais (EMA)** – usadas em cruzamentos, suporte/resistência dinâmicos e canais.
- **Índice de Força Relativa (RSI)** – sinaliza sobrecompra/sobrevenda com períodos configuráveis.
- **MACD** (linha, sinal e histograma) – identifica convergência/divergência de médias.
- **Bandas de Bollinger e Canal de Keltner** – delimitam volatilidade para alertas de breakout.
- **Parabolic SAR** – monitora reversões de tendência com fator de aceleração ajustável.
- **VWAP** e **divergência de volume** – combinam preço/volume para detecção de fluxos anormais.

Esses cálculos são parametrizados via `CFG.indicators` e podem ser sobrescritos por variáveis de ambiente, permitindo ajustes sem alterar o código.

## Alertas disponíveis

A pasta `src/alerts/` centraliza os módulos responsáveis por disparar notificações quando determinadas condições são atendidas. Exemplos:

- **Tendência e momentum**: `trendAlert`, `adxAlert`, `macdAlert`, `rsiAlert`, `stochasticAlert` e `williamsAlert`.
- **Bandas e volatilidade**: `bollingerAlert`, `atrAlert`, `sarAlert`, `varAlert`.
- **Volume e fluxo**: `volumeAlert`, `obvAlert`, `vwapAlert`, `emaCrossoverAlert`.
- **Preço e níveis**: `highLowAlert`, `roundNumberAlert`, `tradeLevelsAlert`, `priceInfoAlert`, `maPriceAlert`.
- **Heurísticas compostas**: `heuristicAlert` combina múltiplos sinais para priorizar eventos relevantes.

Todos os módulos utilizam `alertCache` para evitar duplicidade e respeitam configurações de intensidade, canais e horários definidas em `config/*.json`.

### Resumo diário com recomendações

Além da listagem de alertas, o bot publica um resumo consolidado por ativo exibindo:

- A decisão `buy/sell/hold` mais recente calculada pelo avaliador de postura, mesmo na ausência de novos alertas.
- A recomendação textual (`guidance`) e a variação percentual por timeframe.
- Um tamanho de posição estimado a partir de `CFG.accountEquity` combinado com `CFG.riskPerTrade`, ajudando a dimensionar a exposição.

Configure o canal dedicado definindo `webhookGeneral` em `config/custom.json` ou exportando `DISCORD_WEBHOOK_GENERAL`. Caso nenhum webhook geral esteja disponível, o bot tenta usar `CFG.webhook` como fallback e registra um aviso quando também não estiver definido.

### Webhooks dedicados por fluxo

Para manter os canais organizados, configure webhooks específicos para cada tipo de entrega:

- `webhookAlerts` concentra alertas intradiários e continua sendo a referência para `sendDiscordAlert`, reutilizando `CFG.webhook` apenas quando nenhum webhook dedicado estiver definido.
- `webhookAnalysis` recebe os relatórios técnicos gerados por `postAnalysis`. É possível sobrescrever por ativo com chaves como `webhookAnalysis_BTC`, `webhookAnalysis_ETH` etc.; quando inexistentes, o bot recorre ao webhook global de análise antes de considerar os canais de relatório.
- `webhookReports` agrega os relatórios consolidados (semanal, mensal e PDF do sumário diário) e é o fallback padrão para uploads quando nenhum webhook de análise está disponível.
- `webhookDaily` permanece reservado para o resumo diário (`assetKey === 'DAILY'`) quando não há canais de análise configurados.
- `webhookMonthly` direciona o relatório mensal com gráficos anexados.

## Recuperação aumentada por geração (RAG)

O bloco `rag` de `config/default.json` organiza as integrações de busca vetorial utilizadas pelos agentes de IA:

- `pgUrl` define a URL de conexão com o Postgres que possui a extensão `pgvector` habilitada.
- `embeddingModel` indica o modelo responsável por gerar os vetores (`RAG_EMBEDDING_MODEL`).
- `chunkSize` e `chunkOverlap` controlam o fracionamento dos textos antes da vetorização, via utilitário compatível com ESM (`@langchain/textsplitters`).
- `ingestCron` agenda a rotina de ingestão automática; sobrescreva com `RAG_INGEST_CRON` para ajustar a cadência.
- `searchLimit` limita a quantidade de chunks retornados em buscas (`RAG_SEARCH_LIMIT`).
- `activeModel` registra o modelo atual usado para responder consultas (`RAG_ACTIVE_MODEL`).
- `candidateModel` guarda o modelo em avaliação para experimentos A/B (`RAG_CANDIDATE_MODEL`).
- `modelRegistry` define onde registrar metadados de modelos fine-tunados (por padrão `public.rag_models`).
- `fineTuneCron` controla o agendamento da rotina de fine-tuning quando habilitada (`RAG_FINE_TUNE_CRON`).
- `enableFineTune` ativa o cron de fine-tuning — o job só é criado quando este valor for `true` ou `RAG_ENABLE_FINE_TUNE=true`.

As mesmas chaves podem ser definidas por variáveis de ambiente `RAG_*`, que prevalecem sobre `config/custom.json` em tempo de execução.

### Fine-tuning de modelos RAG

1. Gere o dataset consolidado com feedback aprovado via `npm run build:fine-tune` (gera `data/fine-tune.jsonl`).
2. Inicie o job de fine-tuning com `npm run fine-tune`; opcionalmente informe outro caminho com `npm run fine-tune -- --file ./custom.jsonl` e altere o modelo base com `--model`.
3. O script `scripts/run-fine-tune.js` sobe o arquivo para a API da OpenAI, acompanha o status (`queued` → `running` → `succeeded/failed`) e, em caso de sucesso, registra o modelo em `CFG.rag.modelRegistry` usando o Postgres definido por `CFG.rag.pgUrl`.

Para agendar o pipeline automaticamente, habilite `rag.enableFineTune` e defina `rag.fineTuneCron` no `config/custom.json` (ou exporte `RAG_ENABLE_FINE_TUNE=true`). O cron scheduler de `src/index.js` importa dinamicamente o script e grava logs estruturados a cada execução. O atalho `npm run fine-tune:schedule` inicia o bot com o agendamento ativado imediatamente.

### Promoção, canário e rollback de modelos personalizados

- **Registro e auditoria**: após cada execução bem-sucedida, confira a entrada gravada em `rag.modelRegistry` (por padrão `public.rag_models`) para obter `jobId`, `trainingFileId` e metadados do modelo. Esse registro serve como trilha de auditoria e fonte para dashboards.
- **Canário controlado**: atribua o modelo recém-criado a `CFG.rag.candidateModel` (via `config-cli set rag.candidateModel <modelo>`). O bot continuará respondendo com `CFG.rag.activeModel`, mas você pode direcionar requisições canário manualmente apontando agentes específicos para o candidato.
- **Promoção definitiva**: quando o canário estiver validado, mova-o para `CFG.rag.activeModel` e limpe `candidateModel`. O processo é revertido automaticamente caso o canário não esteja definido.
- **Rollback rápido**: mantenha o último modelo aprovado registrado em `rag.modelRegistry`. Caso um deploy degrade a qualidade, reatribua `CFG.rag.activeModel` ao identificador anterior (ou simplesmente remova o valor atual) para voltar ao baseline original sem recriar jobs.

## Monitoramento e relatórios

- As entradas de deduplicação de alertas são expurgadas diariamente e também no start do processo, mantendo o cache coerente entre execuções longas e jobs efêmeros.
- A watchlist e o cache de alertas são limpos quando vazios, mantendo `data/` organizado em ambientes limpos e na suíte de testes.
- Snapshots de performance são salvos em `reports/weekly.json` para compor gráficos de retorno sem necessidade de postagens diárias.
- No primeiro dia de cada mês, o bot compila o desempenho acumulado e envia um relatório visual via webhook mensal (`DISCORD_WEBHOOK_MONTHLY`).

## Links úteis

- [Discord: criando webhooks](https://support.discord.com/hc/pt-br/articles/228383668)
- [Cron jobs com Node.js](https://blog.logrocket.com/how-to-use-node-cron/)
- [Guia da API Spot Binance](https://binance-docs.github.io/apidocs/spot/en/)

O bot registra avisos quando webhooks obrigatórios não estão configurados e interrompe execuções críticas, garantindo falhas rápidas em ambientes de produção.

## Dashboard web

O projeto inclui um painel opcional para monitorar forecasts, alertas e métricas de saúde do bot em tempo real.

### Como iniciar as APIs

1. Ajuste o `config/default.json` ou `config/custom.json` caso deseje alterar porta, token ou desativar o painel (`dashboard.enabled`).
2. Execute o bot normalmente (`npm run start`). O servidor de métricas continuará exposto em `/metrics` e o novo endpoint JSON ficará disponível em `http://localhost:3100` (ou na porta definida).
3. Use a variável `DASHBOARD_TOKEN` para definir o token local esperado nas requisições HTTP (o padrão é `local-dev-token`).

Endpoints principais:

- `GET /api/assets`: retorna ativos configurados, snapshots de forecast e links para gráficos.
- `GET /api/alerts`: expõe o histórico recente de alertas agregados ou de guidance.
- `GET /api/portfolio`: consolida trades gravados no `tradeLog` em métricas de PnL e posições abertas.
- `GET /api/health`: replica o estado atual do registro Prometheus e estatísticas de processo.

### Como executar o front-end

1. Instale as dependências do painel: `npm install` dentro da pasta `dashboard/`.
2. Inicie o modo desenvolvimento: `npm run dev -- --host` (em `dashboard/`). O Vite abrirá o painel em `http://localhost:5173`.
3. Informe o token configurado (por padrão `local-dev-token`). A aplicação passa a realizar polling a cada 15 segundos para atualizar cards, feed de alertas e curva de equity.

Para build de produção utilize `npm run build` seguido de `npm run preview` na pasta `dashboard/`.

### Testes e smoke tests

- Testes do bot principal: `npm test`.
- Smoke tests do painel: `npm run test` dentro de `dashboard/` (usa Vitest + Testing Library).

## FAQ

### O que é este crypto trading bot?

É uma automação que coleta dados de exchanges, calcula indicadores técnicos e envia decisões recomendadas diretamente para o seu servidor. Apesar de não executar ordens por você, o crypto trading bot concentra insights prontos para orientar entradas, saídas e estratégias diárias.

### Como funcionam os Discord alerts do projeto?

Os módulos de alertas monitoram variações de preço, volume e sentimento em tempo real. Quando uma condição configurada é disparada, o bot gera Discord alerts com gráficos, texto e links relevantes no canal escolhido, mantendo todo o time informado sem precisar abrir dashboards externos.

### Posso personalizar indicadores e frequência dos envios?

Sim. Ajuste os indicadores ativos, thresholds e cadência diretamente nos arquivos de configuração ou variáveis de ambiente. Assim, os avisos chegam de acordo com o perfil de risco desejado, seja para acompanhar scalps, swing trades ou relatórios semanais para a comunidade.
