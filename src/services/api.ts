import { auth } from '../lib/firebase';

async function getAuthHeaders(): Promise<HeadersInit> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('User is not authenticated.');
  }
  const token = await user.getIdToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `API request failed (${res.status})`);
  }
  return data as T;
}

export const backendApi = {
  verifyLocation: (payload: {
    latitude: number;
    longitude: number;
    accuracyMeters?: number;
    allowWfh?: boolean;
    locations: Array<{
      locationId: string;
      name: string;
      latitude: number;
      longitude: number;
      radiusMeters: number;
    }>;
  }) =>
    apiPost<{
      gpsStatus: 'verified' | 'outside_geofence' | 'wfh';
      insideGeofence: boolean;
      distanceMeters: number | null;
      matchedLocationId: string | null;
      matchedLocationName: string;
      serverTimestamp: string;
    }>('/api/attendance/location/verify', payload),

  generateQrToken: (payload: { companyId: string; locationId: string; locationName: string }) =>
    apiPost<{ tokenPayload: string; expiresAt: number; ttlSeconds: number; nonce: string }>(
      '/api/attendance/qr/generate',
      payload
    ),

  verifyQrToken: (payload: { tokenPayload: string; expectedCompanyId: string }) =>
    apiPost<{
      verified: boolean;
      locationId: string;
      locationName: string;
      verificationNonce: string;
      serverTimestamp: string;
    }>('/api/attendance/qr/verify', payload),

  checkFaceLiveness: (payload: { frames: string[]; challengeType?: 'blink_or_turn' | 'multi_frame_capture' }) =>
    apiPost<{
      livenessStatus: 'passed' | 'failed';
      qualityScore: number;
      frameCount: number;
      templateDigest: string;
      livenessToken: string;
      providerMode: string;
      serverTimestamp: string;
    }>('/api/biometric/face/liveness', payload),

  verifyFace: (payload: {
    livenessToken: string;
    frameBase64: string;
    registeredStatus?: string;
    confidenceThreshold?: number;
    attemptCount?: number;
    maxRetries?: number;
    faceDetected: boolean;
    liveDescriptor?: number[];
    registeredDescriptor?: number[];
  }) =>
    apiPost<{
      faceVerification: 'verified' | 'pending_review' | 'failed';
      confidenceScore: number;
      matchDistance?: number;
      verificationNonce: string;
      reason?: string;
      serverTimestamp: string;
    }>('/api/biometric/face/verify', payload),

  calculateWorkingHours: (payload: {
    checkInIso: string;
    checkOutIso: string;
    breakMinutes: number;
    shiftStartTime: string;
    shiftEndTime: string;
    gracePeriodMinutes: number;
    requiredWorkMinutes: number;
    overtimeEligible: boolean;
    isNightShift: boolean;
  }) =>
    apiPost<{
      grossMinutes: number;
      breakMinutes: number;
      netWorkingMinutes: number;
      lateMinutes: number;
      overtimeMinutes: number;
      attendanceStatus: 'checked_out' | 'late' | 'half_day';
    }>('/api/attendance/calculate-hours', payload),

  syncBiometricDevice: (
    deviceId: string,
    payload: {
      protocol?: string;
      events: Array<{
        deviceEmployeeCode: string;
        timestamp: string;
        punchType: 'check_in' | 'check_out' | 'break_start' | 'break_end';
      }>;
      employeeMap: Record<string, { employeeId: string; employeeUid: string; employeeName: string }>;
    }
  ) =>
    apiPost<{
      syncedAt: string;
      totalReceived: number;
      acceptedCount: number;
      failedCount: number;
      accepted: Array<{
        deviceId: string;
        employeeId: string;
        employeeUid: string;
        employeeName: string;
        timestamp: string;
        punchType: 'check_in' | 'check_out' | 'break_start' | 'break_end';
        date: string;
      }>;
      failed: Array<{ deviceEmployeeCode: string; timestamp: string; reason: string }>;
    }>(`/api/biometric/devices/${encodeURIComponent(deviceId)}/sync`, payload),

  calculatePayroll: (payload: {
    month: string;
    ptState: 'Maharashtra' | 'Karnataka' | 'Gujarat' | 'Exempt';
    pfWageCeiling: number;
    esiWageCeiling: number;
    lateMarksPerCut?: number;
    lateCutDaysPerThreshold?: number;
    prorateByAttendanceOnly?: boolean;
    items: Array<{
      employeeId: string;
      employeeUid: string;
      employeeName: string;
      basic: number;
      grossMonthly: number;
      pfApplicable: boolean;
      esiApplicable: boolean;
      ptApplicable: boolean;
      taxRegime: 'new' | 'old';
      paidDays: number;
      unpaidDays: number;
      workingDays: number;
      presentDays: number;
      halfDays: number;
      paidLeaveDays: number;
      unpaidLeaveDays: number;
      absentDays: number;
      lateMarksCount: number;
      overtimeMinutes: number;
      loanEmi: number;
    }>;
  }) =>
    apiPost<{
      month: string;
      totalDaysInMonth: number;
      employeeCount: number;
      totalGross: number;
      totalNet: number;
      totalEmployeePf: number;
      totalEmployerPf: number;
      totalEmployeeEsi: number;
      totalEmployerEsi: number;
      totalPt: number;
      totalTds: number;
      payslips: Array<{
        employeeId: string;
        employeeUid: string;
        employeeName: string;
        month: string;
        paidDays: number;
        unpaidDays: number;
        workingDays: number;
        presentDays: number;
        halfDays: number;
        paidLeaveDays: number;
        unpaidLeaveDays: number;
        absentDays: number;
        lateMarksCount: number;
        lateDeductionDays: number;
        baseMonthlyGross: number;
        leaveDeductionAmount: number;
        lateDeductionAmount: number;
        grossEarnings: number;
        employeePf: number;
        employerPf: number;
        employeeEsi: number;
        employerEsi: number;
        professionalTax: number;
        tds: number;
        loanEmi: number;
        overtimePay: number;
        netSalary: number;
        paymentStatus: 'pending' | 'paid';
      }>;
      calculatedAt: string;
    }>('/api/payroll/calculate', payload),

  calculatePF: (payload: { basicWage: number; wageCeiling?: number; employeeRate?: number }) =>
    apiPost<{
      pfWage: number;
      employeePf: number;
      employerEpf: number;
      employerEps: number;
      employerEdli: number;
      totalEmployerContribution: number;
    }>('/api/pf/calculate', payload),

  calculateESI: (payload: { grossWage: number; wageCeiling?: number }) =>
    apiPost<{
      eligible: boolean;
      employeeEsi: number;
      employerEsi: number;
      totalEsi: number;
    }>('/api/esi/calculate', payload),
};
