# Arquitetura do Projeto

Este documento resume a arquitetura geral descrita em `docs/lisboa_spec_geral.md` e a traduz para a estrutura atual do monorepo.

## Visao do sistema

O projeto Lisboa por Outros e composto por:

- clientes: app mobile, web PWA e painel admin
- backend: API FastAPI responsavel por conteudo, autenticacao admin, traducoes e audio
- persistencia: PostgreSQL com PostGIS
- integracoes externas: ElevenLabs, Gemini e Cloudflare R2

## Estrutura de repositorio alvo

Segundo a especificacao geral, o monorepo deve evoluir para workspaces separados por superficie de produto:

```text
.
├── backend/
├── mobile/
├── webapp/
├── admin/
├── docs/
└── .github/workflows/
```

## Estrutura atual

Neste momento o repositorio contem:

- `backend/`: implementacao completa do servidor e seus artefatos locais
- `mobile/`: shell inicial do app publico mobile
- `webapp/`: web PWA publica
- `admin/`: shell inicial do painel administrativo
- `shared/`: tipos basicos e cliente HTTP compartilhavel entre superficies frontend
- `docs/`: especificacao geral e documentacao transversal

Isso deixa as principais superficies da Semana 1 separadas por workspace, com a web publica mais avancada e os demais shells prontos para evoluir.

## Backend no monorepo

O workspace `backend/` concentra tudo que pertence ao servidor:

- codigo da aplicacao em `backend/app`
- migrations em `backend/alembic`
- testes em `backend/tests`
- lockfiles e configuracao do ambiente Python/Nix
- caches e artefatos locais de desenvolvimento do backend

## Fonte de verdade documental

- `docs/lisboa_spec_geral.md`: fonte principal de produto e arquitetura
- `docs/backend_referencia.md`: referencia tecnica do backend e das integracoes
- `backend/README.md`: operacao e desenvolvimento do backend
- `README.md`: leitura rapida da organizacao do monorepo
