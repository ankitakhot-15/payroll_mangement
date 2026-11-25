import React, { useEffect, useRef, useState } from 'react';
import {
  ScanFace,
  CheckCircle2,
  XCircle,
  RotateCcw,
  ShieldAlert,
  Upload,
  Camera,
  UserCheck,
  ImagePlus,
} from 'lucide-react';
import { CameraCapture } from '../components/CameraCapture';
import { Company, Employee, FaceRegistration, UserRole } from '../types/payroll';
import { backendApi } from '../services/api';
import { auth } from '../lib/firebase';
import { createDocStrict, logAuditEvent, updateDocStrict } from '../services/firestoreService';
import { extractFaceTemplateFromDataUrl, readFileAsDataUrl } from '../utils/faceMatcher';

interface FaceRegistrationPageProps {
  company: Company;
  employee: Employee;
  employees?: Employee[];
  effectiveRole: UserRole;
  registrations: FaceRegistration[];
}

export const FaceRegistrationPage: React.FC<FaceRegistrationPageProps> = ({
  company,
  employee,
  employees = [],
  effectiveRole,
  registrations,
}) => {
  const canReview = ['super_admin', 'company_admin', 'hr_manager'].includes(effectiveRole);
  const myReg = registrations.find((r) => r.employeeId === employee.employeeId);

  const [consentAccepted, setConsentAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // HR / Admin reference selfie upload/capture state
  const directoryList = employees.length > 0 ? employees : [employee];
  const [selectedEmpId, setSelectedEmpId] = useState<string>(directoryList[0]?.employeeId || employee.employeeId);
  const [hrCaptureMode, setHrCaptureMode] = useState<'upload' | 'camera'>('upload');
  const [hrPreparedFace, setHrPreparedFace] = useState<{
    thumbnailDataUrl: string;
    descriptor: number[];
    detectionScore: number;
    sampleCount: number;
    sourceLabel: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hrPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!directoryList.some((e) => e.employeeId === selectedEmpId) && directoryList[0]) {
      setSelectedEmpId(directoryList[0].employeeId);
    }
  }, [directoryList, selectedEmpId]);

  const selectedTargetEmp =
    directoryList.find((e) => e.employeeId === selectedEmpId) || employee;
  const selectedExistingReg = registrations.find(
    (r) => r.employeeId === selectedTargetEmp.employeeId
  );

  const computeDigest = async (dataUrl: string): Promise<string> => {
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(dataUrl));
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 32);
  };

  const handleHrFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setBusy(true);
    setFeedback(null);
    setHrPreparedFace(null);
    try {
      const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
      if (!allowedTypes.includes(file.type.toLowerCase())) {
        throw new Error('Please upload a JPG, PNG, JPEG, or WebP face photo.');
      }

      const dataUrl = await readFileAsDataUrl(file);
      const template = await extractFaceTemplateFromDataUrl(dataUrl, {
        rejectMultipleFaces: true,
      });

      if (template.thumbnailDataUrl.length > 195000) {
        throw new Error('Processed face thumbnail exceeds size limit. Try another photo.');
      }

      setHrPreparedFace({
        thumbnailDataUrl: template.thumbnailDataUrl,
        descriptor: template.descriptor,
        detectionScore: template.detectionScore,
        sampleCount: 1,
        sourceLabel: `Uploaded photo: ${file.name}`,
      });
      setFeedback({
        type: 'success',
        text: `Face detected in uploaded photo (${template.detectionScore}% clarity). Click "Save & Approve Employee Selfie" to activate verification.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to detect a human face in this image.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleHrCameraFrames = async (frames: string[]) => {
    setBusy(true);
    setFeedback(null);
    setHrPreparedFace(null);
    try {
      const template = await extractFaceTemplateFromDataUrl(frames[0], {
        rejectMultipleFaces: true,
      });
      setHrPreparedFace({
        thumbnailDataUrl: template.thumbnailDataUrl,
        descriptor: template.descriptor,
        detectionScore: template.detectionScore,
        sampleCount: frames.length,
        sourceLabel: `Camera capture (${frames.length} samples)`,
      });
      setFeedback({
        type: 'success',
        text: `Live face signature extracted (${template.detectionScore}% clarity). Click "Save & Approve Employee Selfie" to save.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to extract face signature from camera frame.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveHrReferenceSelfie = async () => {
    if (!hrPreparedFace) {
      setFeedback({
        type: 'error',
        text: 'Upload an image or capture a live camera face first.',
      });
      return;
    }

    setBusy(true);
    setFeedback(null);
    try {
      const target = selectedTargetEmp;
      const cleanIdPart = target.employeeId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
      const regId = selectedExistingReg?.registrationId || `FACEREG_${cleanIdPart}`;
      const templateDigest = await computeDigest(hrPreparedFace.thumbnailDataUrl);
      const actorUid = auth.currentUser?.uid || employee.employeeUid || employee.companyOwnerUid;
      const targetEmail = (target.email || '').trim().toLowerCase().slice(0, 160);
      const targetUid = target.employeeUid || target.companyOwnerUid || company.companyOwnerUid;

      if (selectedExistingReg) {
        await updateDocStrict('faceRegistrations', regId, {
          employeeUid: targetUid,
          ...(targetEmail ? { employeeEmail: targetEmail } : {}),
          employeeName: target.fullName.slice(0, 120),
          status: 'approved',
          consentAccepted: true,
          sampleCount: hrPreparedFace.sampleCount,
          qualityScore: hrPreparedFace.detectionScore,
          templateDigest,
          referencePhotoDataUrl: hrPreparedFace.thumbnailDataUrl,
          faceDescriptor: hrPreparedFace.descriptor,
          reviewNote: 'Reference face enrolled and approved by HR/Admin.',
        });
      } else {
        await createDocStrict('faceRegistrations', regId, {
          registrationId: regId,
          companyId: company.companyId,
          companyOwnerUid: target.companyOwnerUid || company.companyOwnerUid,
          employeeId: target.employeeId,
          employeeUid: targetUid,
          ...(targetEmail ? { employeeEmail: targetEmail } : {}),
          employeeName: target.fullName.slice(0, 120),
          status: 'approved',
          consentAccepted: true,
          sampleCount: hrPreparedFace.sampleCount,
          qualityScore: hrPreparedFace.detectionScore,
          templateDigest,
          referencePhotoDataUrl: hrPreparedFace.thumbnailDataUrl,
          faceDescriptor: hrPreparedFace.descriptor,
          reviewNote: 'Reference face enrolled and approved by HR/Admin.',
        });
      }

      await logAuditEvent({
        companyId: company.companyId,
        companyOwnerUid: company.companyOwnerUid,
        actorUid,
        actorName: employee.fullName,
        action: 'HR_FACE_REFERENCE_ENROLLED',
        targetCollection: 'faceRegistrations',
        targetId: regId,
        summary: `HR/Admin enrolled & approved reference face for ${target.fullName} (${hrPreparedFace.detectionScore}% clarity).`,
      });

      setHrPreparedFace(null);
      setFeedback({
        type: 'success',
        text: `Reference selfie saved & approved for ${target.fullName}. Live attendance check-in/out will now match against this face.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save employee reference selfie.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSelfEnrollFrames = async (frames: string[]) => {
    if (!consentAccepted) {
      setFeedback({
        type: 'error',
        text: 'Please accept biometric consent before submitting enrollment.',
      });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const [liveness, template] = await Promise.all([
        backendApi.checkFaceLiveness({ frames, challengeType: 'multi_frame_capture' }),
        extractFaceTemplateFromDataUrl(frames[0], { rejectMultipleFaces: true }),
      ]);
      if (liveness.livenessStatus !== 'passed') {
        throw new Error(
          'Sample liveness check failed. Ensure good lighting and capture multiple natural angles.'
        );
      }

      const cleanIdPart = employee.employeeId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
      const regId = myReg?.registrationId || `FACEREG_${cleanIdPart}`;
      const myUid = auth.currentUser?.uid || employee.employeeUid || employee.companyOwnerUid;
      const myEmail = (auth.currentUser?.email || employee.email || '').trim().toLowerCase().slice(0, 160);

      if (myReg) {
        await updateDocStrict('faceRegistrations', regId, {
          employeeUid: myUid,
          ...(myEmail ? { employeeEmail: myEmail } : {}),
          status: 'pending_verification',
          consentAccepted: true,
          sampleCount: frames.length,
          qualityScore: Math.max(liveness.qualityScore, template.detectionScore),
          templateDigest: liveness.templateDigest,
          referencePhotoDataUrl: template.thumbnailDataUrl,
          faceDescriptor: template.descriptor,
        });
      } else {
        await createDocStrict('faceRegistrations', regId, {
          registrationId: regId,
          companyId: company.companyId,
          companyOwnerUid: employee.companyOwnerUid || company.companyOwnerUid,
          employeeId: employee.employeeId,
          employeeUid: myUid,
          ...(myEmail ? { employeeEmail: myEmail } : {}),
          employeeName: employee.fullName.slice(0, 120),
          status: 'pending_verification',
          consentAccepted: true,
          sampleCount: frames.length,
          qualityScore: Math.max(liveness.qualityScore, template.detectionScore),
          templateDigest: liveness.templateDigest,
          referencePhotoDataUrl: template.thumbnailDataUrl,
          faceDescriptor: template.descriptor,
        });
      }

      await logAuditEvent({
        companyId: company.companyId,
        companyOwnerUid: employee.companyOwnerUid || company.companyOwnerUid,
        actorUid: myUid,
        actorName: employee.fullName,
        action: 'FACE_ENROLLMENT_SUBMITTED',
        targetCollection: 'faceRegistrations',
        targetId: regId,
        summary: `Submitted ${frames.length} face samples (${template.detectionScore}% clarity) for HR verification.`,
      });

      setFeedback({
        type: 'success',
        text: `Face template captured (${template.detectionScore}% clarity) and submitted for HR approval.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Face enrollment failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleHrAction = async (
    reg: FaceRegistration,
    status: 'approved' | 'rejected' | 're_registration_required',
    note: string
  ) => {
    if (status === 'approved' && (!reg.faceDescriptor || reg.faceDescriptor.length !== 128)) {
      setFeedback({
        type: 'error',
        text: `Cannot approve ${reg.employeeName} without a detected face signature. Upload or capture a reference photo above first.`,
      });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      await updateDocStrict('faceRegistrations', reg.registrationId, {
        status,
        reviewNote: note,
      });
      await logAuditEvent({
        companyId: company.companyId,
        companyOwnerUid: reg.companyOwnerUid,
        actorUid: auth.currentUser?.uid || employee.employeeUid || employee.companyOwnerUid,
        actorName: employee.fullName,
        action: `FACE_ENROLLMENT_${status.toUpperCase()}`,
        targetCollection: 'faceRegistrations',
        targetId: reg.registrationId,
        summary: `HR updated ${reg.employeeName} face status to ${status}.`,
      });
      setFeedback({
        type: 'success',
        text: `Updated ${reg.employeeName} face registration to ${status.replace(/_/g, ' ')}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update face registration.',
      });
    } finally {
      setBusy(false);
    }
  };

  const hasReadyDescriptor = Boolean(myReg?.faceDescriptor && myReg.faceDescriptor.length === 128);

  return (
    <div className="space-y-6 w-full min-w-0">
      <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">Biometric Face Enrollment</h2>
          <p className="text-sm text-slate-600">
            My Status:{' '}
            <span className="font-semibold text-slate-900 capitalize">
              {myReg?.status.replace(/_/g, ' ') || 'Not Registered'}
            </span>
            {myReg?.qualityScore ? ` · Clarity ${myReg.qualityScore}%` : ''}
            {hasReadyDescriptor ? ' · 128-D Face Match Active' : ''}
          </p>
        </div>
        {myReg?.referencePhotoDataUrl && (
          <div className="flex items-center gap-3 shrink-0">
            <img
              src={myReg.referencePhotoDataUrl}
              alt="Enrolled reference face"
              referrerPolicy="no-referrer"
              className="w-12 h-12 rounded-lg object-cover border border-slate-200"
            />
            <div className="text-xs text-slate-500">
              <p className="font-semibold text-slate-700">Reference Photo</p>
              <p>Active on check-in &amp; check-out</p>
            </div>
          </div>
        )}
      </div>

      {feedback && (
        <div
          className={`p-4 rounded-xl border text-sm flex items-start gap-2.5 ${
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

      {canReview && (
        <div
          ref={hrPanelRef}
          className="bg-white border border-indigo-200 rounded-xl p-5 sm:p-6 space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-indigo-600" />
                <h3 className="text-base font-semibold text-slate-900">
                  HR / Admin: Enroll Employee Reference Selfie
                </h3>
              </div>
              <p className="text-xs text-slate-600">
                Step 1: Select an employee and upload a clear photo (JPG/PNG/WebP) or capture via camera.
                Attendance selfies are strictly matched against this approved face.
              </p>
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start sm:self-auto shrink-0">
              <button
                type="button"
                onClick={() => setHrCaptureMode('upload')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  hrCaptureMode === 'upload'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Upload className="w-3.5 h-3.5" />
                Upload Photo
              </button>
              <button
                type="button"
                onClick={() => setHrCaptureMode('camera')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  hrCaptureMode === 'camera'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Camera className="w-3.5 h-3.5" />
                Live Camera
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Select Employee
                </label>
                <select
                  value={selectedTargetEmp.employeeId}
                  onChange={(e) => {
                    setSelectedEmpId(e.target.value);
                    setHrPreparedFace(null);
                  }}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-900"
                >
                  {directoryList.map((emp) => {
                    const reg = registrations.find((r) => r.employeeId === emp.employeeId);
                    const tag =
                      reg?.status === 'approved' && reg.faceDescriptor?.length === 128
                        ? 'Enrolled'
                        : 'Pending Photo';
                    return (
                      <option key={emp.employeeId} value={emp.employeeId}>
                        {emp.fullName} ({emp.employeeCode}) — {tag}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <p className="text-xs font-semibold text-slate-700">
                  Selected Employee Face Status
                </p>
                <div className="flex items-center gap-3">
                  {hrPreparedFace?.thumbnailDataUrl || selectedExistingReg?.referencePhotoDataUrl ? (
                    <img
                      src={
                        hrPreparedFace?.thumbnailDataUrl ||
                        selectedExistingReg?.referencePhotoDataUrl
                      }
                      alt={selectedTargetEmp.fullName}
                      referrerPolicy="no-referrer"
                      className="w-16 h-16 rounded-lg object-cover border border-slate-200 shrink-0"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-lg bg-slate-200 flex items-center justify-center shrink-0">
                      <ScanFace className="w-7 h-7 text-slate-400" />
                    </div>
                  )}
                  <div className="text-xs space-y-0.5 min-w-0">
                    <p className="font-semibold text-slate-900 truncate">
                      {selectedTargetEmp.fullName}
                    </p>
                    <p className="text-slate-500 truncate">{selectedTargetEmp.email}</p>
                    {hrPreparedFace ? (
                      <p className="text-indigo-700 font-semibold">
                        Ready to Save ({hrPreparedFace.detectionScore}% face clarity)
                      </p>
                    ) : selectedExistingReg?.faceDescriptor?.length === 128 ? (
                      <p className="text-emerald-700 font-semibold">
                        Active ({selectedExistingReg.status.replace(/_/g, ' ')})
                      </p>
                    ) : (
                      <p className="text-amber-700 font-medium">
                        No face signature enrolled yet
                      </p>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={busy || !hrPreparedFace}
                  onClick={handleSaveHrReferenceSelfie}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-45 transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {busy ? 'Processing...' : 'Save & Approve Employee Selfie'}
                </button>
              </div>
            </div>

            <div className="lg:col-span-7">
              {hrCaptureMode === 'upload' ? (
                <div className="h-full border-2 border-dashed border-slate-300 rounded-xl p-6 flex flex-col items-center justify-center text-center space-y-3 bg-slate-50">
                  <ImagePlus className="w-10 h-10 text-indigo-500" />
                  <div className="space-y-1 max-w-sm">
                    <p className="text-sm font-semibold text-slate-900">
                      Upload Employee Passport or Selfie Photo
                    </p>
                    <p className="text-xs text-slate-600">
                      Supports PNG, JPG, JPEG, or WebP. Only one clear front-facing human face
                      must appear in the image.
                    </p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    onChange={handleHrFileSelected}
                    className="hidden"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50"
                  >
                    <Upload className="w-4 h-4" />
                    {busy ? 'Analyzing Face...' : 'Choose Employee Image'}
                  </button>
                </div>
              ) : (
                <CameraCapture
                  onCaptureFrames={handleHrCameraFrames}
                  sampleCount={2}
                  buttonLabel={`Capture Reference Selfie for ${selectedTargetEmp.fullName.split(' ')[0]}`}
                  busy={busy}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {canReview && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-900">
              Employee Face Biometrics &amp; Verification Queue
            </h3>
            <span className="text-xs text-slate-500">
              {registrations.filter((r) => r.status === 'approved' && r.faceDescriptor?.length === 128).length}{' '}
              / {directoryList.length} employees face-match ready
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {directoryList.map((emp) => {
              const reg = registrations.find((r) => r.employeeId === emp.employeeId);
              const descriptorReady = Boolean(reg?.faceDescriptor && reg.faceDescriptor.length === 128);
              return (
                <div
                  key={emp.employeeId}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {reg?.referencePhotoDataUrl ? (
                      <img
                        src={reg.referencePhotoDataUrl}
                        alt={emp.fullName}
                        referrerPolicy="no-referrer"
                        className="w-11 h-11 rounded-lg object-cover border border-slate-200 shrink-0"
                      />
                    ) : (
                      <div className="w-11 h-11 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                        <ScanFace className="w-5 h-5 text-slate-400" />
                      </div>
                    )}
                    <div className="space-y-0.5 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {emp.fullName}{' '}
                        <span className="text-xs font-mono font-normal text-slate-500">
                          ({emp.employeeCode})
                        </span>
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {emp.email} ·{' '}
                        <span
                          className={`font-semibold capitalize ${
                            reg?.status === 'approved' && descriptorReady
                              ? 'text-emerald-700'
                              : 'text-amber-700'
                          }`}
                        >
                          {reg ? reg.status.replace(/_/g, ' ') : 'not registered'}
                        </span>
                        {descriptorReady ? ` · Clarity ${reg?.qualityScore || 0}%` : ' · Photo Needed'}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setSelectedEmpId(emp.employeeId);
                        setHrPreparedFace(null);
                        hrPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      {reg ? 'Replace Photo' : 'Enroll Photo'}
                    </button>
                    {reg && (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            handleHrAction(reg, 'approved', 'Verified and approved by HR.')
                          }
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            handleHrAction(
                              reg,
                              're_registration_required',
                              'Please re-capture in brighter lighting.'
                            )
                          }
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-amber-800 bg-amber-100 rounded-lg hover:bg-amber-200"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Re-enroll
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            handleHrAction(reg, 'rejected', 'Identity sample rejected by HR.')
                          }
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100"
                        >
                          <ShieldAlert className="w-3.5 h-3.5" />
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <ScanFace className="w-5 h-5 text-indigo-600" />
            <h3 className="text-base font-semibold text-slate-900">
              {canReview ? 'Self-Enrollment (Current Account)' : 'Submit My Face Samples'}
            </h3>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2 text-xs text-slate-700">
            <p className="font-semibold text-slate-900">Informed Biometric Privacy Consent</p>
            <p>
              Captured frames extract an encrypted 128-point facial signature used strictly to verify
              your identity during check-in and check-out selfies.
            </p>
            <label className="flex items-start gap-2 pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={consentAccepted}
                onChange={(e) => setConsentAccepted(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="font-medium text-slate-900">
                I consent to capturing 3 face samples for attendance identity verification.
              </span>
            </label>
          </div>

          <CameraCapture
            onCaptureFrames={handleSelfEnrollFrames}
            sampleCount={3}
            buttonLabel="Capture 3 Face Samples & Submit"
            busy={busy}
          />
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="text-base font-semibold text-slate-900">How Face Detection Works</h3>
          <ul className="space-y-2.5 text-xs text-slate-600">
            <li className="p-3 bg-slate-50 rounded-lg">
              1. <strong>HR Reference Photo</strong>: HR or Company Admin uploads an employee photo
              or captures a live camera reference, approving the 128-D face template.
            </li>
            <li className="p-3 bg-slate-50 rounded-lg">
              2. <strong>Live Attendance Match</strong>: Every Check-In and Check-Out selfie is
              compared against the enrolled employee face before punch submission.
            </li>
            <li className="p-3 bg-slate-50 rounded-lg">
              3. <strong>Wrong-Person Protection</strong>: If another person scans their face,
              no face is visible, or multiple faces appear, verification fails immediately.
            </li>
          </ul>
          {myReg?.reviewNote && (
            <div className="p-3 border border-slate-200 rounded-lg text-xs text-slate-700">
              <span className="font-semibold">Latest HR Note: </span>
              {myReg.reviewNote}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
