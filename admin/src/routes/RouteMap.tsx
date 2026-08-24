import type { AdminRouteSegment, RouteLeg } from '@ecosdelisboa/shared';
import maplibregl, { type Map as MapLibreMap, type Marker } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import {
  ADMIN_DEFAULT_LAT,
  ADMIN_DEFAULT_LNG,
  ADMIN_MAP_STYLE_URL
} from '../adminConfig';

export function RouteMap({
  segments,
  legs,
  waypointDrafts,
  selectedSegmentId,
  addingWaypoint,
  onSelectSegment,
  onAddWaypoint
}: {
  segments: AdminRouteSegment[];
  legs: RouteLeg[];
  waypointDrafts: { position: number; waypoints: { lat: number; lng: number }[] }[];
  selectedSegmentId?: string;
  addingWaypoint: boolean;
  onSelectSegment: (segmentId: string) => void;
  onAddWaypoint: (waypoint: { lat: number; lng: number }) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const addWaypointRef = useRef(onAddWaypoint);
  const waypointModeRef = useRef(addingWaypoint);

  useEffect(() => {
    addWaypointRef.current = onAddWaypoint;
    waypointModeRef.current = addingWaypoint;
    if (mapRef.current) {
      mapRef.current.getCanvas().style.cursor = addingWaypoint ? 'crosshair' : '';
    }
  }, [addingWaypoint, onAddWaypoint]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: ADMIN_MAP_STYLE_URL,
      center: [ADMIN_DEFAULT_LNG, ADMIN_DEFAULT_LAT],
      zoom: 13
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('click', (event) => {
      if (!waypointModeRef.current) return;
      addWaypointRef.current({ lat: event.lngLat.lat, lng: event.lngLat.lng });
    });
    mapRef.current = map;
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const render = () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      const textSegments = segments.filter(
        (segment) => segment.kind === 'text' && segment.text?.point
      );
      const bounds = new maplibregl.LngLatBounds();
      textSegments.forEach((segment, index) => {
        const point = segment.text!.point!;
        const element = document.createElement('button');
        element.type = 'button';
        element.className = `route-map-marker${segment.id === selectedSegmentId ? ' selected' : ''}`;
        element.textContent = String(index + 1);
        element.title = `${segment.text?.author?.name ?? 'Texto'} — ${point.title_pt}`;
        element.addEventListener('click', (event) => {
          event.stopPropagation();
          if (segment.id) onSelectSegment(segment.id);
        });
        markersRef.current.push(
          new maplibregl.Marker({ element }).setLngLat([point.lng, point.lat]).addTo(map)
        );
        bounds.extend([point.lng, point.lat]);
      });

      const featureCollection = {
        type: 'FeatureCollection' as const,
        features: legs.map((leg) => ({
          type: 'Feature' as const,
          properties: { position: leg.position },
          geometry: leg.geometry
        }))
      };
      const existingSource = map.getSource('route-legs') as maplibregl.GeoJSONSource | undefined;
      if (existingSource) {
        existingSource.setData(featureCollection);
      } else {
        map.addSource('route-legs', { type: 'geojson', data: featureCollection });
        map.addLayer({
          id: 'route-legs-line',
          type: 'line',
          source: 'route-legs',
          paint: {
            'line-color': '#b44c2f',
            'line-width': 5,
            'line-opacity': 0.9
          }
        });
      }
      for (const leg of waypointDrafts) {
        for (const waypoint of leg.waypoints) {
          const waypointElement = document.createElement('span');
          waypointElement.className = 'route-waypoint-marker';
          waypointElement.title = `Waypoint da perna ${leg.position + 1}`;
          markersRef.current.push(
            new maplibregl.Marker({ element: waypointElement })
              .setLngLat([waypoint.lng, waypoint.lat])
              .addTo(map)
          );
          bounds.extend([waypoint.lng, waypoint.lat]);
        }
      }
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 56, maxZoom: 16, duration: 350 });
    };
    if (map.loaded()) render();
    else map.once('load', render);
  }, [legs, onSelectSegment, segments, selectedSegmentId, waypointDrafts]);

  return (
    <div className={`route-map${addingWaypoint ? ' waypoint-mode' : ''}`} ref={containerRef}>
      {addingWaypoint ? <div className="route-map-hint">Clique no mapa para fixar o waypoint</div> : null}
    </div>
  );
}
