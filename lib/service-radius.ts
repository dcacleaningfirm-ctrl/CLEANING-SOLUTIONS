// Straight-line distance from the business's service center. Booking decisions
// use the geocoded service address; an IP location is only useful for deciding
// which visitors see the public marketing pages.
export const SERVICE_RADIUS_MILES = 45;
export const DEFAULT_SERVICE_CENTER = { latitude: 33.749, longitude: -84.388 }; // Atlanta

export function serviceCenterFrom(value: string | undefined | null) {
  const coordinates = String(value || "").split(",").map(Number);
  if (coordinates.length === 2 && Number.isFinite(coordinates[0]) && Number.isFinite(coordinates[1]) &&
      Math.abs(coordinates[0]) <= 90 && Math.abs(coordinates[1]) <= 180) {
    return { latitude: coordinates[0], longitude: coordinates[1] };
  }
  return DEFAULT_SERVICE_CENTER;
}

export function milesBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function withinServiceRadius(place: { latitude: number; longitude: number }, center = DEFAULT_SERVICE_CENTER) {
  return Number.isFinite(place.latitude) && Number.isFinite(place.longitude) &&
    milesBetween(place, center) <= SERVICE_RADIUS_MILES;
}
