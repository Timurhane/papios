/** K-10.7 visit route: nearest-neighbour ordering from a start point (good enough for a day's visits). */
export interface GeoPoint {
  lat: number;
  lng: number;
}

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function planRoute<T extends GeoPoint>(
  start: GeoPoint,
  stops: T[],
): { order: T[]; km: number } {
  const left = [...stops];
  const order: T[] = [];
  let at: GeoPoint = start;
  let km = 0;
  while (left.length) {
    let best = 0;
    for (let i = 1; i < left.length; i++)
      if (haversineKm(at, left[i] as T) < haversineKm(at, left[best] as T)) best = i;
    const next = left.splice(best, 1)[0] as T;
    km += haversineKm(at, next);
    order.push(next);
    at = next;
  }
  return { order, km: Math.round(km * 10) / 10 };
}
