# Release Notes

Os marcos abaixo consolidam funcionalidades entregues, a cobertura de testes que garante regressões e links úteis para auditória rápida do projeto.

## vNext

### Funcionalidades principais

- `/binance` fornece um panorama seguro da conta Binance: respostas ephemerais, uso recomendado de chaves somente leitura e degradação suave caso endpoints de margem estejam bloqueados.
- Ajustes de lucro mínimo (`/settings profit`) continuam sincronizados com alertas que aplicam o threshold antes de recomendar entradas.
- Alertas agregados mantêm orientação explícita de buy/sell/hold e ordenação previsível por ativo ou rank de market cap.
- Gráficos e projeções de forecasting seguem disponíveis para validar tendências e comparar o alvo previsto com o histórico recente.

### Cobertura de testes de regressão

| Funcionalidade | Suíte | Garantia fornecida |
| --- | --- | --- |
| Resumo Binance e degradação por permissão | `tests/trading/binance.test.js` e `tests/discordBot.test.js` | Valida autenticação, normalização numérica, respostas ephemerais e tolerância a falhas parciais das APIs.
| Thresholds de lucro configuráveis | `tests/minimumProfit.test.js` e `tests/alerts/tradeLevelsAlert.test.js` | Confirma que limites globais/pessoais são persistidos e avaliados antes de destacar oportunidades.
| Ordenação e orientação dos alertas | `tests/alerts/dispatcher.test.js` e `tests/alerts/messageBuilder.test.js` | Garante ordenação por ativo/rank e mensagens com guidance buy/sell/hold, variações e previsões.
| Gráficos e forecasting | `tests/chart.test.js` | Cobra candlesticks, forecasts e gráficos de crescimento com métricas de confiança e drawdown.

### Documentação e descoberta

- README atualizado com recomendações de segurança, fluxo do comando `/binance` e link direto para estas notas.
- Guia "Credenciais e integrações Binance" ampliado com detalhes do fluxo ephemereal e como lidar com permissões faltantes.
- Página inicial do site destaca as notas de versão e o comportamento seguro do comando `/binance`.

> Consulte as seções anteriores deste documento a cada entrega: mantenha a lista de funcionalidades alinhada ao que está publicado e referencie novas suítes de testes sempre que uma feature ganhar cobertura.
