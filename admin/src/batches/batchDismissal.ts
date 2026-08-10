import type { GenerationBatchStatus } from '@ecosdelisboa/shared';

export const DISMISSED_BATCHES_STORAGE_KEY = 'ecos-admin:dismissed-generation-batches:v1';

const MAX_DISMISSED_BATCHES = 50;

export function parseDismissedBatchIds(value: string | null): string[] {
  if (!value) return [];

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    return [...new Set(parsed.filter((item): item is string => typeof item === 'string' && item.length > 0))]
      .slice(-MAX_DISMISSED_BATCHES);
  } catch {
    return [];
  }
}

export function addDismissedBatchId(ids: Iterable<string>, batchId: string): string[] {
  return [...Array.from(ids).filter((id) => id !== batchId), batchId].slice(-MAX_DISMISSED_BATCHES);
}

export function isDismissibleBatchStatus(status: GenerationBatchStatus): boolean {
  return status === 'completed' || status === 'partial_failure';
}
