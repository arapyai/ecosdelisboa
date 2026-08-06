import { routeSegments, type PublicRoute } from '@ecosdelisboa/shared';
import maplibregl, { type Map as MapLibreMap, type Marker } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { cityConfig } from '../config/city';

export function RouteDiscoveryMap({ route }: { route: PublicRoute | null }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: cityConfig.map.styleUrl,
      center: cityConfig.map.center,
      zoom: cityConfig.map.zoom
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    let initialized = false;
    const stopInitializing = () => {
      map.off('load', tryInitialize);
      map.off('styledata', tryInitialize);
      map.off('idle', tryInitialize);
    };
    const tryInitialize = () => {
      if (initialized) return;
      try {
        if (!map.getSource('discovery-route')) {
          map.addSource('discovery-route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          map.addLayer({
            id: 'discovery-route-line',
            type: 'line',
            source: 'discovery-route',
            paint: { 'line-color': '#c45732', 'line-width': 5, 'line-opacity': 0.9 }
          });
        }
        initialized = true;
        stopInitializing();
        setMapReady(true);
      } catch {
        // MapLibre can emit styledata before sources may safely be added.
      }
    };
    map.on('load', tryInitialize);
    map.on('styledata', tryInitialize);
    map.on('idle', tryInitialize);
    tryInitialize();
    mapRef.current = map;
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      stopInitializing();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !route || !mapReady) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];
    const bounds = new maplibregl.LngLatBounds();
    const textSegments = routeSegments(route).filter((segment) => segment.kind === 'text');
    textSegments.forEach((segment, index) => {
      const point = segment.text.point;
      const element = document.createElement('span');
      element.className = 'visitor-route-marker';
      element.textContent = String(index + 1);
      element.title = `${segment.text.author.name} — ${point.title_pt}`;
      markersRef.current.push(
        new maplibregl.Marker({ element }).setLngLat([point.lng, point.lat]).addTo(map)
      );
      bounds.extend([point.lng, point.lat]);
    });
    const data = {
      type: 'FeatureCollection' as const,
      features: (route.legs ?? []).map((leg) => ({
        type: 'Feature' as const,
        properties: {},
        geometry: leg.geometry
      }))
    };
    const source = map.getSource('discovery-route') as maplibregl.GeoJSONSource | undefined;
    source?.setData(data);
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 54, maxZoom: 15, duration: 400 });
    if (containerRef.current) {
      containerRef.current.dataset.renderedRouteId = route.id;
      containerRef.current.dataset.renderedLegCount = String(route.legs?.length ?? 0);
    }
  }, [mapReady, route]);

  return <div className="route-discovery-map" ref={containerRef} aria-label="Mapa do percurso" />;
}
