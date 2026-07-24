export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="state-panel error-state">
      <p>{message}</p>
      <button type="button" onClick={onRetry}>Tentar novamente</button>
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="state-panel">
      <p>{message}</p>
    </div>
  );
}
