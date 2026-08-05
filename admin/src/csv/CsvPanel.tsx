import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { AdminAuthor, AdminPoint } from '@ecosdelisboa/shared';
import { fetchCsvTemplate, isAuthError, postCsv } from '../adminApi';
import type { ImportPreviewRow, ImportResult } from '../adminTypes';

export function CsvPanel({ token, onAuthExpired, onGenerate }: {
  token: string;
  onAuthExpired: () => void;
  onGenerate?: (textIds: string[]) => void;
}) {
  const queryClient = useQueryClient();
  const [downloadError, setDownloadError] = useState('');

  function invalidateImportQueries() {
    queryClient.invalidateQueries({ queryKey: ['admin-resource', 'authors', token] });
    queryClient.invalidateQueries({ queryKey: ['admin-resource', 'points', token] });
    queryClient.invalidateQueries({ queryKey: ['admin-resource', 'texts', token] });
    queryClient.invalidateQueries({ queryKey: ['admin-options', 'authors', token] });
    queryClient.invalidateQueries({ queryKey: ['admin-options', 'points', token] });
  }

  async function downloadTemplate() {
    setDownloadError('');
    try {
      const blob = await fetchCsvTemplate(token);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'content_import_template.csv';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      if (isAuthError(cause)) {
        onAuthExpired();
        return;
      }
      setDownloadError('Não foi possível baixar o modelo CSV.');
    }
  }

  return (
    <section className="content-panel">
      <div className="panel-heading">
        <div>
          <span>CSV</span>
          <h2>Importação de conteúdo</h2>
          <p>Use esta área para validar e importar pontos, autores e textos em lote.</p>
        </div>
        <button type="button" className="secondary-action" onClick={() => void downloadTemplate()}>
          Baixar modelo CSV
        </button>
      </div>
      {downloadError ? <p className="import-error standalone-error">{downloadError}</p> : null}
      <CsvImportPanel
        token={token}
        onAuthExpired={onAuthExpired}
        onImported={invalidateImportQueries}
        onGenerate={onGenerate}
      />
    </section>
  );
}

function CsvImportPanel({
  token,
  onAuthExpired,
  onImported,
  onGenerate
}: {
  token: string;
  onAuthExpired: () => void;
  onImported: () => void;
  onGenerate?: (textIds: string[]) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewRow[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Selecione um CSV antes de gerar o preview.');
      return postCsv<ImportPreviewRow[]>('/api/v1/admin/points/import/preview', file, token);
    },
    onSuccess: (rows) => {
      setPreview(rows);
      setResult(null);
      setError('');
    },
    onError: (cause) => {
      if (isAuthError(cause)) {
        onAuthExpired();
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Não foi possível gerar o preview.');
    }
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Selecione um CSV antes de confirmar.');
      return postCsv<ImportResult>('/api/v1/admin/points/import/confirm', file, token);
    },
    onSuccess: (nextResult) => {
      setResult(nextResult);
      setPreview((current) => (nextResult.errors.length > 0 ? nextResult.errors : current));
      setError('');
      onImported();
    },
    onError: (cause) => {
      if (isAuthError(cause)) {
        onAuthExpired();
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Não foi possível confirmar a importação.');
    }
  });

  const hasBlockingErrors = preview.some((row) => row.errors.length > 0);
  const canConfirm = Boolean(file && preview.length > 0 && !hasBlockingErrors && !confirmMutation.isPending);

  function updateFile(nextFile?: File) {
    setFile(nextFile ?? null);
    setPreview([]);
    setResult(null);
    setError('');
  }

  return (
    <section className="import-panel">
      <div className="import-heading">
        <div>
          <span>Importação CSV</span>
          <h3>Adicionar pontos em lote</h3>
        </div>
        <p>Colunas obrigatórias: point_name, address, neighborhood, city, country, lat_override, lng_override, author_name, content_pt, content_type, source_work, source_year.</p>
      </div>

      <div className="import-actions">
        <label>
          Arquivo CSV
          <input accept=".csv,text/csv" type="file" onChange={(event) => updateFile(event.target.files?.[0])} />
        </label>
        <button type="button" className="secondary-action" disabled={!file || previewMutation.isPending} onClick={() => previewMutation.mutate()}>
          {previewMutation.isPending ? 'A validar...' : 'Gerar preview'}
        </button>
        <button type="button" disabled={!canConfirm} onClick={() => confirmMutation.mutate()}>
          {confirmMutation.isPending ? 'A importar...' : 'Confirmar importação'}
        </button>
      </div>

      {error ? <p className="import-error">{error}</p> : null}
      {result ? (
        <div className="import-complete-row">
          <p className="import-summary">
            Importação concluída: {result.created} criados, {result.updated} atualizados
            {result.errors.length > 0 ? `, ${result.errors.length} linhas ignoradas` : ''}.
          </p>
          {result.imported_text_ids.length > 0 && onGenerate ? (
            <button type="button" onClick={() => onGenerate(result.imported_text_ids)}>
              Gerar traduções e áudios
            </button>
          ) : null}
        </div>
      ) : null}

      {preview.length > 0 ? <ImportPreviewTable rows={preview} /> : null}
    </section>
  );
}

function ImportPreviewTable({ rows }: { rows: ImportPreviewRow[] }) {
  return (
    <div className="table-wrap import-preview">
      <table>
        <thead>
          <tr>
            <th>Linha</th>
            <th>Autor</th>
            <th>Ponto</th>
            <th>Ação</th>
            <th>Erros</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.row_number}-${row.title}`}>
              <td>{row.row_number}</td>
              <td>{row.author_name || '-'}</td>
              <td>{row.title || '-'}</td>
              <td>
                <span className={`status-pill ${row.action}`}>{importActionLabel(row.action)}</span>
              </td>
              <td>{row.errors.length > 0 ? row.errors.join('; ') : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function importActionLabel(action: ImportPreviewRow['action']) {
  if (action === 'create') return 'Criar';
  if (action === 'update') return 'Atualizar';
  return 'Corrigir';
}
