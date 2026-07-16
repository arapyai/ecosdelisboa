# Lisboa por Outros

**Especificação consolidada — julho de 2026**

Documento interno de produto e arquitetura.

## Visão do produto

Lisboa por Outros guia pessoas pela cidade por meio de pontos literários, autores, percursos e
áudios. A experiência é multilíngue e combina curadoria humana com apoio de IA para tradução e
síntese de voz.

O primeiro lançamento é composto pela **PWA pública e pelo painel administrativo**, com corpus
editorial em português e inglês. Android e iOS são a etapa posterior, ainda que o repositório já
contenha uma fundação Expo.

## Objetivos

- explorar pontos, autores e percursos em mapa e lista;
- ler e ouvir textos no idioma selecionado;
- oferecer uma experiência pública responsiva e instalável como PWA;
- permitir que a equipe importe, revise, traduza e publique conteúdo;
- manter proveniência e revisão humana nas traduções;
- produzir, substituir e remover áudio por texto e idioma;
- ampliar idiomas sem alterar o modelo de dados.

## Decisões vigentes

| Tema | Decisão |
| --- | --- |
| Sequência de lançamento | PWA + admin primeiro; Android/iOS depois |
| Escopo editorial do MVP | português e inglês |
| Idiomas | cadastro dinâmico, com exatamente uma língua-fonte ativa |
| Backend | FastAPI, Python 3.12, SQLAlchemy e Alembic |
| Persistência | PostgreSQL 16 com PostGIS nos ambientes publicados |
| Tradução | provider LLM configurável; Claude é o padrão atual |
| Regra editorial | tradução automática nunca é aprovada sem revisão humana |
| Síntese de voz | ElevenLabs, com vozes por autor e pools por idioma |
| Storage de áudio | diretório/volume local persistente; Cloudflare R2 está fora do escopo |
| Fluxos | importação, tradução automática e geração de áudio são independentes |
| Planejamento | GitHub Project, separado por `INFRA`, `BACK`, `FRONT` e `CONTEÚDO` |

## Superfícies e estado

| Superfície | Papel | Estado em julho de 2026 |
| --- | --- | --- |
| PWA (`webapp/`) | experiência pública | base funcional entregue; validação, conteúdo e polimento no roadmap |
| Admin (`admin/`) | operação editorial | CRUD/importação/áudio iniciais entregues; nova UX multilíngue e de mapas no roadmap |
| Backend (`backend/`) | API, regras e integrações | contratos principais e worker durável de áudio implementados |
| Mobile (`mobile/`) | Android e iOS | fundação Expo; desenvolvimento funcional pós-MVP |

