import './StatusIndicator.css';

export type StatusTone = 'success' | 'danger' | 'neutral';

interface StatusIndicatorProps {
  tone: StatusTone;
  label: string;
}

// Colored dot + text label: the state never relies on color alone.
export function StatusIndicator({ tone, label }: StatusIndicatorProps) {
  return (
    <span className={`status-indicator status-indicator--${tone}`} role="status">
      <span className="status-indicator-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
