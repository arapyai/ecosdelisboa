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
- percurso publicado

Login admin local:

```text
admin@example.com
secret
```

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
- Idempotencia por titulo do ponto + autor do texto.
- Criacao automatica de autor minimo quando necessario.
- Formato esperado: `point_name,address,neighborhood,city,country,lat_override,lng_override,author_name,content_pt,content_type,source_work,source_year`.
- `lat_override` e `lng_override` podem ficar vazios para pontos existentes; para pontos novos, ambos sao obrigatorios.

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
- Cobertura atual acima do minimo exigido de 70%.

## Notas
- A especificacao geral do projeto fica em `../docs/lisboa_spec_geral.md`.
- As integracoes externas atuais estao encapsuladas em services testaveis e prontas para substituicao por clientes reais.
