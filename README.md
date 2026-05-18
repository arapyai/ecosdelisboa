# Lisboa por Outros Monorepo

Monorepo do projeto Lisboa por Outros. A raiz organiza os workspaces por area de responsabilidade, mantendo o backend autocontido em `backend/` e a documentacao transversal em `docs/`.

## Arquitetura Geral

Hoje o repositorio contem:

- `backend/`: workspace do servidor, com codigo, configuracao, lockfiles, testes e artefatos locais de desenvolvimento.
- `mobile/`: shell inicial do app publico em Expo.
- `webapp/`: PWA publico em React/Vite.
- `admin/`: shell inicial do painel interno em React/Vite/TanStack Query.
- `shared/`: tipos basicos e cliente HTTP compartilhavel entre frontend.
- `docs/`: documentacao geral do produto, arquitetura e referencias compartilhadas entre workspaces.

Essa estrutura prepara o repositorio para crescer com `mobile/`, `webapp/` e `admin/` quando esses workspaces forem adicionados, sem misturar implementacao de servicos com documentacao global.

## Estrutura

```text
.
├── backend/
│   ├── app/
│   ├── alembic/
│   ├── tests/
│   ├── .venv/
│   ├── .pytest_cache/
│   ├── .ruff_cache/
│   ├── .coverage
│   ├── pyproject.toml
│   ├── flake.nix
│   └── README.md
├── mobile/
├── webapp/
├── admin/
├── shared/
└── docs/
    ├── arquitetura.md
    ├── README.md
    └── lisboa_spec_geral.md
```

## Backend

Tudo que e pertinente ao servidor fica dentro de `backend/`, incluindo:

- codigo da API em `backend/app`
- migrations em `backend/alembic`
- testes em `backend/tests`
- configuracao Python em `backend/pyproject.toml`
- ambiente de desenvolvimento Nix em `backend/flake.nix`
- ambiente virtual, caches e cobertura locais do backend em `backend/.venv`, `backend/.pytest_cache`, `backend/.ruff_cache` e `backend/.coverage`

Para trabalhar no servidor:

```bash
cd backend
nix develop
uv sync --dev
uv run uvicorn app.main:app --reload
```

## Documentacao

- `docs/lisboa_spec_geral.md`: guia geral e especificacao tecnica do projeto
- `docs/backend_referencia.md`: referencia tecnica do backend e das integracoes
- `docs/arquitetura.md`: leitura curta da arquitetura e da estrutura do monorepo
- `docs/README.md`: indice da documentacao global

## Evolucao esperada

O objetivo dessa organizacao e permitir que cada parte do sistema evolua com fronteiras claras: implementacao e ferramental local ficam no workspace correspondente; a raiz e `docs/` descrevem a arquitetura do conjunto.
