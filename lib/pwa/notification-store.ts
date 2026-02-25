export const STORAGE_KEY = 'maleq-notifications';
const MAX_NOTIFICATIONS = 50;
const DEDUPE_WINDOW_MS = 15_000;
export const NOTIFICATIONS_UPDATED_EVENT = 'maleq-notifications-updated';

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
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications));
    window.dispatchEvent(new Event(NOTIFICATIONS_UPDATED_EVENT));
  } catch {
    // localStorage full or unavailable
  }
}

export function onNotificationsUpdated(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = () => handler();
  window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, listener);
  return () => window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, listener);
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
  const type = payload.tag || 'general';
  const body = payload.body || '';
  const url = payload.url || '/';
  const now = Date.now();
  const notification: StoredNotification = {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    title: payload.title,
    body,
    url,
    type,
    timestamp: now,
    read: false,
  };

  const list = readStore();
  const recentDuplicate = list.find(
    (item) =>
      item.title === payload.title &&
      item.body === body &&
      item.url === url &&
      item.type === type &&
      now - item.timestamp <= DEDUPE_WINDOW_MS
  );
  if (recentDuplicate) {
    return recentDuplicate;
  }

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

export function clearNotifications() {
  writeStore([]);
}

export function getUnreadCount(): number {
  return readStore().filter((n) => !n.read).length;
}
