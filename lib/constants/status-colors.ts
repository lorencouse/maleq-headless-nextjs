/**
 * Unified order/shipment status colors - single source of truth.
 *
 * Uses /20 dark-mode opacity and -400 dark text consistently.
 */
export const statusColors: Record<string, string> = {
  completed:  'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400',
  shipped:    'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-400',
  delivered:  'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400',
  processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400',
  'on-hold':  'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400',
  pending:    'bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-400',
  cancelled:  'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400',
  failed:     'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400',
  refunded:   'bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400',
};

export const defaultStatusColor = 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400';

export function getStatusColor(status: string): string {
  return statusColors[status] || defaultStatusColor;
}

export function formatStatus(status: string): string {
  return status.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
