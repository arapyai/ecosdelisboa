import type { Lang, Point } from '../types';

export const PROXIMITY_RADIUS_M = 100;
export const MAX_PROXIMITY_ACCURACY_M = 60;
export const PROXIMITY_NOTIFICATION_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const LOCATION_QUERY_MOVE_THRESHOLD_M = 100;

export interface VisitorLocation {
  lat: number;
  lng: number;
  accuracy: number;
}

type Coordinate = [lng: number, lat: number];

const MAINLAND_PORTUGAL: Coordinate[] = [
  [-8.95, 41.98],
  [-8.20, 42.15],
  [-6.75, 42.15],
  [-6.18, 41.58],
  [-6.55, 41.05],
  [-6.82, 40.25],
  [-7.03, 39.00],
  [-7.33, 38.45],
  [-7.50, 37.00],
  [-8.95, 36.90],
  [-9.23, 38.00],
  [-9.50, 38.75],
  [-9.35, 39.30],
  [-9.12, 40.00],
  [-8.87, 41.00]
];

const PORTUGAL_ISLAND_BOUNDS = [
  { minLat: 36.7, maxLat: 40.1, minLng: -31.5, maxLng: -24.5 },
  { minLat: 30.9, maxLat: 33.2, minLng: -17.4, maxLng: -15.6 }
];

function isInsidePolygon(location: Pick<VisitorLocation, 'lat' | 'lng'>, polygon: Coordinate[]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [lng, lat] = polygon[index];
    const [previousLng, previousLat] = polygon[previous];
    const crossesLatitude = lat > location.lat !== previousLat > location.lat;
    const intersectionLng = ((previousLng - lng) * (location.lat - lat)) / (previousLat - lat) + lng;
    if (crossesLatitude && location.lng < intersectionLng) inside = !inside;
  }
  return inside;
}

export function isLocationInPortugal(location: Pick<VisitorLocation, 'lat' | 'lng'>) {
  if (isInsidePolygon(location, MAINLAND_PORTUGAL)) return true;
  return PORTUGAL_ISLAND_BOUNDS.some(
    (bounds) =>
      location.lat >= bounds.minLat &&
      location.lat <= bounds.maxLat &&
      location.lng >= bounds.minLng &&
      location.lng <= bounds.maxLng
  );
}

