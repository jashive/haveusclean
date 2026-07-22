import React, { useState, useEffect } from 'react';

// Haversine formula to calculate distance in meters between two lat/lng points
function getDistanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

export default function CrewJobView({ job }) {
  const [jobStatus, setJobStatus] = useState(job?.status || 'scheduled');
  const [isWithinGeofence, setIsWithinGeofence] = useState(false);
  const [currentDistance, setCurrentDistance] = useState(null);
  const [geoError, setGeoError] = useState(null);

  // Default target coordinates (e.g. Toronto / job site lat/lng)
  const targetLat = job?.lat || 43.6532;
  const targetLng = job?.lng || -79.3832;
  const MAX_RADIUS_METERS = 150; // Cleaner must be within 150m to clock in

  // Track Cleaner Location
  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported by your browser.');
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const dist = getDistanceInMeters(latitude, longitude, targetLat, targetLng);
        setCurrentDistance(Math.round(dist));
        setIsWithinGeofence(dist <= MAX_RADIUS_METERS);
        setGeoError(null);
      },
      (err) => {
        setGeoError('GPS Location Access Denied. Please enable location.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [targetLat, targetLng]);

  return (
    <div className="max-w-md mx-auto bg-slate-900 text-white min-h-screen p-4 flex flex-col justify-between">
      <div>
        {/* Job Header */}
        <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-800">
          <div>
            <span className="text-xs uppercase tracking-wide text-cyan-400 font-semibold">Today's Job</span>
            <h1 className="text-xl font-bold">{job?.client_name || 'Sarah M. — 2BR Condo'}</h1>
            <p className="text-xs text-slate-400">{job?.service_address || '123 King St W, Toronto'}</p>
          </div>
        </div>

        {/* Geofence Status Indicator */}
        <div className="mb-4 p-3 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className={`w-3 h-3 rounded-full ${isWithinGeofence ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
            <span className="text-xs font-semibold">
              {isWithinGeofence ? 'At Job Site (Geofence Verified)' : 'Outside Geofence Zone'}
            </span>
          </div>
          {currentDistance !== null && (
            <span className="text-xs text-slate-400">{currentDistance}m away</span>
          )}
        </div>

        {geoError && (
          <div className="mb-4 p-2.5 bg-red-900/40 border border-red-700 text-red-300 text-xs rounded-lg">
            ⚠️ {geoError}
          </div>
        )}

        {/* Clock In Button (Gated by Geofence) */}
        {jobStatus === 'scheduled' && (
          <button
            onClick={() => setJobStatus('in_progress')}
            disabled={!isWithinGeofence}
            className={`w-full py-3.5 font-bold rounded-xl shadow-lg transition-all ${
              isWithinGeofence
                ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 cursor-pointer'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
            }`}
          >
            {isWithinGeofence ? '▶️ Clock In & Start Clean' : `Arrive within ${MAX_RADIUS_METERS}m to Clock In`}
          </button>
        )}
      </div>
    </div>
  );
}
