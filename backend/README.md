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
- `TRANSLATION_LLM_PROVIDER` (padrao: `claude`)
- `TRANSLATION_LLM_MODEL`
- `TRANSLATION_LLM_API_KEY` ou `ANTHROPIC_API_KEY`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_DEFAULT_VOICE_ID` quando a API key nao puder listar vozes ou o seed usar placeholder
- `AUDIO_STORAGE_DIR` (padrao: `media`, pasta local onde MP3s gerados sao gravados)
- `AUDIO_PUBLIC_BASE_URL` (padrao: `/media`, prefixo publico servido pela API)
- `GEOCODING_API_KEY` quando o provedor de geocoding exigir chave

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
- voz padrao
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
- `GET /api/v1/authors`
- `GET /api/v1/authors/{id}`
- `GET /api/v1/routes`
- `GET /api/v1/routes/{id}`
- `GET /api/v1/routes/{id}/gpx`
- `GET /api/v1/routes/{id}/podcast.rss`
- `GET /api/v1/voices/default`

### Admin
- `POST /api/v1/admin/auth/login`
- `GET /api/v1/admin/auth/me`
- CRUD de autores, pontos, textos e rotas em `/api/v1/admin/*`
- Importacao CSV em `/api/v1/admin/points/import/*`
- Traducoes em `/api/v1/admin/translations/*`
- Vozes em `/api/v1/admin/voices/*`
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
- Usa voz do autor associado ao texto quando existir.
- Usa voz padrao como fallback.
- Upload manual preservado contra regeneracao automatica.
- Upload manual pode sobrescrever o audio de uma lingua de forma independente.
- Audio pode ser removido por texto e lingua para permitir nova geracao ou novo upload.

### Jobs e SSE
- Jobs de geracao de audio sao persistidos na base.
- Progresso pode ser consumido por `text/event-stream`.

## Qualidade
- Suite com testes unitarios e de integracao.
- Cobertura atual acima do minimo exigido de 70%.

## Notas
- A especificacao geral do projeto fica em `../docs/lisboa_spec_geral.md`.
- As integracoes externas atuais estao encapsuladas em services testaveis e prontas para substituicao por clientes reais.

- 
