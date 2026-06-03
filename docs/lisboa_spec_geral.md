# Lisboa por Outros

A Cidade Escrita em Voz Alta

Especificacao tecnica de referencia v2.0  
Abril de 2025 · Uso interno da equipa

## Visao Geral

Lisboa por Outros e um produto cultural digital que guia utilizadores por Lisboa atraves de pontos literarios, percursos e audios narrados com apoio de IA.

O objetivo do projeto e combinar geografia, literatura e audio para criar uma experiencia multilíngue de descoberta da cidade.

## Objetivos do Produto

- oferecer uma experiencia publica simples para explorar autores, pontos e percursos
- publicar conteudo literario em PT e EN no lancamento, com expansao posterior para ES, FR, DE e ZH
- permitir gestao editorial interna por um painel administrativo proprio
- suportar traducao assistida por IA com revisao humana obrigatoria
- suportar geracao e gestao de audio por lingua e por autor

## Superficies do Sistema

O produto e composto por quatro superficies principais:

- app mobile para iOS e Android
- web app publica em modo PWA
- painel administrativo para a equipa interna
- backend responsavel por API, persistencia e integracoes externas

## Decisoes Principais

| Tema | Decisao |
| :--- | :--- |
| Plataformas | iOS, Android e Web PWA |
| Idiomas no lancamento | PT e EN |
| Idiomas posteriores | ES, FR, DE, ZH |
| Backend | FastAPI em Python 3.12 |
| Base de dados | PostgreSQL 16 com PostGIS |
| Infra principal | Railway |
| Storage de audio | Cloudflare R2 |
| Sintese de voz | ElevenLabs |
| Traducao automatica | Google Gemini |
| Modelo editorial | revisao humana obrigatoria para traducoes |

## Arquitetura de Alto Nivel

```text
Clientes
  mobile app (React Native / Expo)
  web PWA (React / Vite)
  admin UI (React / Vite)
        |
        | HTTPS / REST JSON / SSE
        v
Backend API (FastAPI)
  public API
  admin API
  content workflows
  translation workflows
  audio workflows
        |
        +--> PostgreSQL + PostGIS
        +--> ElevenLabs
        +--> Google Gemini
        +--> Cloudflare R2
```

## Estrutura do Monorepo

A estrutura alvo do repositorio segue a separacao por workspace:

```text
.
├── backend/
├── mobile/
├── webapp/
├── admin/
├── docs/
└── .github/workflows/
```

No estado atual, `backend/` e `docs/` ja estao organizados como workspaces separados.

## Stack Tecnologica

| Camada | Tecnologia | Observacao |
| :--- | :--- | :--- |
| Backend API | Python 3.12 + FastAPI | OpenAPI automatica e suporte async |
| Persistencia | PostgreSQL 16 + PostGIS | consultas geoespaciais |
| Mobile | React Native + Expo | app publica |
| Web publica | React 18 + Vite | PWA |
| Admin UI | React 18 + Vite + TanStack Query | SPA interna |
| Audio | ElevenLabs | voz por autor com fallback |
| Traducao | Google Gemini | traducao assistida com contexto literario |
| Storage | Cloudflare R2 | armazenamento de MP3 |
| CI/CD | GitHub Actions + Railway | testes e deploy |
| Observabilidade | Railway Metrics + Sentry | logs e erros |

## Dominios de Dados

O modelo de dados do produto gira em torno destas entidades principais:

- `authors`: autores e respectivas biografias e configuracao de voz
- `points`: lugares literarios georreferenciados, sem autoria direta
- `texts`: textos originais em portugues associados a um ponto e a um autor
- `translations`: traducoes por lingua com status editorial
- `audio_files`: audios gerados ou enviados manualmente por texto e lingua
- `voices`: vozes disponiveis na conta ElevenLabs
- `routes`: percursos publicados ou em rascunho
- `route_items`: sequencia de pontos e waypoints livres dentro de um percurso
- `admin_users`: utilizadores autenticados do painel
- `audio_generation_jobs`: jobs assincronos de geracao em lote

Para a referencia tecnica detalhada do backend, ver `docs/backend_referencia.md`.

## API Publica

Todos os endpoints publicos sao read-only, nao exigem autenticacao e respondem em envelope JSON `{data, meta}`.

| Metodo | Endpoint | Descricao |
| :--- | :--- | :--- |
| GET | `/health` | estado basico do servico |
| GET | `/api/v1/points` | lista de pontos proximos com filtros, incluindo filtro por autor dos textos |
| GET | `/api/v1/points/{id}` | detalhe completo do ponto com textos, autores e audios |
| GET | `/api/v1/authors` | lista de autores |
| GET | `/api/v1/authors/{id}` | detalhe do autor |
| GET | `/api/v1/routes` | lista de percursos publicados |
| GET | `/api/v1/routes/{id}` | detalhe do percurso |
| GET | `/api/v1/routes/{id}/gpx` | export GPX |
| GET | `/api/v1/routes/{id}/podcast.rss` | feed RSS do percurso |
| GET | `/api/v1/voices/default` | voz padrao atual |

