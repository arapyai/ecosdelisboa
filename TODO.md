# TODO

Plano de execucao em 6 semanas para o projeto Lisboa por Outros.

## Principios

- [ ] priorizar frentes com baixo acoplamento entre backend, frontend e infra
- [ ] entregar contratos e ambientes minimos cedo para destravar trabalho paralelo
- [ ] tratar PT e EN como escopo de lancamento
- [ ] deixar ES, FR, DE e ZH como extensao natural do fluxo ja implementado
- [ ] separar fundacoes, fluxos editoriais, audio, percursos e polimento

## Semana 1

### Backend

- [ ] estruturar o workspace `backend/` para desenvolvimento local estavel
- [ ] finalizar configuracao base do FastAPI, settings, CORS e healthcheck
- [ ] consolidar modelos e migrations iniciais do banco
- [ ] garantir suporte a PostGIS na migration inicial
- [ ] publicar contratos iniciais da API publica:
  - [ ] `GET /health`
  - [ ] `GET /api/v1/points`
  - [ ] `GET /api/v1/points/{id}`
  - [ ] `GET /api/v1/authors`
  - [ ] `GET /api/v1/authors/{id}`
- [ ] documentar payloads e envelopes `{data, meta}`

### Frontend

- [x] criar estrutura dos workspaces `mobile/`, `webapp/` e `admin/`
- [x] inicializar app mobile com Expo
- [x] inicializar web publica com React + Vite
- [x] inicializar admin com React + Vite + TanStack Query
- [x] configurar camada compartilhada de cliente HTTP e tipos basicos
- [x] implementar shells vazios para:
  - [x] mapa/lista publica
  - [x] detalhe de ponto
  - [x] login admin
  - [x] dashboard admin

### Infra

- [ ] criar base de CI para lint e testes
- [ ] definir variaveis de ambiente por workspace
- [ ] provisionar Railway para API e PostgreSQL
- [ ] validar conexao do backend com banco gerido
- [ ] definir estrategia de deploy por branch
- [ ] documentar setup minimo operacional

## Semana 2

### Backend

- [ ] entregar endpoints publicos de percursos:
  - [ ] `GET /api/v1/routes`
  - [ ] `GET /api/v1/routes/{id}`
  - [ ] `GET /api/v1/routes/{id}/gpx`
  - [ ] `GET /api/v1/routes/{id}/podcast.rss`
- [ ] implementar autenticacao admin:
  - [ ] `POST /api/v1/admin/auth/login`
  - [ ] `GET /api/v1/admin/auth/me`
- [ ] entregar CRUD admin de:
  - [ ] autores
  - [ ] pontos
  - [ ] textos
  - [ ] percursos
- [ ] cobrir regras basicas com testes

### Frontend

- [ ] integrar consumo da API publica no mobile e web
- [ ] implementar listagem de pontos e autores
- [ ] implementar tela de detalhe de ponto com dados textuais
- [ ] implementar fluxo de login admin
- [ ] implementar listagens CRUD no admin para:
  - [ ] autores
  - [ ] pontos
  - [ ] textos
  - [ ] percursos
- [ ] trabalhar com mocks onde faltar detalhe de backend

### Infra

- [ ] configurar secrets no Railway e ambientes locais
- [ ] configurar pipeline de PR com testes backend
- [ ] configurar dominio interno ou staging, se aplicavel
- [ ] definir politica de logs e retencao
- [ ] preparar base para Sentry, mesmo que ainda sem uso completo

## Semana 3

### Backend

- [ ] implementar importacao CSV com:
  - [ ] preview
  - [ ] confirmacao
  - [ ] idempotencia por autor + titulo
  - [ ] validacao por linha
- [ ] implementar gestao editorial de traducoes:
  - [ ] criar traducao automatica
  - [ ] listar traducoes
  - [ ] revisar traducao
- [ ] expor voz padrao publica:
  - [ ] `GET /api/v1/voices/default`
- [ ] encapsular integracao Gemini em service testavel

### Frontend

- [ ] implementar fluxo admin de importacao CSV
- [ ] implementar tabela de preview de importacao
- [ ] implementar tela de revisao de traducoes
- [ ] implementar status por lingua na visao de textos por ponto
- [ ] integrar fluxo de criar, aprovar e rejeitar traducoes
- [ ] manter mobile e web desacoplados do admin

### Infra

- [ ] provisionar acesso a Gemini
- [ ] validar politicas de segredo e rotacao
- [ ] documentar quotas e limites operacionais da Gemini
- [ ] ajustar CI para incluir checks de documentacao e formatacao, se existirem

## Semana 4

### Backend

