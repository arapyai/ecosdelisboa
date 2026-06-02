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
- Idempotencia por autor + titulo.
- Criacao automatica de autor minimo quando necessario.

### Traducoes
- Gera traducao automatica com status `pending`.
- Revisao humana explicita para `approved` ou `rejected`.

### Audio
- Usa voz do autor quando existir.
- Usa voz padrao como fallback.
- Upload manual preservado contra regeneracao automatica.

### Jobs e SSE
- Jobs de geracao de audio sao persistidos na base.
- Progresso pode ser consumido por `text/event-stream`.

## Qualidade
- Suite com testes unitarios e de integracao.
- Cobertura atual acima do minimo exigido de 70%.

## Notas
- A especificacao geral do projeto fica em `../docs/lisboa_spec_geral.md`.
- As integracoes externas atuais estao encapsuladas em services testaveis e prontas para substituicao por clientes reais.
