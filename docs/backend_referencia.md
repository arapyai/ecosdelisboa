# Referencia Tecnica do Backend

Este documento concentra detalhes tecnicos do backend que nao precisam poluir a leitura da spec principal.

## Stack do Servidor

- Python 3.12
- FastAPI
- SQLAlchemy 2
- Alembic
- PostgreSQL 16 + PostGIS
- pytest
- uv
- Nix

## Estrutura do Workspace

```text
backend/
├── app/
│   ├── api/
│   ├── core/
│   ├── models/
│   ├── schemas/
│   └── services/
├── alembic/
├── tests/
├── pyproject.toml
├── uv.lock
├── flake.nix
└── README.md
```

## Modelo de Dados

### Entidades principais

#### `authors`

- `id`
- `name`
- `bio_pt`
- `birth_year`
- `death_year`
- `photo_url`
- `elevenlabs_voice_id`

#### `points`

- `id`
- `title_pt`
- `address`
- `neighborhood`
- `lat`
- `lng`
- `geom`

Nota:

- pontos representam lugares georreferenciados e nao pertencem diretamente a um autor
- a autoria fica em `texts.author_id`, porque um mesmo ponto pode conter textos de autores diferentes

#### `texts`

- `id`
- `point_id`
- `author_id`
- `content_pt`
- `source_work`
- `source_year`
- `content_type`

Relacoes:

- `texts.point_id -> points.id`
- `texts.author_id -> authors.id`

#### `translations`

- `id`
- `text_id`
- `lang`
- `content`
- `status`
- `auto_translated`
- `reviewed_by`
- `reviewed_at`

Restricao:

- unicidade por `text_id + lang`

#### `audio_files`

- `id`
- `text_id`
- `lang`
- `r2_key`
- `public_url`
- `duration_s`
- `voice_id`
- `generated_at`
- `manually_uploaded`

Restricao:

- unicidade por `text_id + lang`

#### `voices`

- `id`
- `elevenlabs_id`
- `name`
- `preview_url`
- `is_default`
- `synced_at`

#### `routes`

- `id`
- `title_pt`
- `description_pt`
- `cover_image_url`
- `difficulty`
- `is_published`
- `estimated_distance_m`
- `estimated_duration_s`

#### `route_items`

- `route_id`
- `position`
- `point_id`
- `waypoint_lat`
- `waypoint_lng`
- `transition_text_pt`

Regras:

- cada item deve apontar para um ponto ou para um waypoint livre
- a posicao deve ser unica dentro de cada percurso

#### `admin_users`

- `id`
- `email`
- `password_hash`
- `is_active`

#### `audio_generation_jobs`

- `id`
- `status`
- `requested_by`
- `total`
- `processed`
- `succeeded`
- `failed`
- `last_error`

## API Publica

| Metodo | Endpoint | Notas |
| :--- | :--- | :--- |
| GET | `/health` | healthcheck |
| GET | `/api/v1/points` | filtros por localizacao, idioma e autor dos textos |
| GET | `/api/v1/points/{id}` | inclui autores derivados dos textos, textos e audios |
| GET | `/api/v1/authors` | lista de autores |
| GET | `/api/v1/authors/{id}` | detalhe do autor |
| GET | `/api/v1/routes` | apenas publicados |
| GET | `/api/v1/routes/{id}` | detalhe do percurso |
| GET | `/api/v1/routes/{id}/gpx` | export de navegacao |
| GET | `/api/v1/routes/{id}/podcast.rss` | feed de audio |
| GET | `/api/v1/voices/default` | voz padrao exposta ao app |

## API Admin

### Autenticacao

- `POST /api/v1/admin/auth/login`
- `GET /api/v1/admin/auth/me`

### Conteudo

- CRUD de autores em `/api/v1/admin/authors`
- CRUD de pontos em `/api/v1/admin/points`
- CRUD de textos em `/api/v1/admin/texts`
- CRUD de percursos em `/api/v1/admin/routes`

### Importacao CSV

- `POST /api/v1/admin/points/import/preview`
- `POST /api/v1/admin/points/import/confirm`

### Traducao e audio

- traducao por texto e lingua em `/api/v1/admin/translations/*`
- revisao de traducao em `/api/v1/admin/translations/{translation_id}/review`
- sincronizacao e configuracao de vozes em `/api/v1/admin/voices/*`
- geracao, upload e jobs de audio em `/api/v1/admin/audio/*`

## Exemplo de CSV de Importacao

```csv
author_name,title,address,neighborhood,lat,lng,content_pt,source_work,source_year,content_type
Fernando Pessoa,Tabacaria do Rossio,Rossio 59,Baixa,38.7134,-9.1392,"Nao sou nada...",Tabacaria,1928,poetry
Eca de Queiros,O Ramalhete,Rua das Janelas Verdes,Santos,38.7037,-9.1597,"Ali vivia...",Os Maias,1888,prose
```

Na importacao, `title/address/neighborhood/lat/lng` definem ou atualizam o ponto; `author_name` define o autor do texto criado ou atualizado para aquele ponto.

## Integracoes Externas

### ElevenLabs

Uso:

- listar vozes disponiveis
- gerar audio por `voice_id`
- fazer preview de voz

Fluxo:

1. backend envia texto aprovado para a API da ElevenLabs
2. recebe o MP3
3. faz upload para o R2
4. atualiza `audio_files`

### Google Gemini

Uso:

- gerar traducao automatica de texto literario com contexto do autor e da obra

Regras:

- o retorno e armazenado como `pending`
- nunca vira `approved` automaticamente

Prompt esperado:

```text
You are a literary translator. Preserve the author's voice, rhythm,
punctuation style and register. Do not modernize or simplify.
Return only the translated text.
```

### Cloudflare R2

Uso:

- armazenar MP3 gerado ou enviado manualmente
- expor URL publica sem proxy da API

Estrutura de keys esperada:

```text
audio/
  {text_id}/
    pt.mp3
    en.mp3
    es.mp3
```

### Railway

Uso:

- hospedar API
- fornecer PostgreSQL gerido
- gerir variaveis de ambiente e deploy

## Regras de Implementacao

- todos os endpoints retornam `{data, meta}`
- endpoints publicos sao read-only
- endpoints admin exigem Bearer JWT
- toda mudanca de schema exige migration Alembic
- integracoes externas devem ficar encapsuladas em `services`
- audios com `manually_uploaded=true` nao podem ser sobrescritos por lotes automaticos

## Desenvolvimento Local

Executar dentro de `backend/`:

```bash
nix develop
uv sync --dev
uv run uvicorn app.main:app --reload
uv run pytest
```
