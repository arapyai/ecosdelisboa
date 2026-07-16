# Documentacao Geral

Esta pasta concentra a documentacao transversal do projeto Lisboa por Outros.

## Documentos principais

- `lisboa_spec_geral.md`: guia geral do projeto e especificacao tecnica de referencia
- `backend_referencia.md`: referencia tecnica do backend e das integracoes
- `arquitetura.md`: resumo da arquitetura e da estrutura atual do monorepo
- `importacao_csv_conteudo.md`: modelo de CSV para importacao editorial de pontos e textos
- `voice_language_seed.csv`: catalogo inicial de linguas e vozes ElevenLabs
- `runbook_elevenlabs_vozes.md`: configuracao operacional de ElevenLabs, vozes e geracao de audio
- `runbook_audio_storage.md`: upload manual, layout, backup e restore dos MP3

## Como ler

- comece por `lisboa_spec_geral.md` para entender o produto, a arquitetura e as regras principais
- use `backend_referencia.md` quando precisar de detalhes tecnicos do servidor
- use `arquitetura.md` para entender a organizacao do monorepo
- use `importacao_csv_conteudo.md` para preparar planilhas de conteudo para importacao
- use `runbook_elevenlabs_vozes.md` para colocar sintese de voz e catalogos em operacao
- use `runbook_audio_storage.md` para operar o volume persistente e recuperar os MP3

## Organizacao

Materiais especificos de implementacao devem ficar no workspace correspondente.

- documentacao de backend: `backend/README.md`
- documentacao global de produto, arquitetura e organizacao do repositorio: `docs/`
