import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addDismissedBatchId,
  isDismissibleBatchStatus,
  parseDismissedBatchIds
} from './batches/batchDismissal.ts';

test('parseDismissedBatchIds tolerates missing or invalid storage', () => {
  assert.deepEqual(parseDismissedBatchIds(null), []);
  assert.deepEqual(parseDismissedBatchIds('{invalid'), []);
  assert.deepEqual(parseDismissedBatchIds(JSON.stringify({ id: 'batch-1' })), []);
});

test('parseDismissedBatchIds keeps unique string IDs and caps stored history', () => {
  const ids = Array.from({ length: 55 }, (_, index) => `batch-${index}`);
  const parsed = parseDismissedBatchIds(JSON.stringify([...ids, 'batch-54', null, 12]));

  assert.equal(parsed.length, 50);
  assert.equal(parsed[0], 'batch-5');
  assert.equal(parsed.at(-1), 'batch-54');
});

test('addDismissedBatchId appends the latest dismissal without duplicates', () => {
  assert.deepEqual(addDismissedBatchId(['batch-1', 'batch-2'], 'batch-1'), ['batch-2', 'batch-1']);
});

test('addDismissedBatchId retains only the 50 most recent dismissals', () => {
  const ids = Array.from({ length: 50 }, (_, index) => `batch-${index}`);
  const next = addDismissedBatchId(ids, 'batch-new');

  assert.equal(next.length, 50);
  assert.equal(next[0], 'batch-1');
  assert.equal(next.at(-1), 'batch-new');
});

test('allows completed and partially failed batches to be dismissed', () => {
  assert.equal(isDismissibleBatchStatus('completed'), true);
  assert.equal(isDismissibleBatchStatus('partial_failure'), true);
  assert.equal(isDismissibleBatchStatus('running'), false);
  assert.equal(isDismissibleBatchStatus('awaiting_review'), false);
});
