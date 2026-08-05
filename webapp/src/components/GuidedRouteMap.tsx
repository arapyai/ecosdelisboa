import type { PublicRoute, RouteSession } from '@ecosdelisboa/shared';
import maplibregl, { type Map as MapLibreMap, type Marker } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { cityConfig } from '../config/city';
import { activeDestination, activeLeg, type VisitorLocation } from '../routeSession';

interface Props {
  route: PublicRoute;
  session: RouteSession;
  location: VisitorLocation | null;
}

export function GuidedRouteMap({ route, session, location }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const destinationMarkerRef = useRef<Marker | null>(null);
  const visitorMarkerRef = useRef<Marker | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({ container: containerRef.current, style: cityConfig.map.styleUrl, center: cityConfig.map.center, zoom: 15 });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    mapRef.current = map;
    return () => {
      destinationMarkerRef.current?.remove();
      visitorMarkerRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const draw = () => {
      const destination = activeDestination(route, session);
      const leg = activeLeg(route, session);
      const data = {
        type: 'FeatureCollection' as const,
        features: leg ? [{ type: 'Feature' as const, properties: {}, geometry: leg.geometry }] : []
      };
      const source = map.getSource('active-route-leg') as maplibregl.GeoJSONSource | undefined;
      if (source) source.setData(data);
      else {
        map.addSource('active-route-leg', { type: 'geojson', data });
        map.addLayer({ id: 'active-route-leg-line', type: 'line', source: 'active-route-leg', paint: { 'line-color': '#c45732', 'line-width': 6, 'line-opacity': 0.92 } });
      }
      destinationMarkerRef.current?.remove();
      if (destination) {
        const element = document.createElement('span');
        element.className = 'visitor-route-marker destination';
        element.textContent = String(session.phase === 'walking' ? session.active_text_index + 2 : session.active_text_index + 1);
        destinationMarkerRef.current = new maplibregl.Marker({ element }).setLngLat([destination.text.point.lng, destination.text.point.lat]).addTo(map);
      }
      const bounds = new maplibregl.LngLatBounds();
      leg?.geometry.coordinates.forEach((coordinate) => bounds.extend(coordinate));
      if (location) bounds.extend([location.lng, location.lat]);
      if (destination) bounds.extend([destination.text.point.lng, destination.text.point.lat]);
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 72, maxZoom: 17, duration: 350 });
    };
    if (map.loaded()) draw();
    else map.once('load', draw);
  }, [location, route, session]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !location) return;
    if (!visitorMarkerRef.current) {
      const element = document.createElement('span');
      element.className = 'visitor-location-marker';
      element.setAttribute('aria-label', 'Sua localização');
      visitorMarkerRef.current = new maplibregl.Marker({ element }).setLngLat([location.lng, location.lat]).addTo(map);
    } else visitorMarkerRef.current.setLngLat([location.lng, location.lat]);
  }, [location]);

  return <div ref={containerRef} className="guided-route-map" aria-label="Navegação do percurso" />;
}