export function distanceMeters(
  from: Pick<VisitorLocation, 'lat' | 'lng'>,
  to: Pick<VisitorLocation, 'lat' | 'lng'>
) {
  const earthRadiusM = 6_371_000;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = radians(to.lat - from.lat);
  const deltaLng = radians(to.lng - from.lng);
  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const value =
    sinLat * sinLat +
    Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * sinLng * sinLng;
  return 2 * earthRadiusM * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function pointsWithinRadius(location: VisitorLocation, points: Point[], radiusM = PROXIMITY_RADIUS_M) {
  return points
    .map((point) => ({ point, distanceM: distanceMeters(location, point) }))
    .filter((item) => item.distanceM <= radiusM)
    .sort((left, right) => left.distanceM - right.distanceM);
}

export function canNotifyPoint(lastNotifiedAt: number | undefined, now = Date.now()) {
  return lastNotifiedAt == null || now - lastNotifiedAt >= PROXIMITY_NOTIFICATION_COOLDOWN_MS;
}

export type LocationStatus = 'locating' | 'available' | 'outside_portugal' | 'denied' | 'unavailable';

const proximityMessages: Record<Lang, {
  location: Record<LocationStatus, string>;
  enable: string;
  enabled: string;
  blocked: string;
  retry: string;
  nearbyTitle: string;
  nearbyBody: (pointTitle: string) => string;
  openPoint: string;
  dismiss: string;
}> = {
  pt: {
    location: {
      locating: 'A procurar sua localização…',
      available: 'A usar sua localização.',
      outside_portugal: 'Você está fora de Portugal; a mostrar Lisboa.',
      denied: 'Localização não autorizada; a mostrar Lisboa.',
      unavailable: 'Localização indisponível; a mostrar Lisboa.'
    },
    enable: 'Ativar avisos próximos', enabled: 'Avisos próximos ativos', blocked: 'Notificações bloqueadas', retry: 'Tentar localização novamente',
    nearbyTitle: 'Um ponto literário está perto',
    nearbyBody: (pointTitle) => `Você está a menos de 100 m de ${pointTitle}.`,
    openPoint: 'Abrir ponto', dismiss: 'Dispensar'
  },
  en: {
    location: {
      locating: 'Finding your location…', available: 'Using your location.',
      outside_portugal: 'You are outside Portugal; showing Lisbon.',
      denied: 'Location was not allowed; showing Lisbon.', unavailable: 'Location unavailable; showing Lisbon.'
    },
    enable: 'Enable nearby alerts', enabled: 'Nearby alerts enabled', blocked: 'Notifications blocked', retry: 'Try location again',
    nearbyTitle: 'A literary point is nearby', nearbyBody: (pointTitle) => `You are within 100 m of ${pointTitle}.`,
    openPoint: 'Open point', dismiss: 'Dismiss'
  },
  es: {
    location: {
      locating: 'Buscando tu ubicación…', available: 'Usando tu ubicación.',
      outside_portugal: 'Estás fuera de Portugal; mostrando Lisboa.',
      denied: 'Ubicación no autorizada; mostrando Lisboa.', unavailable: 'Ubicación no disponible; mostrando Lisboa.'
    },
    enable: 'Activar avisos cercanos', enabled: 'Avisos cercanos activos', blocked: 'Notificaciones bloqueadas', retry: 'Intentar ubicación de nuevo',
    nearbyTitle: 'Hay un punto literario cerca', nearbyBody: (pointTitle) => `Estás a menos de 100 m de ${pointTitle}.`,
    openPoint: 'Abrir punto', dismiss: 'Descartar'
  },
  fr: {
    location: {
      locating: 'Recherche de votre position…', available: 'Votre position est utilisée.',
      outside_portugal: 'Vous êtes hors du Portugal ; affichage de Lisbonne.',
      denied: 'Localisation non autorisée ; affichage de Lisbonne.', unavailable: 'Localisation indisponible ; affichage de Lisbonne.'
    },
    enable: 'Activer les alertes à proximité', enabled: 'Alertes à proximité actives', blocked: 'Notifications bloquées', retry: 'Réessayer la localisation',
    nearbyTitle: 'Un lieu littéraire est proche', nearbyBody: (pointTitle) => `Vous êtes à moins de 100 m de ${pointTitle}.`,
    openPoint: 'Ouvrir le lieu', dismiss: 'Ignorer'
  },
  de: {
    location: {
      locating: 'Standort wird gesucht…', available: 'Ihr Standort wird verwendet.',
      outside_portugal: 'Sie sind außerhalb Portugals; Lissabon wird angezeigt.',
      denied: 'Standort nicht erlaubt; Lissabon wird angezeigt.', unavailable: 'Standort nicht verfügbar; Lissabon wird angezeigt.'
    },
    enable: 'Hinweise in der Nähe aktivieren', enabled: 'Hinweise in der Nähe aktiv', blocked: 'Benachrichtigungen blockiert', retry: 'Standort erneut versuchen',
    nearbyTitle: 'Ein literarischer Ort ist in der Nähe', nearbyBody: (pointTitle) => `Sie sind weniger als 100 m von ${pointTitle} entfernt.`,
    openPoint: 'Ort öffnen', dismiss: 'Schließen'
  },
  zh: {
    location: {
      locating: '正在获取您的位置…', available: '正在使用您的位置。',
      outside_portugal: '您不在葡萄牙境内；正在显示里斯本。',
      denied: '未获位置权限；正在显示里斯本。', unavailable: '无法获取位置；正在显示里斯本。'
    },
    enable: '开启附近提醒', enabled: '附近提醒已开启', blocked: '通知已被阻止', retry: '重新获取位置',
    nearbyTitle: '附近有一处文学地点', nearbyBody: (pointTitle) => `您距离${pointTitle}不到100米。`,
    openPoint: '打开地点', dismiss: '忽略'
  }
};

export function proximityCopy(lang: Lang) {
  return proximityMessages[lang] ?? proximityMessages.pt;
}
