# Documentação

Esta pasta concentra decisões transversais, contratos e procedimentos do Lisboa por Outros.

## Documentos principais

- `lisboa_spec_geral.md`: produto, decisões e estado funcional consolidado;
- `arquitetura.md`: componentes, limites e fontes de verdade;
- `backend_referencia.md`: modelo, endpoints e regras do backend;
- `importacao_csv_conteudo.md`: contrato do CSV editorial e deduplicação;
- `infrastructure.md`: ambientes, deploy, variáveis e operação;
- `runbook_elevenlabs_vozes.md`: configuração de vozes e geração de áudio;
- `runbook_admin_users.md`: seed de deploy, gestão e recuperação de usuários administrativos;
- `runbook_audio_storage.md`: layout, backup e restore dos MP3;
- `voice_language_seed.csv`: catálogo inicial importável de idiomas e vozes.

## Como ler

- comece pela spec para entender produto, decisões e o que está ou não entregue;
- use a referência do backend ou a OpenAPI para contratos;
- use o documento de importação para preparar planilhas;
- use infraestrutura e runbooks para operar ambientes e integrações;
- use o [GitHub Project](https://github.com/orgs/arapyai/projects/1) para estado, datas e responsáveis.

## Organizacao

Material específico de implementação deve ficar no workspace correspondente. Não mantenha
checklists de roadmap nesta pasta: elas pertencem ao GitHub Project.

- backend: `backend/README.md`;
- PWA: `webapp/README.md`;
- admin: `admin/README.md`;
- mobile: `mobile/README.md`.
