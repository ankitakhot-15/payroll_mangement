import React, { useState } from 'react';
import { Building2, MapPin, CheckCircle2 } from 'lucide-react';

interface WorkspaceOnboardingProps {
  userEmail: string;
  onCreateWorkspace: (
    companyName: string,
    companyCode: string,
    latitude: number,
    longitude: number
  ) => Promise<void>;
}

export const WorkspaceOnboarding: React.FC<WorkspaceOnboardingProps> = ({
  userEmail,
  onCreateWorkspace,
}) => {
  const [companyName, setCompanyName] = useState('NexusTech Solutions Pvt Ltd');
  const [companyCode, setCompanyCode] = useState('NXTS');
  const [latitude, setLatitude] = useState('19.0760');
  const [longitude, setLongitude] = useState('72.8777');
  const [gpsStatus, setGpsStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleUseCurrentGps = () => {
    if (!navigator.geolocation) {
      setGpsStatus('Geolocation is not supported in this browser.');
      return;
    }
    setGpsStatus('Detecting current coordinates...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude.toFixed(6));
        setLongitude(pos.coords.longitude.toFixed(6));
        setGpsStatus(`Detected (±${Math.round(pos.coords.accuracy)}m)`);
      },
      () => {
        setGpsStatus('Location permission denied. Using default Mumbai coordinates.');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (companyName.trim().length < 2 || companyCode.trim().length < 2) {
      setError('Company name and code must be at least 2 characters.');
      return;
    }
    setBusy(true);
    try {
      await onCreateWorkspace(
        companyName.trim(),
        companyCode.trim().toUpperCase(),
        Number(latitude) || 19.076,
        Number(longitude) || 72.8777
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize workspace.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-6">
      <div className="max-w-lg w-full bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
        <div className="flex items-start gap-3">
          <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-lg shrink-0">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Initialize Organization Workspace</h1>
            <p className="text-sm text-slate-600 mt-1">
              Signed in as {userEmail}. Set up your primary company profile, shifts, and office geofence in Firestore.
            </p>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Company Name</label>
              <input
                type="text"
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Code</label>
              <input
                type="text"
                required
                maxLength={16}
                value={companyCode}
                onChange={(e) => setCompanyCode(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-700">Head Office Geofence Coordinates</span>
              <button
                type="button"
                onClick={handleUseCurrentGps}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700"
              >
                <MapPin className="w-3.5 h-3.5" />
                Use My Current GPS
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Latitude</label>
                <input
                  type="number"
                  step="any"
                  value={latitude}
                  onChange={(e) => setLatitude(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Longitude</label>
                <input
                  type="number"
                  step="any"
                  value={longitude}
                  onChange={(e) => setLongitude(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg"
                />
              </div>
            </div>
            {gpsStatus && <p className="text-xs text-slate-600">{gpsStatus}</p>}
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            <CheckCircle2 className="w-4 h-4" />
            {busy ? 'Creating Firestore Workspace...' : 'Create Company Workspace'}
          </button>
        </form>
      </div>
    </div>
  );
};
