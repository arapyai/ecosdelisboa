import { useEffect, useRef, useState } from 'react';
import { cityConfig } from '../config/city';
import { localized } from '../i18n/messages';
import {
  canNotifyPoint,
  MAX_PROXIMITY_ACCURACY_M,
  pointsWithinRadius,
  proximityCopy,
  type VisitorLocation
} from '../lib/proximity';
import type { Lang, Point } from '../types';

const ENABLED_KEY = `${cityConfig.slug}.proximity-notifications.enabled`;
const HISTORY_KEY = `${cityConfig.slug}.proximity-notifications.history.v1`;

interface NearbyNotice {
  point: Point;
  distanceM: number;
}

function readHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

function writeNotificationTime(pointId: string, notifiedAt: number) {
  const history = readHistory();
  const freshHistory = Object.fromEntries(
    Object.entries(history).filter(([, timestamp]) => !canNotifyPoint(timestamp, notifiedAt))
  );
  freshHistory[pointId] = notifiedAt;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(freshHistory));
}

async function showSystemNotification(point: Point, lang: Lang) {
  if (
    document.visibilityState === 'visible' ||
    !('Notification' in window) ||
    Notification.permission !== 'granted'
  ) return;
  const copy = proximityCopy(lang);
  const title = localized(point, 'title', lang);
  const options: NotificationOptions = {
    body: copy.nearbyBody(title),
    icon: '/branding/literary-map-icon.png',
    badge: '/branding/literary-map-icon.png',
    tag: `literary-point-${point.id}`,
    data: { url: `/?point=${encodeURIComponent(point.id)}` }
  };

  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(copy.nearbyTitle, options);
    return;
  }
  new Notification(copy.nearbyTitle, options);
}

export function useProximityNotifications(location: VisitorLocation | null, points: Point[], lang: Lang) {
  const [enabled, setEnabled] = useState(() => localStorage.getItem(ENABLED_KEY) === 'true');
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    'Notification' in window ? Notification.permission : 'unsupported'
  );
  const [notice, setNotice] = useState<NearbyNotice | null>(null);
  const activePointIdsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled || !location || location.accuracy > MAX_PROXIMITY_ACCURACY_M) {
      activePointIdsRef.current = new Set();
      return;
    }

    const nearby = pointsWithinRadius(location, points);
    const currentIds = new Set(nearby.map(({ point }) => point.id));
    const entered = nearby.filter(({ point }) => !activePointIdsRef.current.has(point.id));
    activePointIdsRef.current = currentIds;

    const history = readHistory();
    const next = entered.find(({ point }) => canNotifyPoint(history[point.id]));
    if (!next) return;

    const notifiedAt = Date.now();
    writeNotificationTime(next.point.id, notifiedAt);
    setNotice(next);
    void showSystemNotification(next.point, lang).catch(() => undefined);
  }, [enabled, lang, location, points]);

  async function toggle() {
    if (enabled) {
      localStorage.setItem(ENABLED_KEY, 'false');
      setEnabled(false);
      setNotice(null);
      return;
    }

    if (!('Notification' in window)) {
      localStorage.setItem(ENABLED_KEY, 'true');
      setPermission('unsupported');
      setEnabled(true);
      return;
    }

    const nextPermission = Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission;
    setPermission(nextPermission);
    if (nextPermission === 'denied') return;
    localStorage.setItem(ENABLED_KEY, 'true');
    setEnabled(true);
  }

  return {
    enabled,
    permission,
    notice,
    toggle,
    dismiss: () => setNotice(null)
  };
}
