# Runbook: ElevenLabs, linguas e vozes

Este runbook descreve como configurar a ElevenLabs, carregar o catalogo de vozes e gerar
audios no backend. Os comandos assumem que o terminal esta em `backend/` e que a API local
responde em `http://127.0.0.1:8000`.

## 1. Pre-requisitos

- conta ElevenLabs com acesso as vozes desejadas
- API key valida da ElevenLabs
- PostgreSQL/PostGIS com as migrations aplicadas
- admin inicial criado
- `jq` para executar os exemplos de terminal

Nunca salve a API key no repositorio. Use `backend/.env` local ou as variaveis protegidas do
ambiente de deploy.

## 2. Configurar o ambiente

Copie `backend/.env.example` para `backend/.env` e configure:

```env
ELEVENLABS_API_KEY=sua-chave-real
ELEVENLABS_BASE_URL=https://api.elevenlabs.io/v1
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
ELEVENLABS_TIMEOUT_S=60
ELEVENLABS_DEFAULT_VOICE_ID=
AUDIO_STORAGE_DIR=media
AUDIO_PUBLIC_BASE_URL=/media
AUDIO_UPLOAD_MAX_BYTES=26214400
```

`ELEVENLABS_DEFAULT_VOICE_ID` e opcional e representa o ultimo fallback. Ele so e usado
quando nao existe override, voz do autor, voz da lingua ou voz marcada como default no banco.

Sem `ELEVENLABS_API_KEY`, o backend usa um fallback de teste que grava os bytes do texto no
lugar do MP3. Esse modo serve aos testes automatizados, mas nao valida sintese de voz real.

## 3. Aplicar migrations e carregar o catalogo inicial

```bash
nix develop
uv run alembic upgrade head
uv run python -m app.scripts.seed_languages
```

O seed usa `docs/voice_language_seed.csv`, e idempotente e pode ser repetido. Para carregar
outro arquivo:

```bash
uv run python -m app.scripts.seed_languages /caminho/vozes.csv
```

O catalogo padrao configura `pt`, `en`, `fr`, `zh` e `de`, associa 40 vozes e marca as dez
vozes de portugues europeu como pool default. A migration tambem preserva `es` para bancos
que ja usavam a lista historica de linguas.

## 4. Subir a API e autenticar

```bash
uv run uvicorn app.main:app --reload
```

Em outro terminal:

```bash
API=http://127.0.0.1:8000

TOKEN=$(
  curl -sS -X POST "$API/api/v1/admin/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@example.com","password":"secret"}' \
  | jq -r '.data.access_token'
)
```

Use as credenciais reais de `ADMIN_INITIAL_EMAIL` e `ADMIN_INITIAL_PASSWORD` quando elas
forem diferentes do seed local.

## 5. Sincronizar a conta ElevenLabs

```bash
curl -sS -X POST "$API/api/v1/admin/voices/sync" \
  -H "Authorization: Bearer $TOKEN" | jq
```

A sincronizacao cria vozes novas e atualiza nome e URL de preview. Ela nao remove genero,
associacoes com linguas nem marcacoes default existentes.

Liste as vozes armazenadas:

```bash
curl -sS "$API/api/v1/admin/voices" \
  -H "Authorization: Bearer $TOKEN" | jq
```

Cada item possui dois identificadores:

- `id`: UUID interno, usado nos endpoints de configuracao
- `elevenlabs_id`: ID enviado para a API da ElevenLabs e armazenado nos autores/audios

## 6. Configurar linguas

Liste as linguas:

```bash
curl -sS "$API/api/v1/admin/languages" \
  -H "Authorization: Bearer $TOKEN" | jq
```

Crie uma lingua arbitraria:

```bash
curl -sS -X POST "$API/api/v1/admin/languages" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "it",
    "locale": "it-IT",
    "country_code": "IT",
    "name": "Italian",
    "is_active": true
  }' | jq
```

Defina a lingua-fonte do conteudo:

```bash
curl -sS -X PUT "$API/api/v1/admin/languages/pt/source" \
  -H "Authorization: Bearer $TOKEN" | jq
```

Desativar uma lingua preserva traducoes, audios e jobs historicos:

```bash
curl -sS -X DELETE "$API/api/v1/admin/languages/it" \
  -H "Authorization: Bearer $TOKEN" | jq
```

