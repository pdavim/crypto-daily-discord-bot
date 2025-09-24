# Deploy no Discord

Siga estas etapas para registrar o bot e disponibilizar os comandos slash no seu servidor.

## 1. Criar a aplicação

1. Acesse o [Portal de Desenvolvedores do Discord](https://discord.com/developers/applications).
2. Clique em **New Application** e forneça um nome reconhecível.
3. Na aba **Bot**, gere um token e habilite as intents necessárias (mensagens, membros e conteúdo de mensagens quando requerido).

> **Importante:** nunca compartilhe o token do bot. Armazene-o em `DISCORD_BOT_TOKEN` dentro do seu `.env`.

## 2. Configurar permissões

Na aba **OAuth2 > URL Generator**:

1. Marque o escopo **bot** e **applications.commands**.
2. Selecione as permissões sugeridas (enviar mensagens, anexar arquivos, usar comandos slash).
3. Copie a URL gerada e autorize o bot no servidor desejado.

## 3. Registrar comandos

O repositório já inclui scripts que sincronizam os comandos automaticamente ao iniciar. Para forçar um registro manual, execute:

```bash
npm run commands:deploy
```

Isso usa as credenciais definidas no `.env` para publicar os comandos globais e específicos de servidor.

## 4. Testar

1. Inicie o bot localmente com `npm start`.
2. No Discord, digite `/chart` ou `/status` e confirme se as sugestões aparecem.
3. Caso os comandos não sejam exibidos, verifique permissões do bot e se o deploy foi realizado no servidor correto.
