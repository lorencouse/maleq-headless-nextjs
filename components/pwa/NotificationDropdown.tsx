'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  type StoredNotification,
} from '@/lib/pwa/notification-store';

interface NotificationDropdownProps {
  onClose: () => void;
  notifications: StoredNotification[];
  onUpdate: () => void;
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export default function NotificationDropdown({
  onClose,
  notifications,
  onUpdate,
}: NotificationDropdownProps) {
  const router = useRouter();
  const recent = notifications.slice(0, 10);
  const hasUnread = recent.some((n) => !n.read);

  const handleClick = (notification: StoredNotification) => {
    markAsRead(notification.id);
    onUpdate();
    onClose();
    router.push(notification.url);
  };

  const handleMarkAllRead = () => {
    markAllAsRead();
    onUpdate();
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Dropdown */}
      <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-card border border-border rounded-lg shadow-lg z-50">
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-border">
          <p className="font-medium text-foreground text-sm">Notifications</p>
          {hasUnread && (
            <button
              onClick={handleMarkAllRead}
              className="text-xs text-primary hover:text-primary-hover transition-colors"
            >
              Mark all as read
            </button>
          )}
        </div>

        {/* Notification list */}
        <div className="max-h-[360px] overflow-y-auto">
          {recent.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No notifications yet
            </div>
          ) : (
            recent.map((n) => (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className={`w-full text-left px-4 py-3 border-b border-border last:border-0 hover:bg-muted transition-colors ${
                  !n.read ? 'bg-primary/5' : ''
                }`}
              >
                <div className="flex items-start gap-2">
                  {!n.read && (
                    <span className="mt-1.5 flex-shrink-0 h-2 w-2 rounded-full bg-primary" />
                  )}
                  <div className={`min-w-0 flex-1 ${n.read ? 'ml-4' : ''}`}>
                    <p className="text-sm font-medium text-foreground truncate">
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {n.body}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {timeAgo(n.timestamp)}
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border p-2">
          <Link
            href="/account/notifications"
            onClick={onClose}
            className="block text-center text-xs text-primary hover:text-primary-hover py-2 transition-colors"
          >
            Notification Settings
          </Link>
        </div>
      </div>
    </>
  );
}
