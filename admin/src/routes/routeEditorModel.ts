import type {
  AdminRoute,
  AdminRouteSegment,
  AdminText,
  RouteLeg,
  RouteWaypoint
} from '@ecosdelisboa/shared';

export interface RouteDraft {
  title_pt: string;
  slug: string;
  description_pt: string;
  cover_image_url: string;
  difficulty: string;
  is_published: boolean;
  segments: AdminRouteSegment[];
}

export type RouteLegWaypointDraft = { position: number; waypoints: RouteWaypoint[] };

export function emptyRouteDraft(): RouteDraft {
  return {
    title_pt: '',
    slug: '',
    description_pt: '',
    cover_image_url: '',
    difficulty: 'easy',
    is_published: false,
    segments: []
  };
}

export function routeDraftFromRoute(route: AdminRoute): RouteDraft {
  return {
    title_pt: route.title_pt,
    slug: route.slug ?? '',
    description_pt: route.description_pt ?? '',
    cover_image_url: route.cover_image_url ?? '',
    difficulty: route.difficulty ?? 'easy',
    is_published: Boolean(route.is_published),
    segments: normalizePositions(route.segments ?? [])
  };
}

export function filterAvailableTexts(
  texts: AdminText[],
  query: string,
  segments: AdminRouteSegment[]
): AdminText[] {
  const selected = new Set(
    segments.filter((segment) => segment.kind === 'text').map((segment) => segment.text_id)
  );
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  return texts.filter((text) => {
    if (selected.has(text.id)) return false;
    const haystack = normalize(
      [
        text.author?.name,
        text.source_work,
        text.content_pt,
        text.point?.title_pt,
        text.point?.address,
        text.point?.neighborhood
      ]
        .filter(Boolean)
        .join(' ')
    );
    return terms.every((term) => haystack.includes(term));
  });
}

export function addTextSegment(
  segments: AdminRouteSegment[],
  text: AdminText
): AdminRouteSegment[] {
  return normalizePositions([
    ...segments,
    { id: localSegmentId('text'), position: segments.length, kind: 'text', text_id: text.id, text }
  ]);
}

export function addBridgeSegment(segments: AdminRouteSegment[]): AdminRouteSegment[] {
  return normalizePositions([
    ...segments,
    { id: localSegmentId('bridge'), position: segments.length, kind: 'bridge', bridge_content_pt: '' }
  ]);
}

export function reorderSegments(
  segments: AdminRouteSegment[],
  fromIndex: number,
  toIndex: number
): AdminRouteSegment[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return normalizePositions(segments);
  const next = [...segments];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return normalizePositions(segments);
  next.splice(Math.min(toIndex, next.length), 0, moved);
  return normalizePositions(next);
}

export function normalizePositions(segments: AdminRouteSegment[]): AdminRouteSegment[] {
  return segments.map((segment, index) => ({ ...segment, position: index + 1 }));
}

export function serializeRouteDraft(draft: RouteDraft) {
  return {
    title_pt: draft.title_pt.trim(),
    slug: draft.slug.trim() || null,
    description_pt: draft.description_pt.trim() || null,
    cover_image_url: draft.cover_image_url.trim() || null,
    difficulty: draft.difficulty || null,
    is_published: draft.is_published,
    segments: normalizePositions(draft.segments).map((segment) =>
      segment.kind === 'text'
        ? { position: segment.position, kind: 'text', text_id: segment.text_id }
        : {
            position: segment.position,
            kind: 'bridge',
            bridge_content_pt: segment.bridge_content_pt?.trim() ?? ''
          }
    )
  };
}

export function draftFingerprint(draft: RouteDraft): string {
  return JSON.stringify(serializeRouteDraft(draft));
}

export function waypointDraftFromLegs(legs: RouteLeg[] = []): RouteLegWaypointDraft[] {
  return legs
    .map((leg) => ({ position: leg.position, waypoints: [...leg.waypoints] }))
    .sort((left, right) => left.position - right.position);
}

export function addLegWaypoint(
  legs: RouteLegWaypointDraft[],
  position: number,
  waypoint: RouteWaypoint
): RouteLegWaypointDraft[] {
  const existing = legs.find((leg) => leg.position === position);
  if (existing) {
    return legs.map((leg) =>
      leg.position === position ? { ...leg, waypoints: [...leg.waypoints, waypoint] } : leg
    );
  }
  return [...legs, { position, waypoints: [waypoint] }].sort(
    (left, right) => left.position - right.position
  );
}

export function removeLegWaypoint(
  legs: RouteLegWaypointDraft[],
  position: number,
  waypointIndex: number
): RouteLegWaypointDraft[] {
  return legs.map((leg) =>
    leg.position === position
      ? { ...leg, waypoints: leg.waypoints.filter((_, index) => index !== waypointIndex) }
      : leg
  );
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt');
}

function localSegmentId(kind: string) {
  return `local-${kind}-${globalThis.crypto.randomUUID()}`;
}
