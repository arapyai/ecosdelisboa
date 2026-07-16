# Arquitetura do Projeto

Leitura curta da estrutura atual do Lisboa por Outros. A visão de produto e o estado das
capacidades ficam em `lisboa_spec_geral.md`; contratos detalhados ficam em
`backend_referencia.md`.

## Componentes

```text
PWA pública ─────┐
Admin editorial ─┼── HTTPS / REST JSON / SSE ── API FastAPI
Apps Expo* ──────┘                                  │
                                                   ├── PostgreSQL + PostGIS
                                                   ├── provider LLM configurável
                                                   ├── ElevenLabs
                                                   └── volume persistente de MP3

* fundação existente; entrega Android/iOS ocorre após o MVP PWA + admin
```

- `webapp/` oferece mapa, autores, pontos, percursos, áudio e cache offline da PWA;
- `admin/` opera conteúdo e consome os contratos administrativos;
- `backend/` concentra regras editoriais, autenticação, persistência e integrações;
- `mobile/` é a fundação Expo para a etapa pós-MVP;
- `shared/` contém tipos e cliente HTTP reutilizáveis;
- `docs/` concentra decisões transversais e procedimentos operacionais.

## Limites de responsabilidade

- pontos representam lugares; a autoria pertence aos textos;
- o banco é a fonte de verdade de conteúdo, traduções, proveniência e referências de áudio;
- MP3 ficam em `AUDIO_STORAGE_DIR`, montado em volume persistente nos ambientes publicados;
- importação cria ou reutiliza autores, pontos, textos e traduções fornecidas, mas não dispara
  tradução automática nem áudio;
- tradução automática sempre entra em revisão editorial;
- áudio manual tem precedência e não é sobrescrito por geração automática em lote;
- idiomas ativos e a língua-fonte são dados configuráveis, não uma lista fixa no código.

## Estado das superfícies

O backend já expõe os contratos de conteúdo, idiomas, traduções de textos/autores/percursos,
vozes, importação e upload manual de MP3. A PWA pública e o admin inicial existem. A integração
das capacidades editoriais mais recentes na interface administrativa — mapa/geocoding,
edição multilíngue, import/export unificado e áudio dentro da edição de texto — continua no
roadmap e não deve ser inferida apenas pela existência da API.

Jobs de áudio usam o banco como fila durável. Um worker em thread própria, iniciado junto com a
API, processa os itens fora do ciclo da requisição e grava progresso para o SSE. API e worker
permanecem no mesmo serviço para compartilhar o volume local de MP3; jobs interrompidos são
retomados no startup.

## Nomes técnicos legados

Pacotes `@ecosdelisboa/*`, identificadores `lisbon-literary-map` e domínios em
`literarymap.org` continuam em uso técnico. Eles não alteram o nome de produto Lisboa por
Outros e só devem ser renomeados como uma migração coordenada de código, deploy e DNS.

## Fontes de verdade

- produto, decisões e estado funcional: `lisboa_spec_geral.md`;
- planejamento e responsáveis: [GitHub Project](https://github.com/orgs/arapyai/projects/1);
- API e modelo de dados: código do backend, OpenAPI e `backend_referencia.md`;
- importação editorial: `importacao_csv_conteudo.md` e o template servido pela API;
- ambientes e operação: `infrastructure.md` e runbooks;
- comandos locais: README do workspace correspondente.
