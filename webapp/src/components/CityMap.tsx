import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl from 'maplibre-gl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cityConfig } from '../config/city';
import type { Point } from '../types';

interface Props {
  points: Point[];
  selected?: Point | null;
  onSelect: (point: Point) => void;
  selectedTextId?: string | null;
  onSelectText?: (point: Point, textId: string) => void;
}

interface PointLayout {
  point: Point;
  offset: [number, number];
}

interface ProjectedPoint {
  point: Point;
  x: number;
  y: number;
}

const MARKER_SIZE_PX = 34;
const MARKER_GAP_PX = 8;
const TEXT_MARKER_SIZE_PX = 30;
const TEXT_MARKER_GAP_PX = 10;

function getClusterRadiusPx(count: number, markerSizePx: number, gapPx: number) {
  if (count <= 1) return 0;
  const circumference = count * (markerSizePx + gapPx);
  return Math.max(markerSizePx + gapPx, circumference / (2 * Math.PI));
}

function getCircleOffset(index: number, count: number, radiusPx: number): [number, number] {
  if (count <= 1) return [0, 0];
  const angle = (2 * Math.PI * index) / count - Math.PI / 2;
  return [Math.cos(angle) * radiusPx, Math.sin(angle) * radiusPx];
}

function getPointLayouts(points: Point[], map: maplibregl.Map): PointLayout[] {
  const clusters: ProjectedPoint[][] = [];

  points.forEach((point) => {
    const projected = map.project([point.lng, point.lat]);
    const projectedPoint = {
      point,
      x: projected.x,
      y: projected.y
    };
    const cluster = clusters.find((items) =>
      items.some((item) => {
        const distance = Math.hypot(projectedPoint.x - item.x, projectedPoint.y - item.y);
        return distance < MARKER_SIZE_PX + MARKER_GAP_PX;
      })
    );

    if (cluster) {
      cluster.push(projectedPoint);
    } else {
      clusters.push([projectedPoint]);
    }
  });

  const layouts = new Map<string, PointLayout>();
  clusters.forEach((cluster) => {
    const radiusPx = getClusterRadiusPx(cluster.length, MARKER_SIZE_PX, MARKER_GAP_PX);
    const center = cluster.reduce(
      (total, item) => ({
        x: total.x + item.x / cluster.length,
        y: total.y + item.y / cluster.length
      }),
      { x: 0, y: 0 }
    );

    cluster.forEach((item, index) => {
      const circleOffset = getCircleOffset(index, cluster.length, radiusPx);
      layouts.set(item.point.id, {
        point: item.point,
        offset: [
          center.x - item.x + circleOffset[0],
          center.y - item.y + circleOffset[1]
        ]
      });
    });
  });

  return points.map((point) => layouts.get(point.id) ?? { point, offset: [0, 0] });
}

export function CityMap({ points, selected, onSelect, selectedTextId, onSelectText }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [viewportVersion, setViewportVersion] = useState(0);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    mapRef.current = new maplibregl.Map({
      container: containerRef.current,
      style: cityConfig.map.styleUrl,
      center: cityConfig.map.center,
      zoom: cityConfig.map.zoom,
      attributionControl: false
    });
    mapRef.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    const refreshLayout = () => setViewportVersion((version) => version + 1);
    mapRef.current.on('moveend', refreshLayout);
    mapRef.current.on('zoomend', refreshLayout);

    return () => {
      mapRef.current?.off('moveend', refreshLayout);
      mapRef.current?.off('zoomend', refreshLayout);
    };
  }, []);

  const selectedById = useMemo(() => {
    if (!selected) return undefined;
    return new Map([[selected.id, selected]]);
  }, [selected]);

  useEffect(() => {
    if (!mapRef.current) return;
    markersRef.current.forEach((marker) => marker.remove());

    const newMarkers: maplibregl.Marker[] = [];
    const pointLayouts = getPointLayouts(points, mapRef.current);

    pointLayouts.forEach(({ point, offset }) => {
      const selectedPoint = selectedById?.get(point.id);
      const isExploded = selectedPoint && selectedPoint.texts && selectedPoint.texts.length > 1;

      if (isExploded && selectedPoint?.texts) {
        const textsList = selectedPoint.texts;
        const centerContainer = document.createElement('div');
        centerContainer.style.width = '34px';
        centerContainer.style.height = '34px';

        const centerElement = document.createElement('button');
        centerElement.className = 'map-marker exploded-center';
        centerElement.type = 'button';
        centerElement.textContent = '';
        centerContainer.appendChild(centerElement);

        const centerMarker = new maplibregl.Marker({ element: centerContainer })
          .setOffset(offset)
          .setLngLat([point.lng, point.lat])
          .addTo(mapRef.current!);
        newMarkers.push(centerMarker);

        const textRadiusPx = getClusterRadiusPx(textsList.length, TEXT_MARKER_SIZE_PX, TEXT_MARKER_GAP_PX);
        textsList.forEach((text, i) => {
          const textOffset = getCircleOffset(i, textsList.length, textRadiusPx);

          const subContainer = document.createElement('div');
          subContainer.style.width = '30px';
          subContainer.style.height = '30px';

          const subElement = document.createElement('button');
          const isSubSelected = selectedTextId ? selectedTextId === text.id : i === 0;
          subElement.className = isSubSelected ? 'map-marker sub-marker selected' : 'map-marker sub-marker';
          subElement.type = 'button';
          subElement.setAttribute('aria-label', `${point.title_pt} - ${text.author?.name}`);
          subElement.textContent = text.author?.name?.slice(0, 1) ?? String(i + 1);

          subElement.addEventListener('click', (e) => {
            e.stopPropagation();
            if (onSelectText) {
              onSelectText(point, text.id);
            } else {
              onSelect(point);
            }
          });

          subContainer.appendChild(subElement);

          const subMarker = new maplibregl.Marker({ element: subContainer })
            .setOffset([offset[0] + textOffset[0], offset[1] + textOffset[1]])
            .setLngLat([point.lng, point.lat])
            .addTo(mapRef.current!);
          newMarkers.push(subMarker);
        });

      } else {
        // Render normal marker (possibly with multiple citations badge)
        const container = document.createElement('div');
        container.style.width = '34px';
        container.style.height = '34px';

        const element = document.createElement('button');
        element.className = selected?.id === point.id ? 'map-marker selected' : 'map-marker';
        element.type = 'button';
        element.setAttribute('aria-label', point.title_pt);
        element.textContent = point.author?.name?.slice(0, 1) ?? 'L';

        element.addEventListener('click', () => onSelect(point));
        container.appendChild(element);

        // If the point has multiple texts, show a badge with count
        if (point.texts_count && point.texts_count > 1) {
          const badge = document.createElement('span');
          badge.className = 'map-marker-badge';
          badge.textContent = String(point.texts_count);
          container.appendChild(badge);
        }

        const marker = new maplibregl.Marker({ element: container })
          .setOffset(offset)
          .setLngLat([point.lng, point.lat])
          .addTo(mapRef.current!);
        newMarkers.push(marker);
      }
    });

    markersRef.current = newMarkers;
  }, [onSelect, onSelectText, points, selectedById, selectedTextId, viewportVersion]);

  return <div className="map-canvas" ref={containerRef} />;
}
