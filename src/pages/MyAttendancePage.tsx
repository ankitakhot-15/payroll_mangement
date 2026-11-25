import React, { useEffect, useState } from 'react';
import {
  MapPin,
  Clock,
  CheckCircle2,
  XCircle,
  Coffee,
  LogOut,
  QrCode,
  FileWarning,
  ShieldCheck,
} from 'lucide-react';
import { CameraCapture } from '../components/CameraCapture';
import {
  AttendanceMethod,
  AttendanceRecord,
  Company,
  Employee,
  FaceRegistration,
  LeaveRequest,
  OfficeLocation,
  Shift,
} from '../types/payroll';
import { auth } from '../lib/firebase';
import { backendApi } from '../services/api';
import {
  createDocStrict,
  createImmutableEvent,
  logAuditEvent,
  makeId,
  updateDocStrict,
} from '../services/firestoreService';
import { currentYearMonth, formatMinutes, todayIsoDate } from '../utils/exports';
import { computeMonthlyAttendanceSummary } from '../utils/attendanceSummary';
import { extractFaceTemplateFromDataUrl } from '../utils/faceMatcher';

interface MyAttendancePageProps {
  company: Company;
  employee: Employee;
  shift?: Shift;
  officeLocations: OfficeLocation[];
  faceRegistration?: FaceRegistration;
  attendanceRecords: AttendanceRecord[];
  leaves?: LeaveRequest[];
}

