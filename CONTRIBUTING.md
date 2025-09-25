# Guia de Contribuição

Este documento resume o fluxo esperado para desenvolver novas funcionalidades e garantir que o repositório permaneça alinhado às diretrizes do projeto.

## Preparação do ambiente

1. Instale as dependências do Node:
   ```bash
   npm install
   ```
2. Copie o arquivo de variáveis e configure credenciais locais:
   ```bash
   cp .env.example .env
   ```
3. Utilize o utilitário de configuração para validar segredos e sobrepor valores sem editar JSON manualmente:
   ```bash
   npm exec config-cli list
   npm exec config-cli set alerts.modules.rsi true
   ```

## Fluxo de trabalho recomendado

1. **Linter e formatação** — Execute `npm run lint` para garantir sintaxe ESM, indentação de 4 espaços e convenções de aspas (imports com aspas duplas; logs com aspas simples). Use `npm run lint:fix` para aplicar correções automáticas quando disponíveis.
2. **Testes unitários** — Rode `npm test` durante o desenvolvimento. Antes de abrir PR, gere também `npm run test:coverage` para validar os thresholds mínimos definidos no `vitest.config.js`.
3. **Documentação** — Sempre que APIs, comandos ou fluxos mudarem, atualize `README.md` e regenere a documentação com `npm run docs`. Para iterar na documentação do site, utilize `npm run site:dev`.
4. **Limpeza de artefatos** — Evite subir diretórios gerados (`coverage/`, `charts/`, `reports/`, `logs/`). Use `npm run cleanup:reports` antes de commitar quando arquivos temporários forem criados.
5. **Commits** — Utilize mensagens imperativas descrevendo a mudança (ex.: `Adiciona verificação de cache da Binance`). Squashe commits intermediários barulhentos antes de abrir o PR.

## Estrutura de testes

- Crie arquivos em `tests/` espelhando o caminho de origem (ex.: `src/data/binance.js` → `tests/data/binance.test.js`).
- Utilize o Vitest para mocks (`vi.mock`) e timers (`vi.useFakeTimers`), resetando estados compartilhados entre casos.
- Registre lacunas de cobertura deliberadas na descrição do PR para manter rastreabilidade.

Seguindo estes passos, novas contribuições permanecerão consistentes com as expectativas de qualidade do projeto.
