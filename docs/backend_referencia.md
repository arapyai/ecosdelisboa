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

#### `author_translations` e `route_translations`

Autores e percursos seguem o mesmo contrato editorial de `translations`: idioma, `status`,
`auto_translated`, `origin`, revisor e data de revisão. As tabelas guardam respectivamente a
biografia do autor e o título/descrição do percurso, com unicidade por entidade + idioma.

Os campos `authors.bio_pt`, `routes.title_pt` e `routes.description_pt` continuam sendo a fonte
canônica e o fallback. Nome, datas, foto, voz e demais campos comuns não são duplicados nas
traduções.

#### `languages`

- `code`
- `locale`
- `country_code`
- `name`
- `is_active`
- `is_source`

Uma lingua removida e desativada para preservar traducoes, audios e jobs historicos.
Exatamente uma lingua ativa deve ser marcada como fonte.

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
- `gender`
- `is_default`
- `synced_at`

#### `voice_languages`

- `voice_id`
- `language_code`

Uma voz pode estar associada a varias linguas. O pool default tambem pode conter varias
vozes.

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
| GET | `/api/v1/authors?lang=en` | lista de autores; biografia aprovada ou fallback em português |
| GET | `/api/v1/authors/{id}?lang=en` | detalhe do autor com o mesmo fallback |
| GET | `/api/v1/routes?lang=en` | apenas publicados; título e descrição localizados |
| GET | `/api/v1/routes/{id}?lang=en` | detalhe do percurso localizado |
| GET | `/api/v1/routes/{id}/gpx?lang=en` | export de navegacao com título localizado |
| GET | `/api/v1/routes/{id}/podcast.rss?lang=en` | feed com título e descrição localizados |
| GET | `/api/v1/voices/default` | uma voz sorteada do pool default |

## API Admin

### Autenticacao

- `POST /api/v1/admin/auth/login`
- `GET /api/v1/admin/auth/me`

### Conteudo

- CRUD de autores em `/api/v1/admin/authors`
- CRUD de pontos em `/api/v1/admin/points`
- CRUD de textos em `/api/v1/admin/texts`
- CRUD de percursos em `/api/v1/admin/routes`
- traduções de autor em `/api/v1/admin/authors/{id}/translations[/{lang}]`
- traduções de percurso em `/api/v1/admin/routes/{id}/translations[/{lang}]`

### Importacao CSV

- `GET /api/v1/admin/points/import/template`
- `POST /api/v1/admin/points/import/preview`
- `POST /api/v1/admin/points/import/confirm`

O CSV cria ou reutiliza autores, pontos e textos, faz geocoding quando necessário e aceita
traduções nas colunas `content_<código-do-idioma>` e `author_bio_<código-do-idioma>`. O contrato completo está em
`docs/importacao_csv_conteudo.md`.

### Traducao e audio

- traducao por texto e lingua em `/api/v1/admin/translations/*`
- revisao de traducao em `/api/v1/admin/translations/{translation_id}/review`
- sincronizacao e configuracao de vozes em `/api/v1/admin/voices/*`
- geracao, upload e jobs de audio em `/api/v1/admin/audio/*`

### Linguas e vozes

- CRUD e ativacao em `/api/v1/admin/languages/*`
- importacao em `POST /api/v1/admin/languages/import?replace=false`
- associacao individual em `/api/v1/admin/voices/{voice_id}/languages/{language_code}`
- pool default em `/api/v1/admin/voices/{voice_id}/default`
- lista publica de linguas ativas em `GET /api/v1/languages`

## Exemplo de CSV de Importacao

```csv
point_name,address,neighborhood,city,country,lat_override,lng_override,author_name,content_pt,content_type,source_work,source_year
Chiado,Largo do Chiado,Chiado,Lisboa,Portugal,,,Fernando Pessoa,"Aqui a cidade tem passos de escritorio, cafe e fantasma.",prose,Fragmento demonstrativo,2026
Terreiro do Paco,Praca do Comercio,Baixa,Lisboa,Portugal,38.7076,-9.1365,Fernando Pessoa,"O rio abre a cidade como uma pagina larga.",poetry,Fragmento demonstrativo,2026
```

Na importacao, `point_name/address/neighborhood` definem ou atualizam o ponto; `author_name` define o autor do texto criado ou atualizado para aquele ponto. `lat_override/lng_override` podem ficar vazios para pontos existentes; para criar um ponto novo, ambos devem ser preenchidos.

## Integracoes Externas

### ElevenLabs

Uso:

- listar vozes disponiveis
- gerar audio por `voice_id`
- fazer preview de voz

Fluxo:

1. backend envia texto aprovado para a API da ElevenLabs
2. recebe o MP3
3. grava o MP3 no filesystem local configurado
4. atualiza `audio_files`

A escolha automatica segue: override explicito, voz do autor, pool da lingua, pool default e
`ELEVENLABS_DEFAULT_VOICE_ID`.

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

### Storage de audio

Uso:

- a implementacao atual grava em `AUDIO_STORAGE_DIR`
- a API serve os arquivos pelo prefixo `AUDIO_PUBLIC_BASE_URL`
- Cloudflare R2 permanece como evolucao planejada

Estrutura atual:

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
