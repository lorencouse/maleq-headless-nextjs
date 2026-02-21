export const STORAGE_KEY = 'maleq-notifications';
const MAX_NOTIFICATIONS = 50;

export interface StoredNotification {
  id: string;
  title: string;
  body: string;
  url: string;
  type: string;
  timestamp: number;
  read: boolean;
}

function readStore(): StoredNotification[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeStore(notifications: StoredNotification[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications));
  } catch {
    // localStorage full or unavailable
  }
}

export function getNotifications(): StoredNotification[] {
  return readStore();
}

/** Returns both notifications and unread count in a single localStorage read */
export function getNotificationsWithCount(): { notifications: StoredNotification[]; unreadCount: number } {
  const notifications = readStore();
  const unreadCount = notifications.filter((n) => !n.read).length;
  return { notifications, unreadCount };
}

export function addNotification(payload: {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
}): StoredNotification {
  const notification: StoredNotification = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: payload.title,
    body: payload.body || '',
    url: payload.url || '/',
    type: payload.tag || 'general',
    timestamp: Date.now(),
    read: false,
  };

  const list = readStore();
  list.unshift(notification);
  writeStore(list.slice(0, MAX_NOTIFICATIONS));
  return notification;
}

export function markAsRead(id: string) {
  const list = readStore();
  const item = list.find((n) => n.id === id);
  if (item) {
    item.read = true;
    writeStore(list);
  }
}

export function markAllAsRead() {
  const list = readStore();
  for (const n of list) {
    n.read = true;
  }
  writeStore(list);
}

export function getUnreadCount(): number {
  return readStore().filter((n) => !n.read).length;
}