O estado detalhado e as datas pertencem ao
[GitHub Project](https://github.com/orgs/arapyai/projects/1). Esta spec registra capacidades e
decisões, não replica a checklist do quadro.

## Arquitetura

```text
PWA pública / Admin / Apps Expo
              │
              │ HTTPS · REST JSON · SSE
              ▼
         Backend FastAPI
              │
              ├── PostgreSQL + PostGIS
              ├── provider LLM configurável
              ├── ElevenLabs
              └── volume local persistente de MP3
```

Mais detalhes em `arquitetura.md`.

## Modelo de conteúdo

- `authors`: identidade, biografia-fonte e configuração de voz;
- `author_translations`: biografia por idioma e estado editorial;
- `points`: lugares georreferenciados, sem autoria direta;
- `texts`: texto-fonte associado a um ponto e um autor;
- `translations`: conteúdo traduzido por texto e idioma;
- `routes`: dados-fonte, publicação e estimativas de percurso;
- `route_translations`: título e descrição por idioma;
- `route_items`: pontos cadastrados ou waypoints livres ordenados;
- `languages`: idiomas ativos e identificação da língua-fonte;
- `voices` e `voice_languages`: catálogo e pools de voz;
- `audio_files`: um áudio por texto e idioma, gerado ou enviado manualmente;
- `audio_generation_jobs`: estado persistido de lotes de áudio;
- `admin_users`: acesso ao painel.

Campos históricos como `content_pt`, `bio_pt`, `title_pt`, `description_pt` e `r2_key` permanecem
por compatibilidade. `r2_key` guarda hoje uma chave relativa no filesystem; seu nome não indica
uso de Cloudflare R2.

## Experiência pública

Endpoints públicos são read-only, não exigem autenticação e usam o envelope `{data, meta}`.

| Método | Endpoint | Função |
| --- | --- | --- |
| GET | `/health` | saúde do serviço |
| GET | `/api/v1/languages` | idiomas ativos e língua-fonte |
| GET | `/api/v1/points` | pontos, filtros geográficos e por autor |
| GET | `/api/v1/points/{id}` | ponto, textos, autores e áudios |
| GET | `/api/v1/authors[/{id}]` | autores com localização por idioma |
| GET | `/api/v1/routes[/{id}]` | percursos publicados e localizados |
| GET | `/api/v1/routes/{id}/gpx` | export GPX |
| GET | `/api/v1/routes/{id}/podcast.rss` | feed de podcast |
| GET | `/api/v1/voices/default` | voz sorteada do pool default |

A PWA implementa mapa, descoberta, detalhes, percursos, reprodução de áudio e cache offline. A
experiência offline real em dispositivos e redes representativas ainda precisa de validação;
portanto, offline é requisito do MVP, não garantia operacional já homologada.

## Operação editorial

O admin usa autenticação Bearer JWT e não oferece registro público. O backend já suporta CRUD
de autores, pontos, textos e percursos, além de idiomas, traduções, vozes, importação e áudio.

A interface atual ainda não materializa todos os contratos recentes. Estão planejados:

- importação e exportação do template em um único fluxo;
- edição de pontos com mapa e geocoding assistido;
- edição de textos por idioma, sem recarregar a página e com proveniência visível;
- áudio do idioma integrado à edição do texto, com play/delete/replace;
- edição multilíngue de autores e percursos;
- montagem de percursos com mapa, pontos e waypoints livres;
- gestão de idiomas, vozes e progresso de lotes.

### Importação

Cada linha representa um texto-fonte associado a um autor e a um ponto. O fluxo:

1. exporta o template vigente pela API;
2. executa preview sem gravar;
3. resolve ou cria autores e textos;
4. reutiliza pontos por correspondência segura e só cria um novo ponto quando necessário;
5. geocodifica quando faltam coordenadas;
6. confirma apenas linhas válidas.

Traduções fornecidas usam `content_<idioma>` e `author_bio_<idioma>`, entram como `pending`,
`origin=import` e `auto_translated=false`. Importar não chama o LLM e não gera áudio. O contrato
de deduplicação e todas as colunas estão em `importacao_csv_conteudo.md`.

### Tradução

- o texto-fonte e a língua-fonte são preservados;
- o provider automático é configurável por ambiente;
- conteúdo gerado automaticamente recebe proveniência e status `pending`;
- upload/importação e revisão manual permanecem distinguíveis;
- a equipe pode criar, substituir, aprovar, rejeitar ou remover tradução por idioma;
- trocar de idioma na futura UI não deve exigir reload nem perder alterações não salvas.

### Áudio

- existe no máximo um registro por texto e idioma;
- idioma-fonte usa o texto original; outros idiomas exigem tradução aprovada;
- a escolha automática de voz segue override, autor, pool do idioma, pool default e fallback de
  ambiente;
- arquivos gerados usam `audio/{text_id}/{lang}.mp3`;
- uploads manuais usam `audio/manual/{text_id}/{lang}.mp3`;
- upload manual atualiza arquivo e referência no banco como uma única operação lógica;
- `manually_uploaded=true` impede sobrescrita por lotes automáticos, mas não impede nova
  substituição manual nem remoção explícita.

O endpoint de lote cria o job e responde imediatamente com estado `pending`. Um worker interno
do serviço reivindica jobs de forma atômica, persiste cada resultado e alimenta o SSE com
progresso real. Após restart, itens que estavam `running` voltam à fila, enquanto resultados já
concluídos são preservados.

### Percursos

- podem combinar pontos cadastrados e waypoints livres com latitude/longitude;
- itens possuem ordem editável;
- título e descrição podem ter traduções por idioma;
- apenas percursos publicados aparecem na API pública;
- GPX e RSS respeitam a localização solicitada e o fallback definido.

## Integrações e infraestrutura

| Integração | Uso |
| --- | --- |
| Railway | API, PostgreSQL, variáveis e deploy |
| Netlify | PWA e admin publicados |
| Cloudflare | DNS; não é usado para armazenar áudio |
| Nominatim ou provider configurado | geocoding editorial |
| ElevenLabs | catálogo de vozes e síntese de MP3 |
| provider LLM configurável | tradução assistida |
| filesystem persistente | armazenamento e entrega dos MP3 |

Configuração e URLs ficam em `infrastructure.md`. Backup e restore de áudio ficam em
`runbook_audio_storage.md`.

## Regras de qualidade

- mudanças de schema exigem migration Alembic;
- o backend mantém cobertura mínima automatizada de 70%;
- chaves e senhas não entram no repositório;
- uploads são validados por tamanho, extensão, MIME type e assinatura;
- as superfícies públicas devem usar HTTPS nos ambientes publicados;
- WCAG 2.1 AA e bom desempenho são metas de validação, não resultados presumidos;
- direitos autorais, fontes e coordenadas do corpus precisam de auditoria editorial.

## Escopo documental

Esta é a referência consolidada de produto, decisões e estado funcional. Em caso de conflito:

1. decisões registradas no GitHub Project orientam escopo e sequência;
2. código, migrations e OpenAPI definem o comportamento implementado;
3. `backend_referencia.md` detalha os contratos;
4. runbooks definem a operação;
5. READMEs dos workspaces definem comandos locais.
