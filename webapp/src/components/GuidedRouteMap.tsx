import type { PublicRoute, RouteSession } from '@ecosdelisboa/shared';
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap, type Marker } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { cityConfig } from '../config/city';
import {
  activeDestination,
  activeLeg,
  completedLegPositions,
  textSegments,
  type VisitorLocation
} from '../routeSession';

interface Props {
  route: PublicRoute;
  session: RouteSession;
  location: VisitorLocation | null;
  followMode: boolean;
  recenterSignal: number;
  onFollowModeChange: (following: boolean) => void;
  onTextSelect: (index: number) => void;
}

const emptyCollection = () => ({ type: 'FeatureCollection' as const, features: [] });

export function GuidedRouteMap({
  route,
  session,
  location,
  followMode,
  recenterSignal,
  onFollowModeChange,
  onTextSelect
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const visitorMarkerRef = useRef<Marker | null>(null);
  const followModeRef = useRef(followMode);

  useEffect(() => {
    followModeRef.current = followMode;
  }, [followMode]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: cityConfig.map.styleUrl,
      center: cityConfig.map.center,
      zoom: 15
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    const stopFollowing = () => {
      if (followModeRef.current) onFollowModeChange(false);
    };
    map.on('dragstart', stopFollowing);
    mapRef.current = map;
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      visitorMarkerRef.current?.remove();
      map.off('dragstart', stopFollowing);
      map.remove();
      mapRef.current = null;
    };
  }, [onFollowModeChange]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const draw = () => {
      const legs = route.legs ?? [];
      const completed = new Set(completedLegPositions(route, session));
      setLineData(map, 'route-overview', {
        type: 'FeatureCollection',
        features: legs.map((leg) => ({
          type: 'Feature' as const,
          properties: { position: leg.position },
          geometry: leg.geometry
        }))
      }, { color: '#315b52', width: 4, opacity: 0.28 });
      setLineData(map, 'route-completed', {
        type: 'FeatureCollection',
        features: legs
          .filter((leg) => completed.has(leg.position))
          .map((leg) => ({
            type: 'Feature' as const,
            properties: { position: leg.position },
            geometry: leg.geometry
          }))
      }, { color: '#315b52', width: 5, opacity: 0.5, dasharray: [1.2, 1.2] });
      const leg = activeLeg(route, session);
      setLineData(map, 'route-active', leg ? {
        type: 'FeatureCollection',
        features: [{ type: 'Feature' as const, properties: {}, geometry: leg.geometry }]
      } : emptyCollection(), { color: '#c45732', width: 7, opacity: 0.96 });

      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      const texts = textSegments(route);
      texts.forEach((segment, index) => {
        const completedText = index < session.active_text_index;
        const currentText = index === session.active_text_index;
        const destinationIndex = session.phase === 'walking'
          ? session.active_text_index + 1
          : session.active_text_index;
        const destinationText = index === destinationIndex;
        const canInspect = session.phase === 'completed'
          || completedText
          || (currentText && session.phase !== 'going_to_first_text' && session.phase !== 'walking');
        const element = document.createElement('button');
        element.type = 'button';
        element.className = [
          'visitor-route-marker',
          completedText ? 'completed' : '',
          currentText ? 'current' : '',
          destinationText ? 'destination' : '',
          canInspect ? 'inspectable' : ''
        ].filter(Boolean).join(' ');
        element.textContent = String(index + 1);
        element.title = `${segment.text.author.name} — ${segment.text.point.title_pt}`;
        element.setAttribute('aria-label', element.title);
        element.disabled = !canInspect;
        if (canInspect) element.addEventListener('click', () => onTextSelect(index));
        markersRef.current.push(
          new maplibregl.Marker({ element })
            .setLngLat([segment.text.point.lng, segment.text.point.lat])
            .addTo(map)
        );
      });
      if (!visitorMarkerRef.current) fitActiveContext(map, route, session, null);
    };
    if (map.loaded()) draw();
    else map.once('load', draw);
  }, [onTextSelect, route, session]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !location) return;
    if (!visitorMarkerRef.current) {
      const element = document.createElement('span');
      element.className = 'visitor-location-marker';
      element.setAttribute('aria-label', 'Sua localização');
      visitorMarkerRef.current = new maplibregl.Marker({ element })
        .setLngLat([location.lng, location.lat])
        .addTo(map);
    } else {
      visitorMarkerRef.current.setLngLat([location.lng, location.lat]);
    }
    if (followMode) followVisitor(map, location);
  }, [followMode, location]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || recenterSignal === 0) return;
    if (location) followVisitor(map, location);
    else fitActiveContext(map, route, session, null);
  }, [location, recenterSignal, route, session]);

  return <div ref={containerRef} className="guided-route-map" aria-label="Navegação do percurso" />;
}

function setLineData(
  map: MapLibreMap,
  id: string,
  data: GeoJSON.FeatureCollection<GeoJSON.LineString>,
  paint: { color: string; width: number; opacity: number; dasharray?: number[] }
) {
  const source = map.getSource(id) as GeoJSONSource | undefined;
  if (source) {
    source.setData(data);
    return;
  }
  map.addSource(id, { type: 'geojson', data });
  map.addLayer({
    id: `${id}-line`,
    type: 'line',
    source: id,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': paint.color,
      'line-width': paint.width,
      'line-opacity': paint.opacity,
      ...(paint.dasharray ? { 'line-dasharray': paint.dasharray } : {})
    }
  });
}

function followVisitor(map: MapLibreMap, location: VisitorLocation) {
  map.easeTo({
    center: [location.lng, location.lat],
    zoom: Math.max(map.getZoom(), 17),
    offset: [0, 105],
    duration: 350
  });
}

function fitActiveContext(
  map: MapLibreMap,
  route: PublicRoute,
  session: RouteSession,
  location: VisitorLocation | null
) {
  const bounds = new maplibregl.LngLatBounds();
  const destination = activeDestination(route, session);
  const leg = activeLeg(route, session);
  leg?.geometry.coordinates.forEach((coordinate) => bounds.extend(coordinate));
  if (location) bounds.extend([location.lng, location.lat]);
  if (destination) bounds.extend([destination.text.point.lng, destination.text.point.lat]);
  if (bounds.isEmpty()) {
    (route.legs ?? []).forEach((routeLeg) => {
      routeLeg.geometry.coordinates.forEach((coordinate) => bounds.extend(coordinate));
    });
  }
  if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 72, maxZoom: 17, duration: 350 });
}
