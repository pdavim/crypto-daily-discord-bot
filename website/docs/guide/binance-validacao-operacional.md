# Validação operacional do comando `/binance`

Esta lista de verificação documenta como validar o comando `/binance` em um servidor de homologação antes de liberar o recurso para produção.

## Preparação do ambiente

1. Garanta que o bot esteja rodando em um ambiente isolado (homologação/staging) com `ENABLE_BINANCE_COMMAND=true`.
2. Configure credenciais reais da Binance com permissões de **Spot/Margin** e, se quiser conferir derivativos, habilite a flag *Enable Futures*.
3. Certifique-se de que `BINANCE_API_KEY` e `BINANCE_SECRET` foram carregados e validados via `npm exec config-cli secrets check`.
4. Ative o nível de log `info` ou superior e direcione os logs estruturados para arquivo ou observabilidade centralizada.

## Execução do teste manual

1. Em uma sala privada do servidor de homologação, execute `/binance`.
2. Observe se a mensagem é **ephemeral** (visível apenas para você). Caso o Discord mostre uma resposta pública, interrompa os testes e investigue.
3. Valide a formatação das seções:
   - **Ativos monitorados**: respeita a ordem configurada e sinaliza quando a lista é truncada ("+ _n_ ativos adicionais omitidos").
   - **Spot**, **Margem** e **Posições**: valores exibidos em português, com casas decimais coerentes (até 8 casas para cripto, 2 para percentuais).
   - Se uma seção não tiver dados, a linha "Nenhum item encontrado" deve aparecer.
4. Force uma segunda execução imediata para confirmar o tratamento de *rate limiting*. O bot deve responder com "Não foi possível carregar dados da Binance no momento." e logar `err.message: 'rate limit exceeded'`.
5. Desabilite temporariamente o acesso a uma das APIs (por exemplo, removendo permissões de Margin). O bot deve continuar exibindo as demais seções, com um cabeçalho indicando indisponibilidade.
6. Reative a permissão removida e confirme se todas as seções voltam a aparecer no próximo disparo do comando.

## Observabilidade e privacidade

- Abra os logs da aplicação e filtre por `command: 'binance'`.
- Para cada execução, confirme a presença das seguintes entradas:
  - `level:30` informando carregamento bem-sucedido, incluindo `sections` retornados.
  - `level:40` quando uma seção opcional falhar (ex.: `section: 'futuresBalances'`, `reason: 'permissionDenied'`).
  - `level:50` apenas em erros fatais (credenciais ausentes, rate limit), **sem** expor segredos ou payloads sensíveis.
- Verifique se os logs trazem apenas dados agregados (saldos numéricos) e nunca chaves, segredos ou IDs de ordem.
- Salve um relatório de validação (externo ao repositório) com horários das execuções, IDs das mensagens no Discord e hashes das entradas de log coletadas.

## Regressão automatizada

- Execute `npm run test` e `npm run test:coverage` localmente antes do deploy. Ambos os comandos devem passar.
- Confirme no GitHub Actions que o workflow `Test` executa as mesmas etapas (`npm test` seguido de `npm run test:coverage`).
- Ao abrir um PR, anexe links para o run de homologação e para o artefato `coverage/lcov.info` publicado pelo CI.

## Encerramento

1. Revise o checklist acima com a equipe de segurança.
2. Limpe eventuais credenciais temporárias ou permissões extras habilitadas para o teste.
3. Atualize o `CHANGELOG.md` ou nota de release com um resumo da validação manual realizada.

Com esse fluxo, operadores conseguem comprovar que o `/binance` mantém respostas privadas, tolera falhas parciais e está coberto por testes automatizados e monitoramento adequado.
