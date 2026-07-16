# Lisboa por Outros

Monorepo do produto cultural Lisboa por Outros: uma experiência pública para descobrir Lisboa
por meio de pontos literários, autores, percursos e áudio multilíngue.

## Estratégia de entrega

O primeiro lançamento é **PWA pública + painel administrativo**, com conteúdo em português e
inglês. Android e iOS são a etapa seguinte; o workspace mobile existe como fundação, mas não
faz parte do MVP PWA.

O roadmap, os responsáveis e o estado de cada entrega ficam no
[GitHub Project](https://github.com/orgs/arapyai/projects/1). O arquivo `TODO.md` apenas explica
como esse planejamento é mantido e não duplica o quadro.

## Workspaces

- `backend/`: API FastAPI, banco, migrations, integrações, testes e ambiente Nix;
- `webapp/`: PWA pública em React/Vite;
- `admin/`: painel editorial interno em React/Vite/TanStack Query;
- `mobile/`: fundação Expo para a etapa Android/iOS pós-MVP;
- `shared/`: tipos e cliente HTTP compartilhados pelos frontends;
- `docs/`: especificação consolidada, arquitetura, referências e runbooks.

Os identificadores técnicos `ecosdelisboa`, `lisbon-literary-map` e alguns domínios em
`literarymap.org` são nomes legados de pacotes e infraestrutura. O nome do produto é Lisboa por
Outros.

## Desenvolvimento

Instale as dependências JavaScript na raiz:

```bash
npm install
npm run webapp:dev
npm run admin:dev
```

Para o backend, use o ambiente Nix e `uv`:

```bash
cd backend
nix develop
uv sync --dev
uv run uvicorn app.main:app --reload
```

Os comandos e variáveis completos estão nos READMEs de cada workspace e em
`docs/infrastructure.md`.

## Documentação

- `docs/lisboa_spec_geral.md`: escopo, decisões e estado funcional;
- `docs/arquitetura.md`: componentes, limites e fluxo de dados;
- `docs/backend_referencia.md`: contratos e regras do backend;
- `docs/importacao_csv_conteudo.md`: contrato do importador editorial;
- `docs/infrastructure.md`: ambientes, deploy e configuração;
- `docs/runbook_audio_storage.md`: volume, backup e restore de áudio;
- `docs/runbook_elevenlabs_vozes.md`: vozes e geração de áudio.
