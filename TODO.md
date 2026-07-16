# Planejamento

O backlog, o cronograma semanal, os responsáveis e o histórico de entregas são mantidos no
[GitHub Project Lisboa por Outros — Produto & Lançamento](https://github.com/orgs/arapyai/projects/1).

Este arquivo não contém uma segunda checklist porque ela ficaria rapidamente desatualizada.
Use no quadro:

- **Status** para o andamento;
- **Frente** para `INFRA`, `BACK`, `FRONT` ou `CONTEÚDO`;
- **Semana-alvo** para a revisão na reunião de quarta-feira;
- **Release** para separar `MVP PT/EN` de `Pós-MVP`;
- issues fechadas e cartões `Done` para o histórico materializado.

## Sequência vigente

1. concluir PWA pública, admin e operação editorial PT/EN;
2. validar staging, conteúdo, áudio, segurança e operação;
3. desenvolver e validar Android/iOS;
4. fechar o desenvolvimento até o fim de setembro de 2026, separando eventuais aprovações das
   lojas do trabalho de desenvolvimento.

## Decisões que afetam o backlog

- o lançamento inicial é PWA + admin; Android/iOS vêm depois;
- áudio usa diretório/volume local persistente, não Cloudflare R2;
- importação, tradução automática e geração de áudio são fluxos separados;
- traduções exigem revisão humana;
- tradução e áudio podem ser criados, substituídos e removidos manualmente por idioma;
- idiomas são configuráveis; PT e EN formam o escopo editorial do MVP.
