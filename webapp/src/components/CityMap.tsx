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

interface ProjectedPoint {
  point: Point;
  x: number;
  y: number;
}

interface PointCluster {
  points: Point[];
  lng: number;
  lat: number;
}

const POINT_CLUSTER_RADIUS_PX = 42;
const POINT_CLUSTER_MAX_ZOOM = 13.5;
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

function getPointClusters(points: Point[], map: maplibregl.Map): PointCluster[] {
  if (map.getZoom() >= POINT_CLUSTER_MAX_ZOOM) {
    return points.map((point) => ({
      points: [point],
      lng: point.lng,
      lat: point.lat
    }));
  }

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
        return distance < POINT_CLUSTER_RADIUS_PX;
      })
    );

    if (cluster) {
      cluster.push(projectedPoint);
    } else {
      clusters.push([projectedPoint]);
    }
  });

  return clusters.map((cluster) => ({
    points: cluster.map((item) => item.point),
    lng: cluster.reduce((total, item) => total + item.point.lng / cluster.length, 0),
    lat: cluster.reduce((total, item) => total + item.point.lat / cluster.length, 0)
  }));
}

export function CityMap({ points, selected, onSelect, selectedTextId, onSelectText }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const lastFocusedPointIdRef = useRef<string | null>(null);
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
    const map = mapRef.current;
    if (!map || !selected || lastFocusedPointIdRef.current === selected.id) return;

    lastFocusedPointIdRef.current = selected.id;
    map.flyTo({
      center: [selected.lng, selected.lat],
      zoom: Math.max(map.getZoom(), 15),
      duration: 650,
      essential: true
    });
  }, [selected]);

  function openCluster(cluster: PointCluster) {
    const map = mapRef.current;
    if (!map) return;

    const bounds = cluster.points.reduce(
      (nextBounds, point) => nextBounds.extend([point.lng, point.lat]),
      new maplibregl.LngLatBounds()
    );
    const hasCoordinateSpread = cluster.points.some(
      (point) => Math.abs(point.lng - cluster.lng) > 0.00001 || Math.abs(point.lat - cluster.lat) > 0.00001
    );

    if (hasCoordinateSpread && map.getZoom() < 16) {
      map.fitBounds(bounds, { padding: 88, maxZoom: 16, duration: 450 });
      return;
    }

    onSelect(cluster.points[0]);
  }

  useEffect(() => {
    if (!mapRef.current) return;
    markersRef.current.forEach((marker) => marker.remove());

    const newMarkers: maplibregl.Marker[] = [];
    const pointClusters = getPointClusters(points, mapRef.current);

    pointClusters.forEach((cluster) => {
      if (cluster.points.length > 1) {
        const hasSelectedPoint = cluster.points.some((point) => selected?.id === point.id);
        const container = document.createElement('div');
        container.style.width = '42px';
        container.style.height = '42px';

        const element = document.createElement('button');
        element.className = hasSelectedPoint ? 'map-marker cluster-marker selected' : 'map-marker cluster-marker';
        element.type = 'button';
        element.setAttribute('aria-label', `${cluster.points.length} pontos próximos`);
        element.textContent = String(cluster.points.length);
        element.addEventListener('click', () => openCluster(cluster));
        container.appendChild(element);

        const marker = new maplibregl.Marker({ element: container })
          .setLngLat([cluster.lng, cluster.lat])
          .addTo(mapRef.current!);
        newMarkers.push(marker);
        return;
      }

      const point = cluster.points[0];
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
            .setOffset(textOffset)
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
          .setLngLat([point.lng, point.lat])
          .addTo(mapRef.current!);
        newMarkers.push(marker);
      }
    });

    markersRef.current = newMarkers;
  }, [onSelect, onSelectText, points, selectedById, selectedTextId, viewportVersion]);

  return <div className="map-canvas" ref={containerRef} />;
}
