/**
 * Unified order/shipment status colors - single source of truth.
 *
 * Uses design-system tokens (success/info/warning/destructive/muted) —
 * tokens handle dark mode, so no dark: variants needed.
 */
export const statusColors: Record<string, string> = {
  completed:  'bg-success/10 text-success',
  shipped:    'bg-info/10 text-info',
  delivered:  'bg-success/10 text-success',
  processing: 'bg-info/10 text-info',
  'on-hold':  'bg-warning/10 text-warning',
  pending:    'bg-warning/10 text-warning',
  cancelled:  'bg-destructive/10 text-destructive',
  failed:     'bg-destructive/10 text-destructive',
  refunded:   'bg-muted text-muted-foreground',
};

export const defaultStatusColor = 'bg-muted text-muted-foreground';

export function getStatusColor(status: string): string {
  return statusColors[status] || defaultStatusColor;
}

export function formatStatus(status: string): string {
  return status.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
