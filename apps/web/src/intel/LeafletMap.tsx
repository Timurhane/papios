import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import type { MapCompany } from '@/data/types';
import { markerColor } from './map-colors';

export interface LeafletMapProps {
  companies: MapCompany[];
  home: { lat: number; lng: number };
  /** Visit order (ids), drawn as a line from home. */
  route: string[];
  onToggle: (id: string) => void;
}

/** OpenStreetMap tiles (usage policy: attribution, light use, no bulk download; K-3.11). */
export function LeafletMap({ companies, home, route, onToggle }: LeafletMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current).setView([home.lat, home.lng], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> katkıcıları',
    }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, [home.lat, home.lng]);

  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    L.circleMarker([home.lat, home.lng], { radius: 6, color: '#111827', fillOpacity: 1 })
      .bindTooltip('Başlangıç')
      .addTo(g);
    for (const c of companies) {
      const color = markerColor(c);
      L.circleMarker([c.lat, c.lng], {
        radius: route.includes(c.id) ? 10 : 7,
        color,
        fillColor: color,
        fillOpacity: 0.8,
        weight: route.includes(c.id) ? 3 : 1,
      })
        .bindTooltip(`${c.name} · ${c.score ?? '—'}`)
        .on('click', () => onToggle(c.id))
        .addTo(g);
    }
    const byId = new Map(companies.map((c) => [c.id, c]));
    const points = route
      .map((id) => byId.get(id))
      .filter((c): c is MapCompany => !!c)
      .map((c) => [c.lat, c.lng] as [number, number]);
    if (points.length)
      L.polyline([[home.lat, home.lng], ...points], { color: '#7c3aed', weight: 3 }).addTo(g);
  }, [companies, home.lat, home.lng, route, onToggle]);

  return <div ref={el} className="h-[28rem] w-full rounded-2xl" aria-label="Harita" />;
}
