import {
  routeSegments,
  routeVersion,
  type PublicBridgeRouteSegment,
  type PublicRoute,
  type PublicTextRouteSegment,
  type RouteSession,
  type RouteSessionPhase
} from '@ecosdelisboa/shared';

export const ARRIVAL_RADIUS_M = 35;
export const MAX_AUTO_ARRIVAL_ACCURACY_M = 60;
export const REQUIRED_ARRIVAL_READINGS = 2;

export interface VisitorLocation {
  lat: number;
  lng: number;
  accuracy: number;
}

export function textSegments(route: PublicRoute): PublicTextRouteSegment[] {
  return routeSegments(route).filter((segment): segment is PublicTextRouteSegment => segment.kind === 'text');
}

export function bridgesAfterActiveText(route: PublicRoute, activeTextIndex: number): PublicBridgeRouteSegment[] {
  const segments = routeSegments(route);
  const texts = textSegments(route);
  const current = texts[activeTextIndex];
  const next = texts[activeTextIndex + 1];
  if (!current) return [];
  return segments.filter(
    (segment): segment is PublicBridgeRouteSegment =>
      segment.kind === 'bridge' &&
      segment.position > current.position &&
      (!next || segment.position < next.position)
  );
}

export function initialRouteSession(route: PublicRoute, now = new Date()): RouteSession {
  return {
    route_id: route.id,
    route_version: routeVersion(route),
    phase: 'preview',
    active_text_index: 0,
    active_leg_position: null,
    consecutive_arrival_readings: 0,
    updated_at: now.toISOString()
  };
}

export function startRouteSession(session: RouteSession, now = new Date()): RouteSession {
  return updateSession(session, 'going_to_first_text', now, {
    active_text_index: 0,
    active_leg_position: null,
    consecutive_arrival_readings: 0
  });
}

export function confirmArrival(session: RouteSession, now = new Date()): RouteSession {
  return updateSession(session, 'arrived', now, { consecutive_arrival_readings: 0 });
}

export function markListening(session: RouteSession, now = new Date()): RouteSession {
  return updateSession(session, 'listening', now);
}

export function advanceRouteSession(route: PublicRoute, session: RouteSession, now = new Date()): RouteSession {
  const lastTextIndex = textSegments(route).length - 1;
  if (session.active_text_index >= lastTextIndex) {
    return updateSession(session, 'completed', now, { active_leg_position: null });
  }
  return updateSession(session, 'walking', now, {
    active_leg_position: session.active_text_index,
    consecutive_arrival_readings: 0
  });
}

export function registerLocation(
  route: PublicRoute,
  session: RouteSession,
  location: VisitorLocation,
  now = new Date()
): RouteSession {
  if (session.phase !== 'going_to_first_text' && session.phase !== 'walking') return session;
  const targetIndex = session.phase === 'going_to_first_text' ? 0 : session.active_text_index + 1;
  const target = textSegments(route)[targetIndex];
  if (!target) return session;
  const distance = distanceMeters(location, target.text.point);
  const accurateEnough = location.accuracy <= MAX_AUTO_ARRIVAL_ACCURACY_M;
  const withinRadius = distance <= ARRIVAL_RADIUS_M + Math.max(0, location.accuracy);
  const readings = accurateEnough && withinRadius ? session.consecutive_arrival_readings + 1 : 0;
  if (readings < REQUIRED_ARRIVAL_READINGS) {
    return { ...session, consecutive_arrival_readings: readings, updated_at: now.toISOString() };
  }
  return updateSession(session, 'arrived', now, {
    active_text_index: targetIndex,
    active_leg_position: null,
    consecutive_arrival_readings: 0
  });
}

export function activeDestination(route: PublicRoute, session: RouteSession): PublicTextRouteSegment | undefined {
  const texts = textSegments(route);
  return texts[session.phase === 'walking' ? session.active_text_index + 1 : session.active_text_index];
}

export function activeLeg(route: PublicRoute, session: RouteSession) {
  if (session.active_leg_position == null) return undefined;
  return route.legs?.find((leg) => leg.position === session.active_leg_position) ?? route.legs?.[session.active_leg_position];
}

export function distanceMeters(a: Pick<VisitorLocation, 'lat' | 'lng'>, b: { lat: number; lng: number }) {
  const earthRadius = 6_371_000;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = radians(b.lat - a.lat);
  const deltaLng = radians(b.lng - a.lng);
  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const value = sinLat * sinLat + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * sinLng * sinLng;
  return 2 * earthRadius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function routeSessionStorageKey(routeId: string) {
  return `ecos-route-session:${routeId}`;
}

export function restoreRouteSession(route: PublicRoute, raw: string | null): RouteSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RouteSession;
    if (parsed.route_id !== route.id || parsed.route_version !== routeVersion(route)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function updateSession(
  session: RouteSession,
  phase: RouteSessionPhase,
  now: Date,
  values: Partial<RouteSession> = {}
): RouteSession {
  return { ...session, ...values, phase, updated_at: now.toISOString() };
}