- [ ] implementar integracao ElevenLabs:
  - [ ] listar vozes
  - [ ] sincronizar vozes
  - [ ] definir voz padrao
  - [ ] gerar audio
  - [ ] preview de voz
- [ ] implementar integracao Cloudflare R2:
  - [ ] upload
  - [ ] substituicao
  - [ ] URL publica
- [ ] implementar regras de audio manual:
  - [ ] `manually_uploaded=true` nao sobrescreve em lote
- [ ] cobrir fluxos de audio com testes

### Frontend

- [ ] implementar modulo admin de vozes
- [ ] implementar modulo admin de gestao de audio
- [ ] implementar acoes por linha:
  - [ ] gerar audio
  - [ ] regerar
  - [ ] substituir
  - [ ] ouvir
- [ ] implementar player inline no admin
- [ ] integrar status de audio por texto e por lingua

### Infra

- [ ] provisionar bucket R2 e credenciais
- [ ] configurar dominio publico de audio
- [ ] validar CORS e politicas de acesso do bucket
- [ ] monitorar erros de integracao externa
- [ ] registrar runbook curto para falhas em ElevenLabs e R2

## Semana 5

### Backend

- [ ] implementar jobs de geracao em lote
- [ ] implementar SSE para progresso de jobs
- [ ] finalizar suporte a waypoints livres em percursos
- [ ] consolidar regras de publicacao e despublicacao de percursos
- [ ] reforcar cobertura de testes em fluxos criticos

### Frontend

- [ ] implementar progresso em tempo real de geracao em lote via SSE no admin
- [ ] implementar editor de percursos com ordenacao
- [ ] implementar criacao e edicao de waypoints livres
- [ ] refinar detalhe de ponto no mobile e web com audio
- [ ] refinar estados de erro, loading e vazio em todas as superficies

### Infra

- [ ] validar comportamento assincrono sob carga leve
- [ ] configurar observabilidade minima:
  - [ ] erros
  - [ ] uptime
  - [ ] metricas principais
- [ ] revisar backups do PostgreSQL
- [ ] testar restore basico em ambiente nao produtivo, se possivel

## Semana 6

### Backend

- [ ] revisar consistencia geral dos contratos
- [ ] fechar lacunas de documentacao tecnica e operacional
- [ ] revisar performance dos endpoints principais
- [ ] revisar seguranca:
  - [ ] autenticacao
  - [ ] CORS
  - [ ] validacao de input
  - [ ] exposicao de secrets
- [ ] preparar seed minima para ambiente de demonstracao

### Frontend

- [ ] polir experiencia publica para PT e EN
- [ ] ajustar responsividade da web publica e do admin
- [ ] validar acessibilidade basica nas telas principais
- [ ] revisar navegacao fim a fim:
  - [ ] exploracao publica
  - [ ] login admin
  - [ ] CRUD
  - [ ] traducao
  - [ ] audio
  - [ ] percursos
- [ ] preparar capturas e fluxos para validacao interna

### Infra

- [ ] fechar pipeline de release
- [ ] validar deploy completo de staging e producao
- [ ] consolidar runbook de operacao:
  - [ ] deploy
  - [ ] rollback
  - [ ] variaveis
  - [ ] troubleshooting
- [ ] revisar custo, limites e dependencias externas
- [ ] preparar checklist de lancamento

## Dependencias Entre Frentes

### Dependencias minimas do frontend em relacao ao backend

- [ ] Semana 1: contratos basicos da API publica e envelope padrao
- [ ] Semana 2: autenticacao admin e CRUDs
- [ ] Semana 3: endpoints de traducao e importacao CSV
- [ ] Semana 4: endpoints de vozes e audio
- [ ] Semana 5: SSE e editor de percursos completo

### Dependencias minimas do backend em relacao a infra

- [ ] Semana 1: PostgreSQL e env vars
- [ ] Semana 3: credenciais Gemini
- [ ] Semana 4: credenciais ElevenLabs e R2
- [ ] Semana 5: observabilidade minima

### Dependencias minimas da infra em relacao as outras frentes

- [ ] backend define variaveis e portas cedo
- [ ] frontend define estrategia de build e deploy por workspace ate semana 2

## Marco Por Semana

- [ ] Semana 1: fundacoes estaveis e workspaces criados
- [ ] Semana 2: API publica principal e admin CRUD funcional
- [ ] Semana 3: fluxo editorial de importacao e traducao funcional
- [ ] Semana 4: fluxo de audio funcional
- [ ] Semana 5: percursos avancados e processamento em lote com progresso
- [ ] Semana 6: polimento, operacao e preparacao de lancamento
