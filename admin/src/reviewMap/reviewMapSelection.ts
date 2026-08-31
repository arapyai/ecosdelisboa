import type { ReviewMapBounds, ReviewMapPoint } from '@ecosdelisboa/shared';

export function excludeReviewCode(codes: string[], code: string): string[] {
  return codes.includes(code) ? codes : [...codes, code];
}

export function restoreReviewCode(codes: string[], code: string): string[] {
  return codes.filter((candidate) => candidate !== code);
}

export function fitReviewMapBounds(
  points: ReviewMapPoint[],
  aspect: number,
  fallback: ReviewMapBounds
): ReviewMapBounds {
  if (points.length === 0) return fallback;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    const [x, y] = worldCoordinates(point.lng, point.lat);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  const minimumSpan = 0.018 / 360;
  let spanX = Math.max(maxX - minX, minimumSpan);
  let spanY = Math.max(maxY - minY, minimumSpan);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  if (spanX / spanY < aspect) {
    spanX = spanY * aspect;
  } else {
    spanY = spanX / aspect;
  }
  spanX *= 1.18;
  spanY *= 1.18;

  const [west, north] = lngLatCoordinates(centerX - spanX / 2, centerY - spanY / 2);
  const [east, south] = lngLatCoordinates(centerX + spanX / 2, centerY + spanY / 2);
  return { west, south, east, north };
}

function worldCoordinates(lng: number, lat: number): [number, number] {
  const limitedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sine = Math.sin(limitedLat * Math.PI / 180);
  return [
    (lng + 180) / 360,
    0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)
  ];
}

function lngLatCoordinates(x: number, y: number): [number, number] {
  return [
    x * 360 - 180,
    Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI
  ];
}
