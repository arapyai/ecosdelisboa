# Infraestrutura

Referência dos ambientes publicados e da configuração compartilhada. Valores de secrets e
alterações operacionais continuam tendo como fonte de verdade os painéis das plataformas e o
password manager.

## Ambientes e branches

| Ambiente Railway | Branch | Uso |
| --- | --- | --- |
| `development` | `development` | integração e validação ativa |
| produção | `main` | publicação estável |

API e banco são isolados por ambiente. Não copie banco, volume ou secrets entre eles sem um
procedimento explícito de migração.

## URLs publicadas

DNS é gerido no Cloudflare. Cloudflare é usado para DNS, não para storage de áudio.

| Superfície | URL |
| --- | --- |
| API de desenvolvimento | `https://api-dev.lisbon.literarymap.org` |
| API de produção | `https://api.lisbon.literarymap.org` |
| PWA pública | `https://lisbon.literarymap.org` |
| Admin | `https://admin.lisbon.literarymap.org` |

Os nomes de domínio são identificadores legados da infraestrutura. O produto se chama Lisboa
por Outros.

Swagger fica em `/docs` e o schema OpenAPI em `/openapi.json`. Para um sanity check:

```bash
curl https://api-dev.lisbon.literarymap.org/health
```

As quatro URLs acima responderam HTTP 200 na revisão de 16/07/2026. Isso confirma alcance, não
substitui smoke tests de autenticação, banco, CORS, áudio e fluxos editoriais.

## Frontends

PWA e admin são publicados no Netlify. Localmente, configure a API no `.env` do workspace:

```env
VITE_API_BASE_URL=https://api-dev.lisbon.literarymap.org
```

O app Expo usa:

```env
EXPO_PUBLIC_API_BASE_URL=https://api-dev.lisbon.literarymap.org
```

## CORS

`CORS_ORIGINS` é uma lista JSON de origens completas permitidas pelo backend:

```env
CORS_ORIGINS=["http://localhost:5173","http://localhost:5174","https://lisbon.literarymap.org","https://admin.lisbon.literarymap.org"]
```

Inclua cada porta local e cada domínio publicado que chama a API. Mudanças devem ser aplicadas
no ambiente correto do Railway e validadas no navegador.

## Backend no Railway

Configuração esperada por serviço:

- diretório-fonte `backend/`;
- start command `uvicorn app.main:app --host 0.0.0.0 --port $PORT`;
- `DATABASE_URL` ligado ao PostgreSQL do mesmo ambiente;
- `AUDIO_STORAGE_DIR` apontando para um volume persistente;
- `AUDIO_PUBLIC_BASE_URL` configurando o prefixo público dos MP3;
- deploy automático acompanhando a branch do ambiente.

## Variáveis

O contrato completo e os defaults não sensíveis ficam em `backend/.env.example`. Em Railway,
configure ao menos os grupos aplicáveis:

| Grupo | Variáveis principais |
| --- | --- |
| aplicação | `ENVIRONMENT`, `DATABASE_URL`, `CORS_ORIGINS` |
| admin | `ADMIN_SECRET_KEY`, `ADMIN_INITIAL_EMAIL`, `ADMIN_INITIAL_PASSWORD` |
| geocoding | `GEOCODING_BASE_URL`, `GEOCODING_USER_AGENT` e credencial opcional |
| tradução | `TRANSLATION_LLM_PROVIDER`, `TRANSLATION_LLM_MODEL`, `TRANSLATION_LLM_API_KEY` ou `ANTHROPIC_API_KEY` |
| voz | `ELEVENLABS_API_KEY`, `ELEVENLABS_MODEL_ID`, `ELEVENLABS_DEFAULT_VOICE_ID` |
| áudio | `AUDIO_STORAGE_DIR`, `AUDIO_PUBLIC_BASE_URL`, `AUDIO_UPLOAD_MAX_BYTES`, `AUDIO_WORKER_ENABLED` |

Não mantenha uma tabela de quotas de provider neste repositório: limites e preços mudam. Use o
painel e a documentação oficial do provider configurado quando precisar dimensionar uma carga.

## Secrets

- secrets de runtime ficam nas variáveis do Railway;
- a cópia recuperável fica no password manager;
- desenvolvimento e produção devem usar valores distintos para credenciais administrativas;
- nunca registre tokens, URLs de webhook secretas ou senhas nos docs;
- faça rotação imediatamente após suspeita de exposição e valide os consumidores depois.

Para gerar uma chave aleatória:

```bash
openssl rand -base64 48
```

## Áudio persistente

O volume esperado é pequeno, portanto o projeto usa storage local persistente. R2 foi
descartado do escopo atual.

- monte um volume no caminho de `AUDIO_STORAGE_DIR`;
- não use filesystem efêmero do deploy;
- monitore espaço em disco;
- faça backup coordenado do banco e do diretório;
- teste restore em ambiente não produtivo.

O worker de áudio roda dentro do mesmo serviço da API para acessar esse volume. Não crie um
segundo serviço Railway para o worker enquanto os MP3 estiverem em storage local.

Layout, backup e restore estão em `runbook_audio_storage.md`.

## Logs e alertas

Railway coleta `stdout` e `stderr`. Consulte Deployments/Observability para logs e métricas. A
retenção depende do plano vigente e deve ser conferida no painel, sem números fixos neste doc.

Nunca grave passwords, tokens, API keys, JWTs, corpos completos de requisição ou dados pessoais
desnecessários. Erros, stack traces, request IDs, status e latência podem ser registrados desde
que não exponham conteúdo sensível.

Alertas de falha de deploy podem ser ligados por webhooks do Railway e Netlify ao canal adotado
pela equipe. A URL do webhook pertence ao password manager, não ao repositório.

## Checklist de mudança

Ao alterar domínio, branch ou variável:

1. aplique no ambiente correto;
2. valide healthcheck e OpenAPI;
3. valide CORS a partir da PWA e do admin;
4. execute um smoke test de leitura e, quando aplicável, de escrita autenticada;
5. confira persistência do banco e do volume após novo deploy;
6. atualize este documento se o contrato estável mudou.
