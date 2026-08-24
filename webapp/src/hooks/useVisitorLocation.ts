import { useEffect, useState } from 'react';
import { cityConfig } from '../config/city';
import {
  distanceMeters,
  isLocationInPortugal,
  LOCATION_QUERY_MOVE_THRESHOLD_M,
  type LocationStatus,
  type VisitorLocation
} from '../lib/proximity';

const lisbonLocation: VisitorLocation = {
  lat: cityConfig.api.defaultLat,
  lng: cityConfig.api.defaultLng,
  accuracy: 0
};

export function useVisitorLocation() {
  const [currentLocation, setCurrentLocation] = useState<VisitorLocation | null>(null);
  const [searchLocation, setSearchLocation] = useState<VisitorLocation>(lisbonLocation);
  const [status, setStatus] = useState<LocationStatus>('locating');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setStatus('unavailable');
      return;
    }

    setStatus('locating');
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const nextLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy
        };
        if (!isLocationInPortugal(nextLocation)) {
          setCurrentLocation(null);
          setSearchLocation(lisbonLocation);
          setStatus('outside_portugal');
          return;
        }

        setCurrentLocation(nextLocation);
        setSearchLocation((current) =>
          current.accuracy === 0 || distanceMeters(current, nextLocation) >= LOCATION_QUERY_MOVE_THRESHOLD_M
            ? nextLocation
            : current
        );
        setStatus('available');
      },
      (error) => {
        setCurrentLocation(null);
        setSearchLocation(lisbonLocation);
        setStatus(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable');
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 12_000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [retryKey]);

  return {
    currentLocation,
    searchLocation,
    status,
    retry: () => setRetryKey((current) => current + 1)
  };
}
