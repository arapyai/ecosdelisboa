# Runbook de Storage de Áudio

Este documento cobre os arquivos MP3 gerados pela ElevenLabs e enviados manualmente. Banco e
volume formam uma unidade operacional: `audio_files` aponta para uma chave relativa dentro de
`AUDIO_STORAGE_DIR`.

## Configuração

```env
AUDIO_STORAGE_DIR=/data/audio-storage
AUDIO_PUBLIC_BASE_URL=/media
AUDIO_UPLOAD_MAX_BYTES=26214400
```

Em staging e produção, `AUDIO_STORAGE_DIR` deve estar em volume persistente. Não use um caminho
efêmero da imagem ou do deploy.

## Layout determinístico

```text
audio/
  {text_id}/
    {lang}.mp3
  manual/
    {text_id}/
      {lang}.mp3
```

- áudio gerado mantém `audio/{text_id}/{lang}.mp3`;
- upload manual usa `audio/manual/{text_id}/{lang}.mp3`;
- o nome original do upload nunca compõe a chave;
- novo upload para o mesmo par sobrescreve atomicamente o mesmo arquivo;
- a base mantém no máximo um `audio_files` por `text_id + lang`;
- geração automática não chama a ElevenLabs nem grava arquivo quando o registro atual é manual.

## Upload, replace e delete

```bash
curl -X PUT "$API/api/v1/admin/audio/$TEXT_ID/$LANG/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@./narracao.mp3;type=audio/mpeg"

curl -X DELETE "$API/api/v1/admin/audio/$TEXT_ID/$LANG" \
  -H "Authorization: Bearer $TOKEN"
```

O replace grava primeiro o novo arquivo, atualiza `audio_files` e então remove uma chave anterior
diferente. O delete remove o registro e a chave armazenada. Diretórios vazios abaixo do volume
também são removidos.

## Backup consistente

Faça backup do PostgreSQL e do volume na mesma janela, sem uploads ou jobs de áudio em andamento.
Em uma operação pequena, interromper temporariamente as escritas administrativas é suficiente.

```bash
pg_dump "$DATABASE_URL" --format=custom --file=lisboa-db.dump
tar -C "$(dirname "$AUDIO_STORAGE_DIR")" \
  -czf lisboa-audio.tar.gz "$(basename "$AUDIO_STORAGE_DIR")"
sha256sum lisboa-db.dump lisboa-audio.tar.gz > lisboa-backup.sha256
```

Armazene os três arquivos fora do mesmo volume da aplicação. Registre data, ambiente, versão da
aplicação e revisão Alembic junto ao backup.

## Restore

1. coloque a API em manutenção e impeça uploads/jobs;
2. restaure o banco em uma instância vazia compatível;
3. restaure o diretório no mesmo `AUDIO_STORAGE_DIR` configurado;
4. aplique somente as migrations esperadas pela versão da aplicação;
5. suba a API e valide arquivos gerados e manuais em pelo menos dois idiomas.

```bash
sha256sum --check lisboa-backup.sha256
pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" lisboa-db.dump
tar -C "$(dirname "$AUDIO_STORAGE_DIR")" -xzf lisboa-audio.tar.gz
```

Depois do restore, confira uma amostra de `audio_files.public_url`, a existência da respectiva
`r2_key` dentro do volume e a resposta HTTP do MP3. Não apague arquivos sem antes comparar as
chaves do volume com os registros da base.
