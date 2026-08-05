# Lisboa por Outros Backend

Backend do projeto Lisboa por Outros, implementado com FastAPI, SQLAlchemy 2, Alembic e PostgreSQL/PostGIS.

## Stack
- Python 3.12
- FastAPI
- SQLAlchemy 2
- Alembic
- PostgreSQL 16 + PostGIS
- pytest
- uv
- Nix (`nix develop`)

## Ambiente local
O projeto usa `flake.nix` para preparar a toolchain e `uv` para gerir dependencias Python.

Este README assume que os comandos abaixo sao executados dentro de `backend/`.

### Entrar no shell
```bash
nix develop
```

### Instalar dependencias
```bash
uv sync --dev
```

### Variaveis de ambiente
Copie `.env.example` para `.env` e ajuste os valores locais.

Variaveis principais:
- `DATABASE_URL`
- `ADMIN_SECRET_KEY`
- `ADMIN_ACCESS_TOKEN_EXPIRE_MINUTES`
- `ADMIN_INITIAL_EMAIL`
- `ADMIN_INITIAL_PASSWORD`
- `CORS_ORIGINS`
- `TRANSLATION_LLM_PROVIDER`, `TRANSLATION_LLM_MODEL` e credencial do provider
- `ELEVENLABS_API_KEY` e configuracao de voz
- `AUDIO_STORAGE_DIR`, `AUDIO_PUBLIC_BASE_URL` e `AUDIO_UPLOAD_MAX_BYTES`
- `ROUTING_PROVIDER`, `OPENROUTESERVICE_API_KEY`, timeout e retries de roteamento
- `ROUTE_REQUIRED_LANGUAGES` e `ROUTE_CURATORIAL_VOICE_IDS`

## Desenvolvimento

### Subir a API
```bash
uv run uvicorn app.main:app --reload
```

### Rodar testes
```bash
uv run pytest
```

### Rodar lint
```bash
uv run ruff check .
```

### Aplicar migrations
```bash
uv run alembic upgrade head
```

### Banco local e seed de desenvolvimento

O backend esta configurado por padrao para PostgreSQL/PostGIS em `backend/.env`:

```env
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/lisboa_por_outros
```

Crie o banco `lisboa_por_outros` no seu PostgreSQL local, garanta que PostGIS esta instalado, e rode:

```bash
uv run alembic upgrade head
uv run python -m app.scripts.seed_dev
```

O seed e idempotente e cria dados minimos para desenvolvimento:

- admin inicial
- catalogo de linguas e vozes de `../docs/voice_language_seed.csv`
- autores
- pontos
- textos
- traducoes EN aprovadas
- percurso narrativo “Do Tejo ao Chiado” em rascunho, com jobs de áudio enfileirados após o seed

Login admin local:

```text
admin@example.com
secret
```

### Seed administrativo de deploy

O Railway usa `railway.toml` para aplicar migrations e executar
`python -m app.scripts.seed_admin` antes de iniciar a API. Esse seed cria somente o primeiro
administrador e apenas quando `admin_users` não possui nenhuma linha. Ele não substitui o seed de
desenvolvimento nem cria autores, pontos ou outros dados editoriais.

Staging e produção exigem valores não padrão em `ADMIN_INITIAL_EMAIL` e
`ADMIN_INITIAL_PASSWORD`, com senha de pelo menos 12 caracteres. Consulte
`../docs/runbook_admin_users.md` antes de alterar o ciclo de deploy ou recuperar acesso.

## Estrutura
```text
app/
  api/
    routes/
  core/
  models/
  schemas/
  services/
alembic/
tests/
```

## Convencoes do projeto
- Todos os endpoints retornam envelope `{data, meta}`.
- Endpoints publicos sao read-only.
- Endpoints admin exigem Bearer JWT.
- Traducoes nunca sao aprovadas automaticamente.
- Audios com `manually_uploaded=true` nao sao sobrescritos por geracao automatica.
- Mudancas de schema exigem migration Alembic.

## Endpoints principais

### Publicos
- `GET /health`
- `GET /api/v1/points`
- `GET /api/v1/points/{id}`
- `GET /api/v1/authors[?lang=en]`
- `GET /api/v1/authors/{id}[?lang=en]`
- `GET /api/v1/routes[?lang=en]`
- `GET /api/v1/routes/{id}[?lang=en]`
- `GET /api/v1/routes/{id}/gpx[?lang=en]`
- `GET /api/v1/routes/{id}/podcast.rss[?lang=en]`
- `GET /api/v1/voices/default` (sorteia uma voz do pool default)
- `GET /api/v1/languages`

