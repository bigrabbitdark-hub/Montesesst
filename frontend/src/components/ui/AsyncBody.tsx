import { Skeleton } from './Skeleton';

export function AsyncBody<T>({
  data,
  error,
  loading,
  onRetry,
  render,
  skeletonClassName = 'h-24 w-full',
}: {
  data: T | null;
  error: string | null;
  loading: boolean;
  onRetry?: () => void;
  render: (data: T) => React.ReactNode;
  skeletonClassName?: string;
}) {
  if (loading) return <Skeleton className={skeletonClassName} />;
  if (error) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 text-sm text-dash-status-crit-text">
        <span>{error}</span>
        {onRetry && (
          <button type="button" onClick={onRetry} className="rounded border border-dash-border-input px-2 py-1 text-xs font-semibold">
            Tentar novamente
          </button>
        )}
      </div>
    );
  }
  if (data === null) return <p className="text-sm text-dash-muted">Nenhum dado disponível.</p>;
  return <>{render(data)}</>;
}
