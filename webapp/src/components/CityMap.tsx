import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { cityConfig } from '../config/city';
import type { Point } from '../types';

interface Props {
  points: Point[];
  selected?: Point | null;
  onSelect: (point: Point) => void;
}

export function CityMap({ points, selected, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

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
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = points.map((point) => {
      const element = document.createElement('button');
      element.className = selected?.id === point.id ? 'map-marker selected' : 'map-marker';
      element.type = 'button';
      element.setAttribute('aria-label', point.title_pt);
      element.textContent = point.author?.name?.slice(0, 1) ?? 'L';
      element.addEventListener('click', () => onSelect(point));

      return new maplibregl.Marker({ element }).setLngLat([point.lng, point.lat]).addTo(mapRef.current!);
    });
  }, [onSelect, points, selected?.id]);

  return <div className="map-canvas" ref={containerRef} />;
}