### Admin
- `POST /api/v1/admin/auth/login`
- `GET /api/v1/admin/auth/me`
- CRUD de autores, pontos, textos e rotas em `/api/v1/admin/*`
- editor, readiness e recálculo pedonal de percursos em `/api/v1/admin/routes/*`
- Importacao CSV de textos, autores, pontos e traducoes em `/api/v1/admin/points/import/*`, com
  template baixavel em `/api/v1/admin/points/import/template`
- Traducoes em `/api/v1/admin/translations/*`
- Traducoes de autores e rotas em `/api/v1/admin/{authors|routes}/{id}/translations/*`
- Vozes em `/api/v1/admin/voices/*`
- Linguas e importacao do catalogo em `/api/v1/admin/languages/*`
- Audio e jobs em `/api/v1/admin/audio/*`

## Fluxos implementados

### CSV
- Preview de importacao antes de confirmar.
- Template baixavel e gerado a partir dos idiomas ativos.
- Criação ou reutilização de autores, pontos, textos e traduções fornecidas.
- Correspondência segura de pontos por nome, endereço e proximidade, com geocoding quando
  necessário.
- Idempotência de textos por ponto, autor e fonte; sem fonte, o conteúdo participa da identidade.
- Traduções opcionais em `content_<idioma>` e `author_bio_<idioma>`.
- Importação não dispara tradução automática nem áudio.

O contrato completo, inclusive regras de deduplicação, está em
`../docs/importacao_csv_conteudo.md`.

### Traducoes
- Gera traducao automatica com status `pending`.
- Usa provider LLM configuravel, com `claude` como padrao.
- Revisao humana explicita para `approved` ou `rejected`.
- Traducoes podem ser criadas, sobrescritas ou removidas manualmente sem reimportar CSV.

### Audio
- Resolve a voz por override explicito, autor, pool da lingua, pool default e variavel de ambiente.
- Uma voz pode atender varias linguas e varios autores.
- Varias vozes podem compor o pool default.
- Upload manual recebe MP3 multipart em `PUT /api/v1/admin/audio/{text_id}/{lang}/upload`.
- Upload manual fica em `audio/manual/{text_id}/{lang}.mp3` e pode sobrescrever o áudio da
  língua sem acumular versões antigas.
- Ao substituir áudio gerado por manual, o arquivo gerado anterior é removido.
- Upload manual é preservado contra regeneração automática, sem chamar a ElevenLabs.
- Audio pode ser removido por texto e lingua para permitir nova geracao ou novo upload.
- O limite padrão de upload é 25 MiB e pode ser alterado por `AUDIO_UPLOAD_MAX_BYTES`.

Backup e restore do banco e do volume de áudio estão documentados em
`../docs/runbook_audio_storage.md`.

### Jobs e SSE
- Jobs de geracao de audio sao persistidos na base.
- Progresso pode ser consumido por `text/event-stream`.
- `POST /api/v1/admin/audio/jobs` apenas valida e enfileira o lote, retornando `pending`.
- Um worker interno do mesmo serviço processa a fila fora da requisição e compartilha o volume
  local da API.
- Jobs interrompidos em `running` são recuperados no próximo startup; itens concluídos não são
  repetidos.
- `AUDIO_WORKER_ENABLED` liga o consumidor e `AUDIO_WORKER_POLL_INTERVAL_S` controla o polling.

### Linguas e vozes

O catalogo inicial fica em `../docs/voice_language_seed.csv`. Para aplica-lo de forma
idempotente em uma instalacao nova:

```bash
uv run python -m app.scripts.seed_languages
```

Tambem e possivel informar outro arquivo:

```bash
uv run python -m app.scripts.seed_languages /caminho/catalogo.csv
```

O endpoint `POST /api/v1/admin/languages/import` recebe o mesmo CSV como multipart.
Sem `replace`, ele adiciona e atualiza configuracoes. Com `replace=true`, linguas ausentes
sao desativadas e as associacoes voz-lingua e o pool default passam a refletir exatamente
o arquivo. Traducoes, audios, jobs e vozes historicas nao sao apagados.

O passo a passo completo de ElevenLabs, configuracao de vozes, geracao em lote e diagnostico
fica em `../docs/runbook_elevenlabs_vozes.md`.

## Qualidade
- Suite com testes unitarios e de integracao.
- `pytest` aplica o limite mínimo de cobertura de 70% configurado em `pyproject.toml`.

## Notas
- A especificacao geral do projeto fica em `../docs/lisboa_spec_geral.md`.
- A operação completa de percursos fica em `../docs/percursos_narrativos.md`.
- Os detalhes técnicos e operacionais ficam em `../docs/backend_referencia.md` e nos runbooks.