export const MyAttendancePage: React.FC<MyAttendancePageProps> = ({
  company,
  employee,
  shift,
  officeLocations,
  faceRegistration,
  attendanceRecords,
  leaves = [],
}) => {
  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth());
  const [now, setNow] = useState(new Date());
  const [mode, setMode] = useState<'selfie_gps' | 'qr_code' | 'gps'>('selfie_gps');
  const [capturedFrames, setCapturedFrames] = useState<string[]>([]);
  const [checkInSnapshot, setCheckInSnapshot] = useState<string | null>(null);
  const [checkOutSnapshot, setCheckOutSnapshot] = useState<string | null>(null);
  const [livenessResult, setLivenessResult] = useState<{
    livenessStatus: 'passed' | 'failed';
    qualityScore: number;
    livenessToken: string;
  } | null>(null);
  const [faceVerifyResult, setFaceVerifyResult] = useState<{
    faceVerification: 'verified' | 'pending_review' | 'failed';
    confidenceScore: number;
    verificationNonce: string;
    reason?: string;
  } | null>(null);
  const [gpsResult, setGpsResult] = useState<{
    gpsStatus: 'verified' | 'outside_geofence' | 'wfh';
    distanceMeters: number | null;
    matchedLocationName: string;
    accuracyMeters: number | null;
  } | null>(null);

  const [qrInput, setQrInput] = useState('');
  const [attemptCount, setAttemptCount] = useState(0);
  const [busyAction, setBusyAction] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Correction modal state
  const [showCorrection, setShowCorrection] = useState(false);
  const [corrDate, setCorrDate] = useState(todayIsoDate());
  const [corrIssue, setCorrIssue] = useState<
    'missing_check_in' | 'missing_check_out' | 'wrong_shift' | 'missed_break' | 'location_review' | 'incorrect_status'
  >('missing_check_in');
  const [corrIn, setCorrIn] = useState('09:30');
  const [corrOut, setCorrOut] = useState('18:30');
  const [corrReason, setCorrReason] = useState('');

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setAttemptCount(0);
  }, [faceRegistration?.templateDigest, faceRegistration?.status]);

  const actorUid = auth.currentUser?.uid || employee.employeeUid || employee.companyOwnerUid;
  const hasApprovedFaceTemplate = Boolean(
    faceRegistration?.status === 'approved' &&
      faceRegistration?.faceDescriptor &&
      faceRegistration.faceDescriptor.length === 128
  );

  const today = todayIsoDate();
  const myRecords = attendanceRecords
    .filter((a) => a.employeeId === employee.employeeId)
    .sort((a, b) => b.date.localeCompare(a.date));
  const todayRecord = myRecords.find((a) => a.date === today);

  const isCheckedIn = Boolean(todayRecord && todayRecord.checkInAt && !todayRecord.checkOutAt);
  const isOnBreak = todayRecord?.attendanceStatus === 'on_break';
  const isCheckedOut = Boolean(todayRecord && todayRecord.checkOutAt);

  const enabledMethods: AttendanceMethod[] = company.attendancePolicy?.enabledMethods || [
    'selfie_gps',
    'face_verification',
    'gps',
    'qr_code',
    'fingerprint',
    'manual_hr',
  ];

  const handleCaptureFrames = async (frames: string[]) => {
    setCapturedFrames(frames);
    setFeedback(null);
    setLivenessResult(null);
    setFaceVerifyResult(null);
    setBusyAction(true);
    try {
      const [liveness, liveTemplate] = await Promise.all([
        backendApi.checkFaceLiveness({ frames }),
        extractFaceTemplateFromDataUrl(frames[0], { rejectMultipleFaces: true }),
      ]);

      setLivenessResult({
        livenessStatus: liveness.livenessStatus,
        qualityScore: liveness.qualityScore,
        livenessToken: liveness.livenessToken,
      });

      const nextAttempt = attemptCount + 1;
      setAttemptCount(nextAttempt);

      const faceRes = await backendApi.verifyFace({
        livenessToken: liveness.livenessToken,
        frameBase64: frames[0],
        registeredStatus: faceRegistration?.status || 'not_registered',
        confidenceThreshold: company.attendancePolicy?.faceConfidenceThreshold || 80,
        attemptCount: nextAttempt,
        maxRetries: Math.max(company.attendancePolicy?.maxVerificationRetries || 3, 5),
        faceDetected: true,
        liveDescriptor: liveTemplate.descriptor,
        registeredDescriptor: faceRegistration?.faceDescriptor,
      });

      setFaceVerifyResult(faceRes);
      setFeedback({
        type: faceRes.faceVerification === 'verified' ? 'success' : 'error',
        text:
          faceRes.faceVerification === 'verified'
            ? `Liveness passed (${liveness.qualityScore}%) & Face verified (${faceRes.confidenceScore}% match).`
            : faceRes.reason || `Wrong face detected (${faceRes.confidenceScore}% match).`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Biometric verification failed.';
      setFaceVerifyResult({
        faceVerification: 'failed',
        confidenceScore: 0,
        verificationNonce: '',
        reason: msg,
      });
      setFeedback({
        type: 'error',
        text: msg,
      });
    } finally {
      setBusyAction(false);
    }
  };

  const captureGpsOnce = async () => {
    setFeedback(null);
    if (!navigator.geolocation) {
      setFeedback({ type: 'error', text: 'Geolocation API not available in this browser.' });
      return null;
    }
    setBusyAction(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        });
      });

      const res = await backendApi.verifyLocation({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracyMeters: pos.coords.accuracy,
        allowWfh: company.attendancePolicy?.allowWfhCheckIn ?? true,
        locations: officeLocations.map((l) => ({
          locationId: l.locationId,
          name: l.name,
          latitude: l.latitude,
          longitude: l.longitude,
          radiusMeters: l.radiusMeters,
        })),
      });

      setGpsResult({
        gpsStatus: res.gpsStatus,
        distanceMeters: res.distanceMeters,
        matchedLocationName: res.matchedLocationName,
        accuracyMeters: Math.round(pos.coords.accuracy),
      });
      return res;
    } catch (err) {
      setFeedback({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Location permission denied. Enable GPS or submit a manual correction request.',
      });
      return null;
    } finally {
      setBusyAction(false);
    }
  };

  const handleCheckIn = async () => {
    setFeedback(null);
    if (todayRecord) {
      setFeedback({ type: 'error', text: 'Duplicate check-in blocked: you already have a record for today.' });
      return;
    }
    if (!enabledMethods.includes(mode)) {
      setFeedback({ type: 'error', text: `Attendance method "${mode}" is disabled by company policy.` });
      return;
    }

    setBusyAction(true);
    try {
      if (!livenessResult || livenessResult.livenessStatus !== 'passed' || !faceVerifyResult || !capturedFrames[0]) {
        throw new Error('Capture a live check-in selfie and pass face matching before checking in.');
      }
      if (faceVerifyResult.faceVerification !== 'verified') {
        throw new Error(
          faceVerifyResult.reason ||
            'Wrong face detected or face unapproved. Please scan the enrolled employee face.'
        );
      }

      const faceStatus = faceVerifyResult.faceVerification;
      const livenessStatus = livenessResult.livenessStatus;
      let verificationNonce = faceVerifyResult.verificationNonce;
      let gpsStatus: 'verified' | 'outside_geofence' | 'wfh' | 'not_required' = 'not_required';
      let distanceMeters: number | undefined;

      if (mode === 'qr_code') {
        if (!qrInput.trim()) {
          throw new Error('Paste or scan a valid dynamic QR token first.');
        }
        const qrRes = await backendApi.verifyQrToken({
          tokenPayload: qrInput.trim(),
          expectedCompanyId: company.companyId,
        });
        verificationNonce = qrRes.verificationNonce;
        gpsStatus = 'verified';
      } else {
        const locRes = gpsResult || (await captureGpsOnce());
        if (mode === 'gps' && !locRes) throw new Error('GPS verification required.');
        if (locRes) {
          gpsStatus = locRes.gpsStatus;
          distanceMeters = locRes.distanceMeters ?? undefined;
          if (company.attendancePolicy?.requireGeofence && gpsStatus === 'outside_geofence') {
            throw new Error(`Outside permitted office geofence (${distanceMeters}m away).`);
          }
        }
      }

      const attendanceId = `ATT_${employee.employeeId}_${today.replace(/-/g, '')}`;
      const checkInIso = new Date().toISOString();
      const shiftStart = shift?.startTime || '09:30';
      const grace = shift?.gracePeriodMinutes ?? 15;
      const [sh, sm] = shiftStart.split(':').map(Number);
      const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
      const lateMinutes = shift?.isNightShift ? 0 : Math.max(0, nowMins - (sh * 60 + sm + grace));

      await createDocStrict('attendance', attendanceId, {
        attendanceId,
        companyId: company.companyId,
        companyOwnerUid: employee.companyOwnerUid,
        employeeId: employee.employeeId,
        employeeUid: actorUid,
        employeeName: employee.fullName,
        department: employee.department,
        date: today,
        attendanceMethod: mode,
        attendanceStatus: gpsStatus === 'wfh' ? 'wfh' : lateMinutes > 0 ? 'late' : 'present',
        faceVerification: faceStatus,
        livenessStatus,
        checkInFaceVerification: faceStatus,
        checkInLivenessStatus: livenessStatus,
        checkInConfidenceScore: faceVerifyResult.confidenceScore,
        gpsStatus,
        workingMinutes: 0,
        breakMinutes: 0,
        overtimeMinutes: 0,
        lateMinutes,
        approvalStatus: 'auto_approved',
        checkInAt: checkInIso,
      });

      const eventId = makeId('EVT');
      await createImmutableEvent('attendanceEvents', eventId, {
        eventId,
        companyId: company.companyId,
        companyOwnerUid: employee.companyOwnerUid,
        employeeId: employee.employeeId,
        employeeUid: actorUid,
        attendanceId,
        eventType: mode === 'qr_code' ? 'qr_punch' : 'check_in',
        method: mode,
        verificationNonce,
        confidenceScore: faceVerifyResult.confidenceScore,
        ...(distanceMeters !== undefined ? { distanceMeters } : {}),
      });

      await logAuditEvent({
        companyId: company.companyId,
        companyOwnerUid: employee.companyOwnerUid,
        actorUid,
        actorName: employee.fullName,
        action: 'ATTENDANCE_CHECK_IN',
        targetCollection: 'attendance',
        targetId: attendanceId,
        summary: `${employee.fullName} checked in with selfie (${faceVerifyResult.confidenceScore}%) via ${mode} (${gpsStatus}).`,
      });

      setCheckInSnapshot(capturedFrames[0]);
      setCapturedFrames([]);
      setLivenessResult(null);
      setFaceVerifyResult(null);
      setAttemptCount(0);
      setFeedback({ type: 'success', text: 'Check-in selfie verified & punch recorded.' });
    } catch (err) {
      setFeedback({ type: 'error', text: err instanceof Error ? err.message : 'Check-in failed.' });
    } finally {
      setBusyAction(false);
    }
  };

  const handleBreakToggle = async (action: 'break_start' | 'break_end') => {
    if (!todayRecord) return;
    setBusyAction(true);
    setFeedback(null);
    try {
      const eventId = makeId('EVT');
      await createImmutableEvent('attendanceEvents', eventId, {
        eventId,
        companyId: company.companyId,
        companyOwnerUid: employee.companyOwnerUid,
        employeeId: employee.employeeId,
        employeeUid: actorUid,
        attendanceId: todayRecord.attendanceId,
        eventType: action,
        method: todayRecord.attendanceMethod,
      });

      const nextBreakMinutes =
        action === 'break_end'
          ? (todayRecord.breakMinutes || 0) + (shift?.breakDurationMinutes ?? 30)
          : todayRecord.breakMinutes || 0;

      await updateDocStrict('attendance', todayRecord.attendanceId, {
        attendanceStatus: action === 'break_start' ? 'on_break' : 'present',
        breakMinutes: nextBreakMinutes,
      });

      setFeedback({
        type: 'success',
        text: action === 'break_start' ? 'Break started.' : 'Break ended and resumed work session.',
      });
    } catch (err) {
      setFeedback({ type: 'error', text: err instanceof Error ? err.message : 'Break update failed.' });
    } finally {
      setBusyAction(false);
    }
  };

  const handleCheckOut = async () => {
    if (!todayRecord || !todayRecord.checkInAt) {
      setFeedback({ type: 'error', text: 'Cannot check out without an active check-in.' });
      return;
    }
    if (todayRecord.checkOutAt) {
      setFeedback({ type: 'error', text: 'Duplicate check-out blocked.' });
      return;
    }

    setBusyAction(true);
    setFeedback(null);
    try {
      if (!livenessResult || livenessResult.livenessStatus !== 'passed' || !faceVerifyResult || !capturedFrames[0]) {
        throw new Error('Capture a live check-out selfie and pass face matching before checking out.');
      }
      if (faceVerifyResult.faceVerification !== 'verified') {
        throw new Error(
          faceVerifyResult.reason ||
            'Wrong face detected or face unapproved. Please scan the enrolled employee face.'
        );
      }

      let gpsStatus = todayRecord.gpsStatus || 'not_required';
      let distanceMeters: number | undefined;
      if (mode !== 'qr_code') {
        const locRes = gpsResult || (await captureGpsOnce());
        if (locRes) {
          gpsStatus = locRes.gpsStatus;
          distanceMeters = locRes.distanceMeters ?? undefined;
          if (company.attendancePolicy?.requireGeofence && gpsStatus === 'outside_geofence') {
            throw new Error(`Outside permitted office geofence for check-out (${distanceMeters}m away).`);
          }
        }
      }

      const outIso = new Date().toISOString();
      const calc = await backendApi.calculateWorkingHours({
        checkInIso: todayRecord.checkInAt,
        checkOutIso: outIso,
        breakMinutes: todayRecord.breakMinutes || 0,
        shiftStartTime: shift?.startTime || '09:30',
        shiftEndTime: shift?.endTime || '18:30',
        gracePeriodMinutes: shift?.gracePeriodMinutes ?? 15,
        requiredWorkMinutes: shift?.requiredWorkMinutes ?? 480,
        overtimeEligible: shift?.overtimeEligible ?? true,
        isNightShift: shift?.isNightShift ?? false,
      });

      const checkOutFaceVerification = faceVerifyResult.faceVerification;
      const checkOutLivenessStatus = livenessResult.livenessStatus;

      await updateDocStrict('attendance', todayRecord.attendanceId, {
        checkOutAt: outIso,
        workingMinutes: calc.netWorkingMinutes,
        overtimeMinutes: calc.overtimeMinutes,
        lateMinutes: calc.lateMinutes,
        attendanceStatus: calc.attendanceStatus,
        faceVerification: checkOutFaceVerification,
        livenessStatus: checkOutLivenessStatus,
        checkOutFaceVerification,
        checkOutLivenessStatus,
        checkOutConfidenceScore: faceVerifyResult.confidenceScore,
        gpsStatus,
      });

      const eventId = makeId('EVT');
      await createImmutableEvent('attendanceEvents', eventId, {
        eventId,
        companyId: company.companyId,
        companyOwnerUid: employee.companyOwnerUid,
        employeeId: employee.employeeId,
        employeeUid: actorUid,
        attendanceId: todayRecord.attendanceId,
        eventType: 'check_out',
        method: todayRecord.attendanceMethod,
        verificationNonce: faceVerifyResult.verificationNonce,
        confidenceScore: faceVerifyResult.confidenceScore,
        ...(distanceMeters !== undefined ? { distanceMeters } : {}),
      });

      await logAuditEvent({
        companyId: company.companyId,
        companyOwnerUid: employee.companyOwnerUid,
        actorUid,
        actorName: employee.fullName,
        action: 'ATTENDANCE_CHECK_OUT',
        targetCollection: 'attendance',
        targetId: todayRecord.attendanceId,
        summary: `${employee.fullName} checked out with selfie (${faceVerifyResult.confidenceScore}%). Net work: ${formatMinutes(calc.netWorkingMinutes)}.`,
      });

      setCheckOutSnapshot(capturedFrames[0]);
      setCapturedFrames([]);
      setLivenessResult(null);
      setFaceVerifyResult(null);
      setAttemptCount(0);
      setFeedback({
        type: 'success',
        text: `Check-out selfie verified! Net working duration: ${formatMinutes(calc.netWorkingMinutes)}.`,
      });
    } catch (err) {
      setFeedback({ type: 'error', text: err instanceof Error ? err.message : 'Check-out failed.' });
    } finally {
      setBusyAction(false);
    }
  };

  const handleSubmitCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (corrReason.trim().length < 3) return;
    setBusyAction(true);
    try {
      const correctionId = makeId('CORR');
      await createDocStrict('attendanceCorrections', correctionId, {
        correctionId,
        companyId: company.companyId,
        companyOwnerUid: employee.companyOwnerUid,
        employeeId: employee.employeeId,
        employeeUid: actorUid,
        employeeName: employee.fullName,
        date: corrDate,
        issueType: corrIssue,
        requestedCheckIn: corrIn,
        requestedCheckOut: corrOut,
        reason: corrReason.trim(),
        status: 'pending_manager',
      });
      setShowCorrection(false);
      setCorrReason('');
      setFeedback({ type: 'success', text: 'Attendance correction submitted to Department Manager & HR.' });
    } catch (err) {
      setFeedback({ type: 'error', text: err instanceof Error ? err.message : 'Failed to submit correction.' });
    } finally {
      setBusyAction(false);
    }
  };

  const lateMarksRuleCount = company.attendancePolicy?.lateMarksPerDeduction ?? 3;
  const lateCutDaysRule = company.attendancePolicy?.lateDeductionDaysPerThreshold ?? 1;
  const monthSummary = computeMonthlyAttendanceSummary({
    employeeId: employee.employeeId,
    month: selectedMonth,
    attendance: attendanceRecords,
    leaves,
    company,
  });
  const filteredMonthRecords = myRecords.filter((r) => r.date.startsWith(selectedMonth));

  return (
    <div className="space-y-6">
      {/* Live Status Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{employee.employeeCode}</span>
            <span aria-hidden="true">·</span>
            <span>{shift?.name || 'General Shift'} ({shift?.startTime || '09:30'} - {shift?.endTime || '18:30'})</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
            Status: {isCheckedOut ? 'Checked Out' : isOnBreak ? 'On Break' : isCheckedIn ? 'Present' : 'Not Checked In'}
          </h2>
          <p className="text-sm text-slate-600">
            {now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>

        <div className="flex flex-col sm:items-end gap-1 shrink-0">
          <p className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-indigo-600">
            {now.toLocaleTimeString()}
          </p>
          <p className="text-xs text-slate-500">
            Face Enrollment: <span className="font-semibold text-slate-800">{faceRegistration?.status?.replace(/_/g, ' ') || 'not registered'}</span>
          </p>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-4 rounded-xl border flex items-start gap-3 text-sm ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          )}
          <span className="break-words">{feedback.text}</span>
        </div>
      )}

      {/* Punch Cockpit */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-5 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-slate-900">Biometric &amp; Location Verification</h3>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(['selfie_gps', 'qr_code', 'gps'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {m === 'selfie_gps' ? 'Selfie + GPS' : m === 'qr_code' ? 'QR Scan' : 'GPS Only'}
                </button>
              ))}
            </div>
          </div>

          {/* Mandatory Live Selfie Check for Both Check-In & Check-Out */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-indigo-700">
                {isCheckedOut
                  ? 'Daily Check-In & Check-Out Selfies Completed'
                  : isCheckedIn
                    ? 'Step 2: Capture Check-Out Selfie Before Checking Out'
                    : 'Step 1: Capture Check-In Selfie Before Checking In'}
              </p>
              <span className="text-[11px] font-medium text-slate-500">
                Required on both Check-In &amp; Check-Out
              </span>
            </div>

            {!hasApprovedFaceTemplate && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                <strong>Biometric Photo Needed:</strong> HR Manager or Company Admin must upload and
                approve your reference photo in <strong>Biometric Face Enrollment</strong> before
                selfie check-in/check-out can verify your identity.
              </div>
            )}

            <CameraCapture
              onCaptureFrames={handleCaptureFrames}
              sampleCount={2}
              buttonLabel={isCheckedIn ? 'Capture Check-Out Selfie' : 'Capture Check-In Selfie'}
              busy={busyAction}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div
                className={`p-3 border rounded-lg text-xs space-y-1 ${
                  faceVerifyResult?.faceVerification === 'failed'
                    ? 'bg-red-50 border-red-200'
                    : faceVerifyResult?.faceVerification === 'verified'
                      ? 'bg-emerald-50 border-emerald-200'
                      : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-slate-700">
                    {isCheckedIn ? 'Check-Out Face Match' : 'Check-In Face Match'}
                  </p>
                  {attemptCount > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setAttemptCount(0);
                        setFaceVerifyResult(null);
                        setFeedback(null);
                      }}
                      className="text-[11px] font-semibold text-indigo-600 hover:underline"
                    >
                      Reset
                    </button>
                  )}
                </div>
                <p
                  className={
                    faceVerifyResult?.faceVerification === 'failed'
                      ? 'text-red-700 font-semibold'
                      : faceVerifyResult?.faceVerification === 'verified'
                        ? 'text-emerald-700 font-semibold'
                        : 'text-slate-600'
                  }
                >
                  {faceVerifyResult
                    ? faceVerifyResult.faceVerification === 'verified'
                      ? `VERIFIED · ${faceVerifyResult.confidenceScore}% match`
                      : `FAILED (${faceVerifyResult.confidenceScore}% match) · Wrong face`
                    : isCheckedIn
                      ? 'Awaiting live check-out selfie capture'
                      : 'Awaiting live check-in selfie capture'}
                </p>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">GPS Geofence</span>
                  <button
                    type="button"
                    onClick={captureGpsOnce}
                    disabled={busyAction}
                    className="text-indigo-600 font-semibold hover:underline"
                  >
                    Verify GPS
                  </button>
                </div>
                <p className="text-slate-600">
                  {gpsResult
                    ? `${gpsResult.gpsStatus.replace(/_/g, ' ')} · ${gpsResult.matchedLocationName}${
                        gpsResult.distanceMeters !== null ? ` (${gpsResult.distanceMeters}m)` : ''
                      }`
                    : 'Location checked only when you punch'}
                </p>
              </div>
            </div>
          </div>

          {mode === 'qr_code' && (
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div className="flex items-center gap-2 text-sm text-slate-700">
                <QrCode className="w-4 h-4 text-indigo-600" />
                <span>Paste dynamic QR payload from the Office Kiosk (valid for 90 seconds)</span>
              </div>
              <textarea
                rows={3}
                value={qrInput}
                onChange={(e) => setQrInput(e.target.value)}
                placeholder='{"companyId":"COMP_MAIN","locationId":"LOC_HQ_01",...}'
                className="w-full p-3 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          )}

          {mode === 'gps' && (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-800">Event-Triggered GPS Check</span>
                <button
                  type="button"
                  onClick={captureGpsOnce}
                  disabled={busyAction}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  Capture Coordinates
                </button>
              </div>
              <p className="text-xs text-slate-600">
                {gpsResult
                  ? `Result: ${gpsResult.gpsStatus} · ${gpsResult.matchedLocationName} (${gpsResult.distanceMeters ?? 0}m from branch, ±${gpsResult.accuracyMeters ?? 0}m accuracy)`
                  : 'Click "Capture Coordinates" to verify proximity to an authorized office location.'}
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
            <button
              type="button"
              disabled={busyAction || Boolean(todayRecord)}
              onClick={handleCheckIn}
              className="flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-40 transition-colors"
            >
              <Clock className="w-4 h-4 shrink-0" />
              <span>Check In</span>
            </button>

            <button
              type="button"
              disabled={busyAction || !isCheckedIn || isOnBreak}
              onClick={() => handleBreakToggle('break_start')}
              className="flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold text-slate-800 bg-amber-100 rounded-lg hover:bg-amber-200 disabled:opacity-40 transition-colors"
            >
              <Coffee className="w-4 h-4 shrink-0" />
              <span>Start Break</span>
            </button>

            <button
              type="button"
              disabled={busyAction || !isOnBreak}
              onClick={() => handleBreakToggle('break_end')}
              className="flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold text-slate-800 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-40 transition-colors"
            >
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>End Break</span>
            </button>

            <button
              type="button"
              disabled={busyAction || !isCheckedIn}
              onClick={handleCheckOut}
              className="flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-40 transition-colors"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span>Check Out</span>
            </button>
          </div>
        </div>

        {/* Today Summary & Monthly Metrics */}
        <div className="lg:col-span-5 space-y-6 min-w-0">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-slate-900">Today&apos;s Verified Summary</h3>
              <button
                type="button"
                onClick={() => setShowCorrection(true)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:underline whitespace-nowrap shrink-0"
              >
                <FileWarning className="w-3.5 h-3.5" />
                Request Correction
              </button>
            </div>

            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 bg-slate-50 rounded-lg">
                <dt className="text-xs text-slate-500">Check-In</dt>
                <dd className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                  {todayRecord?.checkInAt
                    ? new Date(todayRecord.checkInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : '--:--'}
                </dd>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <dt className="text-xs text-slate-500">Check-Out</dt>
                <dd className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                  {todayRecord?.checkOutAt
                    ? new Date(todayRecord.checkOutAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : '--:--'}
                </dd>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <dt className="text-xs text-slate-500">Working Duration</dt>
                <dd className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                  {formatMinutes(todayRecord?.workingMinutes)}
                </dd>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <dt className="text-xs text-slate-500">Overtime / Late</dt>
                <dd className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                  {todayRecord?.overtimeMinutes || 0}m OT · {todayRecord?.lateMinutes || 0}m Late
                </dd>
              </div>
            </dl>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
              <div className="flex items-center gap-2.5 p-2.5 bg-slate-50 rounded-lg">
                {checkInSnapshot && (
                  <img
                    src={checkInSnapshot}
                    alt="Check-in selfie"
                    referrerPolicy="no-referrer"
                    className="w-10 h-10 rounded-md object-cover border border-slate-200 shrink-0"
                  />
                )}
                <div className="text-xs min-w-0">
                  <p className="font-semibold text-slate-800">Check-In Selfie</p>
                  <p className="text-slate-600 truncate">
                    {todayRecord?.checkInFaceVerification || (todayRecord?.checkInAt ? todayRecord.faceVerification : 'pending')}
                    {todayRecord?.checkInConfidenceScore ? ` (${todayRecord.checkInConfidenceScore}%)` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 p-2.5 bg-slate-50 rounded-lg">
                {checkOutSnapshot && (
                  <img
                    src={checkOutSnapshot}
                    alt="Check-out selfie"
                    referrerPolicy="no-referrer"
                    className="w-10 h-10 rounded-md object-cover border border-slate-200 shrink-0"
                  />
                )}
                <div className="text-xs min-w-0">
                  <p className="font-semibold text-slate-800">Check-Out Selfie</p>
                  <p className="text-slate-600 truncate">
                    {todayRecord?.checkOutFaceVerification || (todayRecord?.checkOutAt ? todayRecord.faceVerification : 'pending')}
                    {todayRecord?.checkOutConfidenceScore ? ` (${todayRecord.checkOutConfidenceScore}%)` : ''}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-slate-900">Working Days &amp; Late Mark Check</h3>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="px-2.5 py-1 text-xs font-mono border border-slate-200 rounded-lg"
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
              <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-lg">
                <p className="text-[11px] text-emerald-700 font-medium">Days Worked</p>
                <p className="text-lg font-bold font-mono tabular-nums text-emerald-800">
                  {monthSummary.workingDays}d
                </p>
                <p className="text-[10px] text-emerald-700">
                  {monthSummary.presentDays} Full · {monthSummary.halfDays} Half
                </p>
              </div>
              <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg">
                <p className="text-[11px] text-amber-800 font-medium">Late Marks</p>
                <p className="text-lg font-bold font-mono tabular-nums text-amber-700">
                  {monthSummary.lateMarksCount}
                </p>
                <p className="text-[10px] text-amber-700">
                  {monthSummary.totalLateMinutes}m late total
                </p>
              </div>
              <div className="p-3 bg-red-50 border border-red-100 rounded-lg">
                <p className="text-[11px] text-red-700 font-medium">Salary Cut Days</p>
                <p className="text-lg font-bold font-mono tabular-nums text-red-700">
                  {monthSummary.totalDeductionDays}d
                </p>
                <p className="text-[10px] text-red-700">
                  {monthSummary.leaveDeductionDays}d leave · {monthSummary.lateDeductionDays}d late
                </p>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <p className="text-[11px] text-slate-600 font-medium">Paid Days / OT</p>
                <p className="text-lg font-bold font-mono tabular-nums text-slate-900">
                  {monthSummary.suggestedPaidDays}d
                </p>
                <p className="text-[10px] text-slate-500">
                  OT: {formatMinutes(monthSummary.overtimeMinutes)}
                </p>
              </div>
            </div>

            <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
              {lateMarksRuleCount === 0 ? (
                <>
                  Late Mark Rule: <strong>OFF (0)</strong> — no late-mark salary deduction.
                </>
              ) : (
                <>
                  Late Mark Rule: Every <strong>{lateMarksRuleCount}</strong> late marks ={' '}
                  <strong>{lateCutDaysRule} day(s)</strong> extra salary deduction.
                </>
              )}{' '}
              Paid Leaves: {monthSummary.paidLeaveDays}d · Unpaid LWP: {monthSummary.unpaidLeaveDays}d · Absent: {monthSummary.absentDays}d.
            </p>
          </div>
        </div>
      </div>

      {/* Attendance History (Responsive Table -> Cards on Mobile, zero horizontal scroll) */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-slate-900">
            Attendance &amp; Late Mark Log ({selectedMonth})
          </h3>
          <span className="text-xs text-slate-500">
            {filteredMonthRecords.length} entries in {selectedMonth}
          </span>
        </div>
        {filteredMonthRecords.length === 0 ? (
          <p className="text-sm text-slate-500 py-6 text-center">
            No attendance punches recorded for {selectedMonth}. Check in above to log your work session.
          </p>
        ) : (
          <>
            <div className="hidden md:block">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                    <th className="py-2.5 pr-4">Date</th>
                    <th className="py-2.5 pr-4">Method</th>
                    <th className="py-2.5 pr-4">In / Out</th>
                    <th className="py-2.5 pr-4">Net Work</th>
                    <th className="py-2.5 pr-4">Late Mark</th>
                    <th className="py-2.5 pr-4">Verification</th>
                    <th className="py-2.5 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredMonthRecords.map((rec) => {
                    const isLate = (rec.lateMinutes || 0) > 0 || rec.attendanceStatus === 'late';
                    return (
                      <tr key={rec.attendanceId} className="hover:bg-slate-50">
                        <td className="py-2.5 pr-4 font-mono tabular-nums text-slate-900">{rec.date}</td>
                        <td className="py-2.5 pr-4 text-slate-600">{rec.attendanceMethod.replace(/_/g, ' ')}</td>
                        <td className="py-2.5 pr-4 font-mono tabular-nums text-slate-700">
                          {rec.checkInAt ? new Date(rec.checkInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                          {' / '}
                          {rec.checkOutAt ? new Date(rec.checkOutAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                        </td>
                        <td className="py-2.5 pr-4 font-mono tabular-nums text-slate-700">
                          {formatMinutes(rec.workingMinutes)}
                        </td>
                        <td className="py-2.5 pr-4 text-xs">
                          {isLate ? (
                            <span className="font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                              Late +{rec.lateMinutes || 0}m
                            </span>
                          ) : (
                            <span className="text-emerald-700">On Time</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-4 text-xs text-slate-600">
                          Face: {rec.faceVerification || 'na'} · GPS: {rec.gpsStatus || 'na'}
                        </td>
                        <td className="py-2.5 text-right font-medium capitalize text-slate-900">
                          {rec.attendanceStatus.replace(/_/g, ' ')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="md:hidden divide-y divide-slate-100">
              {filteredMonthRecords.map((rec) => {
                const isLate = (rec.lateMinutes || 0) > 0 || rec.attendanceStatus === 'late';
                return (
                  <div key={rec.attendanceId} className="py-3 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-mono font-semibold text-slate-900">{rec.date}</span>
                      <div className="flex items-center gap-2">
                        {isLate && (
                          <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                            Late +{rec.lateMinutes || 0}m
                          </span>
                        )}
                        <span className="text-xs font-semibold capitalize text-indigo-600">
                          {rec.attendanceStatus.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-slate-600 font-mono tabular-nums">
                      {rec.checkInAt ? new Date(rec.checkInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                      {' → '}
                      {rec.checkOutAt ? new Date(rec.checkOutAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                      {' · '}
                      {formatMinutes(rec.workingMinutes)}
                    </p>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Correction Request Modal */}
      {showCorrection && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-semibold text-slate-900">Request Attendance Correction</h3>
            <form onSubmit={handleSubmitCorrection} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Attendance Date</label>
                <input
                  type="date"
                  required
                  value={corrDate}
                  onChange={(e) => setCorrDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Issue Type</label>
                <select
                  value={corrIssue}
                  onChange={(e) => setCorrIssue(e.target.value as typeof corrIssue)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                >
                  <option value="missing_check_in">Missing Check-In</option>
                  <option value="missing_check_out">Missing Check-Out</option>
                  <option value="location_review">Location Verification Review</option>
                  <option value="missed_break">Missed Break</option>
                  <option value="wrong_shift">Wrong Shift</option>
                  <option value="incorrect_status">Incorrect Status</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Requested Check-In</label>
                  <input
                    type="time"
                    value={corrIn}
                    onChange={(e) => setCorrIn(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Requested Check-Out</label>
                  <input
                    type="time"
                    value={corrOut}
                    onChange={(e) => setCorrOut(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Reason &amp; Supporting Context</label>
                <textarea
                  required
                  rows={3}
                  value={corrReason}
                  onChange={(e) => setCorrReason(e.target.value)}
                  placeholder="Describe why attendance requires correction..."
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCorrection(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyAction}
                  className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                >
                  Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
