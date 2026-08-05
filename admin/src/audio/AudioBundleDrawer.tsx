import type { AudioBundlePreview } from '@ecosdelisboa/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { postBlob, postFile, redirectIfAuthError } from '../adminApi';
import { client } from '../adminConfig';

export function AudioBundleDrawer({ mode, token, textIds, onClose, onAuthExpired }: {
  mode: 'export' | 'import';
  token: string;
  textIds: string[];
  onClose: () => void;
  onAuthExpired: () => void;
}) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<AudioBundlePreview | null>(null);
  const [message, setMessage] = useState('');
  const exportQuery = useQuery({
    queryKey: ['audio-bundle-export-preview', textIds, token],
    queryFn: () => client.post<AudioBundlePreview>('/api/v1/admin/audio-bundles/export/preview', { text_ids: textIds }, token),
    enabled: mode === 'export'
  });
  const previewMutation = useMutation({
    mutationFn: (selected: File) => postFile<AudioBundlePreview>('/api/v1/admin/audio-bundles/import/preview', selected, token),
    onSuccess: setImportPreview,
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setMessage(cause instanceof Error ? cause.message : 'Não foi possível ler o pacote.');
    }
  });
  const exportMutation = useMutation({
    mutationFn: () => postBlob('/api/v1/admin/audio-bundles/export', { text_ids: textIds }, token),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `lisboa-audios-${new Date().toISOString().slice(0, 10)}.zip`;
      link.click();
      URL.revokeObjectURL(url);
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setMessage('Não foi possível exportar o pacote.');
    }
  });
  const confirmMutation = useMutation({
    mutationFn: () => postFile<{ applied: number }>('/api/v1/admin/audio-bundles/import/confirm', file!, token),
    onSuccess: async (result) => {
      setMessage(`${result.applied} áudio${result.applied === 1 ? '' : 's'} importado${result.applied === 1 ? '' : 's'}.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-audio', token] }),
        queryClient.invalidateQueries({ queryKey: ['admin-resource', 'texts', token] })
      ]);
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setMessage('Não foi possível importar o pacote.');
    }
  });
  const preview = mode === 'export' ? exportQuery.data : importPreview;
  const actionCount = mode === 'export'
    ? preview?.counts.exportable ?? 0
    : (preview?.counts.create ?? 0) + (preview?.counts.replace_automatic ?? 0);
  return <aside className="text-editor-drawer audio-bundle-drawer" aria-label={mode === 'export' ? 'Exportar áudios' : 'Importar pacote de áudios'}>
    <header className="text-editor-header"><div><h3>{mode === 'export' ? 'Exportar áudios' : 'Importar pacote'}</h3><span>{mode === 'export' ? `${textIds.length} textos selecionados` : 'Pacote portátil ZIP'}</span></div><button type="button" className="close-editor" aria-label="Fechar" onClick={onClose}>×</button></header>
    <div className="audio-bundle-body">
      {mode === 'import' ? <label className="audio-bundle-upload"><strong>Escolha o pacote .zip</strong><input type="file" accept=".zip,application/zip" onChange={(event) => { const selected = event.target.files?.[0] ?? null; setFile(selected); setImportPreview(null); setMessage(''); if (selected) previewMutation.mutate(selected); }} /><small>O arquivo só será aplicado após sua confirmação.</small></label> : null}
      {(exportQuery.isLoading || previewMutation.isPending) ? <p>Verificando áudios…</p> : null}
      {preview ? <><div className="audio-bundle-summary">{Object.entries(preview.counts).map(([key, value]) => <span key={key}><strong>{value}</strong>{labelFor(key)}</span>)}</div><div className="audio-bundle-table"><table><thead><tr><th>Texto</th><th>Idioma</th><th>Ação</th></tr></thead><tbody>{preview.rows.map((row, index) => <tr key={`${row.recipe_hash ?? row.text_id}-${index}`}><td>{row.text || '—'}<small>{row.reason}</small></td><td>{row.lang?.toUpperCase() || '—'}</td><td><span className={`bundle-status ${row.action ?? row.status}`}>{labelFor(row.action ?? row.status ?? '')}</span></td></tr>)}</tbody></table></div></> : null}
      {message ? <p className="drawer-message" role="status">{message}</p> : null}
    </div>
    <footer className="text-editor-footer"><span>{actionCount} ação{actionCount === 1 ? '' : 'ões'} pronta{actionCount === 1 ? '' : 's'}</span><div><button type="button" className="secondary-action" onClick={onClose}>Fechar</button>{mode === 'export' ? <button type="button" disabled={!actionCount || exportMutation.isPending} onClick={() => exportMutation.mutate()}>{exportMutation.isPending ? 'A preparar…' : 'Baixar pacote'}</button> : <button type="button" disabled={!file || !actionCount || confirmMutation.isPending} onClick={() => confirmMutation.mutate()}>{confirmMutation.isPending ? 'A importar…' : 'Confirmar importação'}</button>}</div></footer>
  </aside>;
}

function labelFor(value: string) {
  return ({ exportable: 'Exportável', missing: 'Ausente', manual: 'Manual', legacy: 'Legado', invalid: 'Inválido', create: 'Criar', replace_automatic: 'Substituir', already_current: 'Atual', preserve_manual: 'Preservar manual', unmatched: 'Sem correspondência' } as Record<string, string>)[value] ?? value;
}