A lingua-fonte nao pode ser desativada ate que outra lingua ativa seja promovida. Para
reativar:

```bash
curl -sS -X PUT "$API/api/v1/admin/languages/it/activate" \
  -H "Authorization: Bearer $TOKEN" | jq
```

Os campos historicos `content_pt` e `phonetic_content` continuam contendo o texto-fonte. A
troca da lingua-fonte muda a interpretacao do pipeline, mas nao traduz nem reescreve dados.

## 7. Importar configuracao por CSV

O cabecalho aceito e:

```csv
language_code,locale,country_code,language_name,is_source,gender,voice_label,voice_name,elevenlabs_voice_id,is_default
```

Importacao incremental:

```bash
curl -sS -X POST "$API/api/v1/admin/languages/import" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@../docs/voice_language_seed.csv;type=text/csv" | jq
```

Importacao substitutiva:

```bash
curl -sS -X POST "$API/api/v1/admin/languages/import?replace=true" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@../docs/voice_language_seed.csv;type=text/csv" | jq
```

Sem `replace`, o importador cria/atualiza, reativa linguas presentes e adiciona associacoes.
Com `replace=true`, o arquivo passa a definir exatamente as linguas ativas, associacoes,
pool default e lingua-fonte. Vozes e conteudo historico nao sao apagados. O CSV substitutivo
deve declarar exatamente uma lingua com `is_source=true`.

O arquivo inteiro e validado antes da escrita. Qualquer linha invalida rejeita a importacao
sem alteracao parcial.

## 8. Associar vozes a linguas

Uma voz pode atender varias linguas. Use o UUID interno retornado pela listagem:

```bash
VOICE_UUID=uuid-interno-da-voz

curl -sS -X PUT "$API/api/v1/admin/voices/$VOICE_UUID/languages/pt" \
  -H "Authorization: Bearer $TOKEN" | jq

curl -sS -X PUT "$API/api/v1/admin/voices/$VOICE_UUID/languages/fr" \
  -H "Authorization: Bearer $TOKEN" | jq
```

Remova apenas uma associacao:

```bash
curl -sS -X DELETE "$API/api/v1/admin/voices/$VOICE_UUID/languages/fr" \
  -H "Authorization: Bearer $TOKEN" | jq
```

O endpoint antigo `PUT /api/v1/admin/voices/{voice_id}/lang?lang=pt` continua disponivel
temporariamente, mas representa zero ou uma lingua e nao deve ser usado em configuracoes
novas.

## 9. Configurar o pool default

Adicione quantas vozes forem necessarias:

```bash
curl -sS -X PUT "$API/api/v1/admin/voices/$VOICE_UUID/default" \
  -H "Authorization: Bearer $TOKEN" | jq
```

Remova uma voz do pool:

```bash
curl -sS -X DELETE "$API/api/v1/admin/voices/$VOICE_UUID/default" \
  -H "Authorization: Bearer $TOKEN" | jq
```

Quando existem varias candidatas no pool da lingua ou no pool default, a escolha e
aleatoria a cada geracao.

## 10. Atribuir uma voz especifica a um autor

`authors.elevenlabs_voice_id` recebe o ID da ElevenLabs, nao o UUID interno. O `PUT` de autor
substitui o recurso completo, portanto consulte a listagem e envie todos os campos:

```bash
AUTHOR_UUID=uuid-do-autor

curl -sS -X PUT "$API/api/v1/admin/authors/$AUTHOR_UUID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Fernando Pessoa",
    "bio_pt": "Poeta e escritor.",
    "birth_year": 1888,
    "death_year": 1935,
    "photo_url": null,
    "elevenlabs_voice_id": "id-real-da-elevenlabs"
  }' | jq
```

A mesma voz pode ser usada por varios autores.

## 11. Ordem de escolha da voz

O backend resolve a voz nesta ordem:

1. `voice_id` informado explicitamente na requisicao
2. voz especifica do autor
3. escolha aleatoria entre vozes associadas a lingua
4. escolha aleatoria entre vozes marcadas como default
5. `ELEVENLABS_DEFAULT_VOICE_ID`
6. erro `No voice configured for language` se nenhuma opcao existir

No job em lote, evite informar `voice_id` quando quiser respeitar as vozes dos autores e das
linguas.

## 12. Gerar um audio