## Painel Administrativo

O painel administrativo e uma aplicacao interna com autenticacao por email e password simples. Nao ha registo publico.

### Modulos principais

| Modulo | Rota | Funcao |
| :--- | :--- | :--- |
| Dashboard | `/admin` | indicadores operacionais |
| Autores | `/admin/authors` | CRUD de autores e atribuicao de voz |
| Pontos Literarios | `/admin/points` | CRUD de pontos georreferenciados e importacao CSV |
| Textos e Citacoes | `/admin/texts` | gestao de textos, autores, traducoes e audios |
| Percursos | `/admin/routes` | CRUD e ordenacao de percursos |
| Traducoes | `/admin/translations` | fila editorial de revisao |
| Vozes | `/admin/voices` | sincronizacao e configuracao de voz padrao |
| Audio | `/admin/audio` | acompanhamento da producao de audio |

### Capacidades editoriais esperadas

- criar e editar autores
- criar e editar pontos manualmente
- associar autores aos textos, nao aos pontos
- importar pontos e textos via CSV com preview
- gerir textos por ponto
- disparar traducao automatica por lingua
- rever e aprovar ou rejeitar traducoes
- gerar audio sob demanda ou em lote
- substituir audio por upload manual
- gerir percursos publicados e rascunhos

## Fluxos Criticos

### Importacao CSV

- o sistema aceita criacao manual ou importacao em lote
- cada linha valida ponto, coordenadas e conteudo minimo
- o fluxo mostra preview antes da confirmacao
- a importacao e idempotente por titulo do ponto + autor do texto
- a importacao nao dispara automaticamente traducao nem audio

### Traducao editorial

- o texto original e sempre mantido em portugues
- o backend pode gerar traducao automatica via Gemini
- toda traducao criada automaticamente entra com status `pending`
- nenhuma traducao e aprovada automaticamente
- aprovacao e rejeicao acontecem no painel admin

### Geracao de audio

- o audio pode usar voz especifica do autor associado ao texto
- se nao houver voz do autor, usa a voz padrao configurada
- audio em PT pode ser gerado diretamente
- audio em outras linguas depende de traducao aprovada
- jobs em lote reportam progresso por SSE

### Substituicao manual de audio

- a equipa pode fazer upload manual de MP3
- arquivos marcados como `manually_uploaded=true` nao podem ser sobrescritos por lote automatico
- nova substituicao manual continua permitida

### Percursos

- percursos podem conter pontos cadastrados
- percursos tambem podem conter waypoints livres com `lat/lng`
- a ordem dos itens deve ser editavel
- percursos nao publicados nao aparecem na API publica

## Integracoes Externas

| Integracao | Uso principal |
| :--- | :--- |
| ElevenLabs | listar vozes, gerar audio e preview |
| Google Gemini | gerar traducao automatica com contexto literario |
| Cloudflare R2 | guardar e servir MP3 |
| Railway | hospedar API e PostgreSQL |

## Regras de Negocio Criticas

- endpoints publicos sao somente leitura
- endpoints admin exigem autenticacao Bearer JWT
- respostas da API seguem envelope `{data, meta}`
- traducao automatica nunca e marcada como `approved` sem revisao humana
- audio manual nunca e sobrescrito por geracao automatica em lote
- alteracoes de schema exigem migration
- variaveis sensiveis nunca devem ficar no repositorio

## Qualidade e Restricoes

| Tema | Regra |
| :--- | :--- |
| Performance API | P95 menor que 200 ms para geolocalizacao |
| Testes backend | cobertura minima de 70% |
| Seguranca | nenhuma chave real no repositorio e HTTPS em toda a superficie publica |
| Acessibilidade | alvo WCAG 2.1 AA nas superficies de frontend |
| Offline | ultimo bairro visitado e seus audios devem ser acessiveis sem dados |

## Riscos Principais

| Risco | Impacto | Mitigacao |
| :--- | :--- | :--- |
| direitos autorais de obras modernas | alto | priorizar dominio publico e validar casos sensiveis |
| quota insuficiente na ElevenLabs | medio | gerar em fila e acompanhar erros no admin |
| qualidade inconsistente das vozes | medio | revisao editorial antes de publicar |
| atraso nas revisoes de traducao | baixo | lancar primeiro com PT e EN |
| custo de infraestrutura em escala | medio | manter arquitetura portavel |

## Escopo desta Spec

Este documento e a referencia principal de produto e arquitetura. Detalhes mais operacionais de backend, modelo de dados e integracoes tecnicas ficam documentados separadamente em `docs/backend_referencia.md` e `backend/README.md`.
