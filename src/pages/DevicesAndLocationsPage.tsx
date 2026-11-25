import React, { useState } from 'react';
import QRCode from 'qrcode';
import { Fingerprint, MapPin, QrCode, RefreshCw, Plus } from 'lucide-react';
import { AttendanceDevice, Company, Employee, OfficeLocation } from '../types/payroll';
import { backendApi } from '../services/api';
import {
  createDocStrict,
  createImmutableEvent,
  logAuditEvent,
  makeId,
  updateDocStrict,
} from '../services/firestoreService';
import { todayIsoDate } from '../utils/exports';

interface DevicesAndLocationsPageProps {
  company: Company;
  currentEmployee: Employee;
  employees: Employee[];
  devices: AttendanceDevice[];
  locations: OfficeLocation[];
}

export const DevicesAndLocationsPage: React.FC<DevicesAndLocationsPageProps> = ({
  company,
  currentEmployee,
  employees,
  devices,
  locations,
}) => {
  const [deviceName, setDeviceName] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [ipAddress, setIpAddress] = useState('192.168.1.201');
  const [protocol, setProtocol] = useState('ZKTeco Push / REST Adapter');

  const [locName, setLocName] = useState('');
  const [locAddress, setLocAddress] = useState('');
  const [locLat, setLocLat] = useState('19.0760');
  const [locLng, setLocLng] = useState('72.8777');
  const [locRadius, setLocRadius] = useState('300');

  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [punchBatchText, setPunchBatchText] = useState(
    `1001,${todayIsoDate()}T09:28:00.000Z,check_in\n1001,${todayIsoDate()}T18:35:00.000Z,check_out`
  );
  const [syncLog, setSyncLog] = useState<string>('');

  const [qrImage, setQrImage] = useState<string>('');
  const [qrPayload, setQrPayload] = useState<string>('');
  const [qrLocationId, setQrLocationId] = useState(locations[0]?.locationId || 'LOC_HQ_01');
  const [busy, setBusy] = useState(false);

  const handleAddDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceName.trim() || !serialNumber.trim()) return;
    setBusy(true);
    try {
      const deviceId = makeId('DEV');
      await createDocStrict('attendanceDevices', deviceId, {
        deviceId,
        companyId: company.companyId,
        companyOwnerUid: currentEmployee.companyOwnerUid,
        deviceName: deviceName.trim(),
        serialNumber: serialNumber.trim(),
        locationName: locations[0]?.name || 'Head Office',
        ipAddress: ipAddress.trim(),
        protocol,
        connectionStatus: 'online',
        lastSyncAt: new Date().toISOString(),
      });
      setDeviceName('');
      setSerialNumber('');
    } finally {
      setBusy(false);
    }
  };

  const handleSyncDevice = async () => {
    const dev = devices.find((d) => d.deviceId === (selectedDeviceId || devices[0]?.deviceId));
    if (!dev) {
      setSyncLog('Add a biometric device first.');
      return;
    }
    setBusy(true);
    try {
      const lines = punchBatchText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const events = lines.map((line) => {
        const [deviceEmployeeCode, timestamp, punchType] = line.split(',').map((s) => s.trim());
        return {
          deviceEmployeeCode,
          timestamp,
          punchType: (punchType || 'check_in') as 'check_in' | 'check_out' | 'break_start' | 'break_end',
        };
      });

      const employeeMap: Record<string, { employeeId: string; employeeUid: string; employeeName: string }> = {};
      employees.forEach((emp) => {
        if (emp.deviceEmployeeCode) {
          employeeMap[emp.deviceEmployeeCode] = {
            employeeId: emp.employeeId,
            employeeUid: emp.employeeUid || emp.companyOwnerUid,
            employeeName: emp.fullName,
          };
        }
      });

      const res = await backendApi.syncBiometricDevice(dev.deviceId, {
        protocol: dev.protocol,
        events,
        employeeMap,
      });

      for (const item of res.accepted) {
        const attId = `ATT_${item.employeeId}_${item.date.replace(/-/g, '')}`;
        await createDocStrict('attendance', attId, {
          attendanceId: attId,
          companyId: company.companyId,
          companyOwnerUid: currentEmployee.companyOwnerUid,
          employeeId: item.employeeId,
          employeeUid: item.employeeUid,
          employeeName: item.employeeName,
          date: item.date,
          attendanceMethod: 'fingerprint',
          attendanceStatus: item.punchType === 'check_out' ? 'checked_out' : 'present',
          faceVerification: 'not_required',
          livenessStatus: 'not_required',
          gpsStatus: 'not_required',
          approvalStatus: 'auto_approved',
          ...(item.punchType === 'check_in' ? { checkInAt: item.timestamp } : { checkOutAt: item.timestamp }),
        });

        const evtId = makeId('EVT');
        await createImmutableEvent('attendanceEvents', evtId, {
          eventId: evtId,
          companyId: company.companyId,
          companyOwnerUid: currentEmployee.companyOwnerUid,
          employeeId: item.employeeId,
          employeeUid: item.employeeUid,
          attendanceId: attId,
          eventType: 'device_punch',
          method: 'fingerprint',
        });
      }

      await updateDocStrict('attendanceDevices', dev.deviceId, {
        lastSyncAt: res.syncedAt,
        connectionStatus: 'online',
      });

      setSyncLog(
        `Synced ${res.acceptedCount}/${res.totalReceived} events (${res.failedCount} skipped/unmapped).`
      );
    } catch (err) {
      setSyncLog(err instanceof Error ? err.message : 'Device sync failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleAddLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!locName.trim()) return;
    setBusy(true);
    try {
      const locationId = makeId('LOC');
      await createDocStrict('officeLocations', locationId, {
        locationId,
        companyId: company.companyId,
        companyOwnerUid: currentEmployee.companyOwnerUid,
        name: locName.trim(),
        address: locAddress.trim(),
        latitude: Number(locLat),
        longitude: Number(locLng),
        radiusMeters: Number(locRadius) || 300,
        allowWfh: true,
      });
      await logAuditEvent({
        companyId: company.companyId,
        companyOwnerUid: currentEmployee.companyOwnerUid,
        actorUid: currentEmployee.employeeUid || currentEmployee.companyOwnerUid,
        actorName: currentEmployee.fullName,
        action: 'OFFICE_LOCATION_ADDED',
        targetCollection: 'officeLocations',
        targetId: locationId,
        summary: `Configured geofence ${locName} (${locRadius}m radius).`,
      });
      setLocName('');
      setLocAddress('');
    } finally {
      setBusy(false);
    }
  };

  const handleUseMyGps = () => {
    navigator.geolocation?.getCurrentPosition((pos) => {
      setLocLat(pos.coords.latitude.toFixed(6));
      setLocLng(pos.coords.longitude.toFixed(6));
    });
  };

  const handleGenerateQr = async () => {
    const loc = locations.find((l) => l.locationId === qrLocationId) || locations[0];
    if (!loc) return;
    setBusy(true);
    try {
      const res = await backendApi.generateQrToken({
        companyId: company.companyId,
        locationId: loc.locationId,
        locationName: loc.name,
      });
      const dataUrl = await QRCode.toDataURL(res.tokenPayload, { width: 220, margin: 1 });
      setQrImage(dataUrl);
      setQrPayload(res.tokenPayload);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Fingerprint Biometric Devices & Batch Event Sync */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Fingerprint className="w-5 h-5 text-indigo-600" />
            <h2 className="text-base font-semibold text-slate-900">Fingerprint Biometric Devices</h2>
          </div>

          <form onSubmit={handleAddDevice} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              required
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="Device Name (e.g. HQ Lobby Bio)"
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
            <input
              type="text"
              required
              value={serialNumber}
              onChange={(e) => setSerialNumber(e.target.value)}
              placeholder="Serial Number (e.g. ZK-88412)"
              className="px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
            />
            <input
              type="text"
              value={ipAddress}
              onChange={(e) => setIpAddress(e.target.value)}
              placeholder="Device IP Address"
              className="px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
            />
            <select
              value={protocol}
              onChange={(e) => setProtocol(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
            >
              <option value="ZKTeco Push / REST Adapter">ZKTeco Push / REST Adapter</option>
              <option value="eSSL BioTime Webhook">eSSL BioTime Webhook</option>
              <option value="Hikvision ISAPI Adapter">Hikvision ISAPI Adapter</option>
              <option value="CSV Batch Import">CSV Batch Import</option>
            </select>
            <button
              type="submit"
              disabled={busy}
              className="sm:col-span-2 inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800"
            >
              <Plus className="w-4 h-4" />
              Register Biometric Terminal
            </button>
          </form>

          <div className="divide-y divide-slate-100">
            {devices.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">No hardware terminals registered yet.</p>
            ) : (
              devices.map((dev) => (
                <div key={dev.deviceId} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{dev.deviceName}</p>
                    <p className="text-slate-500 font-mono truncate">
                      {dev.serialNumber} · {dev.ipAddress} · {dev.protocol}
                    </p>
                  </div>
                  <span className="font-semibold text-emerald-700 capitalize shrink-0">
                    {dev.connectionStatus}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-900">Device Punch Synchronization</h3>
            <button
              type="button"
              disabled={busy || devices.length === 0}
              onClick={handleSyncDevice}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Run Sync
            </button>
          </div>
          {devices.length > 0 && (
            <select
              value={selectedDeviceId || devices[0]?.deviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
            >
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.deviceName} ({d.serialNumber})
                </option>
              ))}
            </select>
          )}
          <div>
            <label className="block text-xs text-slate-500 mb-1">
              Device Punch Stream (deviceEmployeeCode, ISO Timestamp, punchType)
            </label>
            <textarea
              rows={4}
              value={punchBatchText}
              onChange={(e) => setPunchBatchText(e.target.value)}
              className="w-full p-3 text-xs font-mono border border-slate-200 rounded-lg"
            />
          </div>
          {syncLog && <p className="text-xs font-medium text-indigo-700">{syncLog}</p>}
        </div>
      </div>

      {/* Office Locations & Dynamic QR Kiosk */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-indigo-600" />
              <h3 className="text-base font-semibold text-slate-900">Office Branches &amp; Geofences</h3>
            </div>
            <button
              type="button"
              onClick={handleUseMyGps}
              className="text-xs font-semibold text-indigo-600 hover:underline whitespace-nowrap shrink-0"
            >
              Use Current GPS
            </button>
          </div>

          <form onSubmit={handleAddLocation} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              required
              value={locName}
              onChange={(e) => setLocName(e.target.value)}
              placeholder="Branch Name"
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
            <input
              type="text"
              value={locAddress}
              onChange={(e) => setLocAddress(e.target.value)}
              placeholder="Address"
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
            <input
              type="number"
              step="any"
              required
              value={locLat}
              onChange={(e) => setLocLat(e.target.value)}
              placeholder="Latitude"
              className="px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg"
            />
            <input
              type="number"
              step="any"
              required
              value={locLng}
              onChange={(e) => setLocLng(e.target.value)}
              placeholder="Longitude"
              className="px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg"
            />
            <input
              type="number"
              min={10}
              max={50000}
              required
              value={locRadius}
              onChange={(e) => setLocRadius(e.target.value)}
              placeholder="Radius (meters)"
              className="px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg"
            />
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
            >
              Add Branch Geofence
            </button>
          </form>

          <div className="divide-y divide-slate-100">
            {locations.map((loc) => (
              <div key={loc.locationId} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 truncate">{loc.name}</p>
                  <p className="text-slate-500 font-mono tabular-nums">
                    {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)} · {loc.radiusMeters}m radius
                  </p>
                </div>
                <span className="text-slate-600 shrink-0">{loc.allowWfh ? 'WFH Allowed' : 'On-site Only'}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <QrCode className="w-5 h-5 text-indigo-600" />
              <h3 className="text-base font-semibold text-slate-900">Dynamic QR Kiosk</h3>
            </div>
            <button
              type="button"
              disabled={busy || locations.length === 0}
              onClick={handleGenerateQr}
              className="px-3 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              Generate 90s QR
            </button>
          </div>
          {locations.length > 0 && (
            <select
              value={qrLocationId}
              onChange={(e) => setQrLocationId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
            >
              {locations.map((l) => (
                <option key={l.locationId} value={l.locationId}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
          {qrImage ? (
            <div className="space-y-3 text-center">
              <img
                src={qrImage}
                alt="Dynamic attendance QR code"
                className="mx-auto w-48 h-48 border border-slate-200 rounded-lg"
              />
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(qrPayload)}
                className="text-xs font-semibold text-indigo-600 hover:underline"
              >
                Copy Signed QR Token Payload
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-500 py-10 text-center">
              Generate an HMAC-signed, single-use QR token valid for 90 seconds.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