Para portugues ou para a lingua-fonte atual:

```bash
TEXT_UUID=uuid-do-texto

curl -sS -X POST "$API/api/v1/admin/audio/$TEXT_UUID/pt/generate" \
  -H "Authorization: Bearer $TOKEN" | jq
```

Para outra lingua, deve existir uma traducao com status `approved`:

```bash
curl -sS -X POST "$API/api/v1/admin/audio/$TEXT_UUID/en/generate" \
  -H "Authorization: Bearer $TOKEN" | jq
```

Override operacional de voz:

```bash
curl -sS -X POST \
  "$API/api/v1/admin/audio/$TEXT_UUID/en/generate?voice_id=id-real-da-elevenlabs" \
  -H "Authorization: Bearer $TOKEN" | jq
```

## 13. Gerar todos os audios de uma lingua

O job recebe a lista de textos explicitamente:

```bash
LANG=pt

curl -sS "$API/api/v1/admin/texts" \
  -H "Authorization: Bearer $TOKEN" \
| jq --arg lang "$LANG" '{items: [.data[] | {text_id: .id, lang: $lang}]}' \
> /tmp/audio-job.json

curl -sS -X POST "$API/api/v1/admin/audio/jobs" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data @/tmp/audio-job.json | jq
```

Para linguas diferentes da fonte, os itens sem traducao aprovada falham individualmente.

Na implementação atual, criar o job também processa os itens dentro da mesma requisição HTTP.
O registro persistido e o endpoint SSE existem, mas ainda não há worker assíncrono; evite lotes
grandes até essa evolução ser entregue.

## 14. Onde os arquivos ficam

O backend grava os áudios gerados em disco local:

```text
${AUDIO_STORAGE_DIR}/audio/{text_id}/{lang}.mp3
```

Uploads manuais usam a mesma identidade de texto e idioma, isolados por prefixo:

```text
${AUDIO_STORAGE_DIR}/audio/manual/{text_id}/{lang}.mp3
```

Com os defaults:

```text
backend/media/audio/{text_id}/{lang}.mp3
```

A API publica o arquivo em:

```text
${AUDIO_PUBLIC_BASE_URL}/audio/{text_id}/{lang}.mp3
```

`AUDIO_STORAGE_DIR` precisa estar montado em volume persistente. O procedimento de backup e
restore fica em `docs/runbook_audio_storage.md`.

## 15. Subir ou substituir um MP3 manual

```bash
curl -sS -X PUT "$API/api/v1/admin/audio/$TEXT_UUID/en/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@./narracao-en.mp3;type=audio/mpeg" | jq
```

O backend ignora o nome original para fins de storage, valida o arquivo e atualiza
simultaneamente o registro `audio_files` daquele texto e idioma. Um segundo upload sobrescreve
a mesma chave; não cria arquivos versionados. Se havia áudio gerado, ele é removido após a base
passar a apontar para o arquivo manual.

## 16. Diagnostico rapido

### `401 invalid_api_key`

- confirme `ELEVENLABS_API_KEY`
- reinicie a API depois de alterar `.env`
- valide se a chave pertence ao ambiente/conta corretos

### `Language 'xx' is not active`

- liste `GET /api/v1/admin/languages`
- crie ou reative a lingua
- confira o `language_code` do CSV

### `Approved translation required before audio generation`

- gere ou cadastre a traducao
- aprove explicitamente a traducao
- tente a geracao novamente

### `No voice configured for language 'xx'`

- associe ao menos uma voz a lingua; ou
- marque uma voz como default; ou
- configure `ELEVENLABS_DEFAULT_VOICE_ID`

### Arquivo com extensao MP3, mas sem audio valido

Isso ocorre no fallback de testes quando `ELEVENLABS_API_KEY` esta vazia. Configure uma chave
real e gere novamente.

### Audio manual nao foi substituido

Esse e o comportamento esperado. Registros com `manually_uploaded=true` sao preservados por
geracoes automaticas. Remova o audio manual ou envie outra substituicao manual.

### Sincronizacao retornou voz, mas a geracao falhou

- confirme que a voz continua acessivel na conta ElevenLabs
- confira se o `elevenlabs_id` do autor/catalogo existe na conta
- verifique quota e permissao do modelo `eleven_multilingual_v2`
- consulte `job.last_error` ou a resposta do endpoint de geracao
