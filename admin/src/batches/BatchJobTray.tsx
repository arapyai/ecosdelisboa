import type { ContentGenerationBatch } from '@ecosdelisboa/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { redirectIfAuthError } from '../adminApi';
import { client } from '../adminConfig';
import {
  addDismissedBatchId,
  DISMISSED_BATCHES_STORAGE_KEY,
  isDismissibleBatchStatus,
  parseDismissedBatchIds
} from './batchDismissal';

const stageLabels: Record<ContentGenerationBatch['current_stage'], string> = {
  generating_translations: 'Gerando traduções',
  awaiting_review: 'Traduções aguardando revisão',
  ready_for_translated_audio: 'Pronto para gerar áudios traduzidos',
  generating_audio: 'Gerando áudios',
  completed: 'Geração concluída'
};

export function BatchJobTray({ token, onAuthExpired, onReview }: {
  token: string;
  onAuthExpired: () => void;
  onReview: (batchId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [dismissedBatchIds, setDismissedBatchIds] = useState<Set<string>>(() => {
    try {
      return new Set(parseDismissedBatchIds(window.localStorage.getItem(DISMISSED_BATCHES_STORAGE_KEY)));
    } catch {
      return new Set();
    }
  });
  const batchesQuery = useQuery({
    queryKey: ['generation-batches', token],
    queryFn: () => client.get<ContentGenerationBatch[]>('/api/v1/admin/automation/batches?active=false', token),
    refetchInterval: 1500,
    refetchOnWindowFocus: true
  });
  const visibleBatches = (batchesQuery.data ?? []).filter((item) => !dismissedBatchIds.has(item.id));
  const recentCompleted = visibleBatches.find((item) => (
    item.status === 'completed'
    && Date.now() - new Date(item.created_at).getTime() < 5 * 60 * 1000
  ));
  const batch = visibleBatches.find((item) => item.status !== 'completed') ?? recentCompleted;
  const terminalBatchIds = visibleBatches
    .filter((item) => item.status === 'completed' || item.status === 'partial_failure')
    .map((item) => item.id)
    .join(',');
  useEffect(() => {
    if (!terminalBatchIds) return;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-audio', token] }),
      queryClient.invalidateQueries({ queryKey: ['admin-translations', token] }),
      queryClient.invalidateQueries({ queryKey: ['admin-resource', 'texts', token] })
    ]);
  }, [queryClient, terminalBatchIds, token]);
  const actionMutation = useMutation({
    mutationFn: (path: 'translated-audio' | 'retry-failed') =>
      client.post<ContentGenerationBatch>(`/api/v1/admin/automation/batches/${batch?.id}/${path}`, {}, token),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['generation-batches', token] });
    },
    onError: (cause) => redirectIfAuthError(cause, onAuthExpired)
  });

  function dismissBatch(batchId: string) {
    const ids = addDismissedBatchId(dismissedBatchIds, batchId);
    try {
      window.localStorage.setItem(DISMISSED_BATCHES_STORAGE_KEY, JSON.stringify(ids));
    } catch {
      // The tray still closes when browser storage is unavailable.
    }
    setDismissedBatchIds(new Set(ids));
  }

  if (!batch) return null;
  const { progress } = batch;
  const percent = progress.total > 0
    ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
    : 0;
  const label = batch.status === 'partial_failure'
    ? 'Concluído com falhas'
    : stageLabels[batch.current_stage];

  return (
    <aside className={`batch-job-tray ${expanded ? 'expanded' : ''}`} aria-live="polite">
      <div className="batch-job-heading">
        <div>
          <span>Processamento em lote</span>
          <strong>{label}</strong>
        </div>
        <span className="batch-progress-label">{percent}%</span>
      </div>
      <div className="batch-progress-track" aria-label={`${percent}% concluído`}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <p>
        {progress.processed} de {progress.total} processados
        {progress.skipped ? ` · ${progress.skipped} preservados` : ''}
        {progress.failed ? ` · ${progress.failed} falharam` : ''}
      </p>
      <div className="batch-job-actions">
        {batch.current_stage === 'awaiting_review' ? (
          <button type="button" onClick={() => onReview(batch.id)}>
            Revisar {batch.pending_reviews.length} traduções
          </button>
        ) : null}
        {batch.current_stage === 'ready_for_translated_audio' ? (
          <button type="button" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate('translated-audio')}>
            Gerar áudios traduzidos
          </button>
        ) : null}
        {batch.status === 'partial_failure' ? (
          <button type="button" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate('retry-failed')}>
            Tentar novamente
          </button>
        ) : null}
        {isDismissibleBatchStatus(batch.status) ? (
          <button type="button" className="secondary-action" onClick={() => dismissBatch(batch.id)}>
            Fechar
          </button>
        ) : null}
        <button type="button" className="text-action" onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Ocultar detalhes' : 'Ver detalhes'}
        </button>
      </div>
      {expanded ? (
        <div className="batch-job-details">
          <span>{progress.succeeded} concluídos</span>
          <span>{progress.skipped} ignorados</span>
          <span>{progress.failed} falhas</span>
          {batch.errors.slice(0, 4).map((error) => (
            <p key={`${error.kind}-${error.text_id}-${error.lang}`}>{error.lang.toUpperCase()} · {error.message ?? 'Falha no processamento'}</p>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
