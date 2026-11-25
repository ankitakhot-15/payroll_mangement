export type UserRole =
  | 'super_admin'
  | 'company_admin'
  | 'hr_manager'
  | 'accountant'
  | 'dept_manager'
  | 'employee';

export type AttendanceMethod =
  | 'fingerprint'
  | 'selfie_gps'
  | 'face_verification'
  | 'gps'
  | 'qr_code'
  | 'manual_hr';

export type FaceRegistrationStatus =
  | 'not_registered'
  | 'pending_verification'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 're_registration_required';

export type AttendanceStatus =
  | 'present'
  | 'on_break'
  | 'checked_out'
  | 'late'
  | 'half_day'
  | 'absent'
  | 'wfh'
  | 'incomplete';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  companyId: string;
  employeeId?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AttendancePolicyConfig {
  enabledMethods: AttendanceMethod[];
  faceConfidenceThreshold: number;
  maxVerificationRetries: number;
  requireLiveness: boolean;
  requireGeofence: boolean;
  allowWfhCheckIn: boolean;
  lateMarksPerDeduction?: number;
  lateDeductionDaysPerThreshold?: number;
  prorateByAttendanceOnly?: boolean;
}

export interface StatutoryConfig {
  pfRateEmployee: number;
  pfRateEmployer: number;
  pfWageCeiling: number;
  esiEmployeeRate: number;
  esiEmployerRate: number;
  esiWageCeiling: number;
  ptState: 'Maharashtra' | 'Karnataka' | 'Gujarat' | 'Exempt';
}

export interface Company {
  companyId: string;
  name: string;
  code: string;
  industry?: string;
  plan: 'starter' | 'growth' | 'enterprise';
  status: 'active' | 'suspended';
  companyOwnerUid: string;
  attendancePolicy?: AttendancePolicyConfig;
  statutoryConfig?: StatutoryConfig;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Employee {
  employeeId: string;
  companyId: string;
  companyOwnerUid: string;
  employeeUid?: string;
  employeeCode: string;
  fullName: string;
  email: string;
  phone?: string;
  department: string;
  designation: string;
  shiftId?: string;
  workLocationId?: string;
  employmentType?: 'full_time' | 'part_time' | 'contract' | 'intern';
  employmentStatus: 'onboarding' | 'active' | 'notice_period' | 'exited';
  joiningDate?: string;
  panMasked?: string;
  uan?: string;
  esiNumber?: string;
  bankAccountMasked?: string;
  deviceEmployeeCode?: string;
  role?: Exclude<UserRole, 'super_admin'>;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Shift {
  shiftId: string;
  companyId: string;
  companyOwnerUid: string;
  name: string;
  code: string;
  shiftType: 'general' | 'morning' | 'evening' | 'night' | 'flexible' | 'rotational';
  startTime: string;
  endTime: string;
  breakDurationMinutes?: number;
  gracePeriodMinutes?: number;
  requiredWorkMinutes?: number;
  overtimeEligible?: boolean;
  isNightShift?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface OfficeLocation {
  locationId: string;
  companyId: string;
  companyOwnerUid: string;
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  allowWfh?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AttendanceDevice {
  deviceId: string;
  companyId: string;
  companyOwnerUid: string;
  deviceName: string;
  serialNumber: string;
  locationName?: string;
  ipAddress?: string;
  protocol?: string;
  connectionStatus: 'online' | 'offline' | 'syncing';
  lastSyncAt?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface FaceRegistration {
  registrationId: string;
  companyId: string;
  companyOwnerUid: string;
  employeeId: string;
  employeeUid: string;
  employeeEmail?: string;
  employeeName: string;
  status: FaceRegistrationStatus;
  consentAccepted: boolean;
  sampleCount?: number;
  qualityScore?: number;
  templateDigest?: string;
  referencePhotoDataUrl?: string;
  faceDescriptor?: number[];
  reviewNote?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AttendanceRecord {
  attendanceId: string;
  companyId: string;
  companyOwnerUid: string;
  employeeId: string;
  employeeUid: string;
  employeeName: string;
  department?: string;
  date: string;
  attendanceMethod: AttendanceMethod;
  attendanceStatus: AttendanceStatus;
  faceVerification?: 'verified' | 'pending_review' | 'failed' | 'not_required';
  livenessStatus?: 'passed' | 'failed' | 'not_required';
  checkInFaceVerification?: 'verified' | 'pending_review' | 'failed' | 'not_required';
  checkInLivenessStatus?: 'passed' | 'failed' | 'not_required';
  checkInConfidenceScore?: number;
  checkOutFaceVerification?: 'verified' | 'pending_review' | 'failed' | 'not_required';
  checkOutLivenessStatus?: 'passed' | 'failed' | 'not_required';
  checkOutConfidenceScore?: number;
  gpsStatus?: 'verified' | 'outside_geofence' | 'wfh' | 'not_required';
  workingMinutes?: number;
  breakMinutes?: number;
  overtimeMinutes?: number;
  lateMinutes?: number;
  approvalStatus?: 'auto_approved' | 'pending' | 'approved' | 'rejected';
  checkInAt?: string;
  checkOutAt?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AttendanceEvent {
  eventId: string;
  companyId: string;
  companyOwnerUid: string;
  employeeId: string;
  employeeUid: string;
  attendanceId: string;
  eventType: 'check_in' | 'break_start' | 'break_end' | 'check_out' | 'device_punch' | 'qr_punch' | 'manual_adjustment';
  method?: string;
  verificationNonce?: string;
  confidenceScore?: number;
  distanceMeters?: number;
  createdAt?: unknown;
}

export interface AttendanceCorrection {
  correctionId: string;
  companyId: string;
  companyOwnerUid: string;
  employeeId: string;
  employeeUid: string;
  employeeName: string;
  date: string;
  issueType: 'missing_check_in' | 'missing_check_out' | 'wrong_shift' | 'missed_break' | 'location_review' | 'incorrect_status';
  requestedCheckIn?: string;
  requestedCheckOut?: string;
  reason: string;
  reviewNote?: string;
  status: 'pending_manager' | 'pending_hr' | 'approved' | 'rejected';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface LeaveRequest {
  leaveId: string;
  companyId: string;
  companyOwnerUid: string;
  employeeId: string;
  employeeUid: string;
  employeeName: string;
  leaveType: 'casual' | 'sick' | 'earned' | 'privilege' | 'maternity' | 'paternity' | 'comp_off' | 'unpaid';
  startDate: string;
  endDate: string;
  days: number;
  isHalfDay?: boolean;
  reason?: string;
  reviewNote?: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SalaryStructure {
  structureId: string;
  companyId: string;
  companyOwnerUid: string;
  employeeId: string;
  employeeUid?: string;
  employeeName: string;
  basic: number;
  hra?: number;
  da?: number;
  conveyance?: number;
  medical?: number;
  specialAllowance?: number;
  grossMonthly: number;
  annualCtc: number;
  pfApplicable?: boolean;
  esiApplicable?: boolean;
  ptApplicable?: boolean;
  taxRegime?: 'new' | 'old';
  effectiveDate?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PayrollRun {
  runId: string;
  companyId: string;
  companyOwnerUid: string;
  month: string;
  status: 'draft' | 'reviewed' | 'approved' | 'locked';
  employeeCount: number;
  totalGross: number;
  totalNet: number;
  totalEmployeePf?: number;
  totalEmployerPf?: number;
  totalEmployeeEsi?: number;
  totalEmployerEsi?: number;
  totalPt?: number;
  totalTds?: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Payslip {
  payslipId: string;
  runId: string;
  companyId: string;
  companyOwnerUid: string;
  employeeId: string;
  employeeUid: string;
  employeeName: string;
  month: string;
  paidDays?: number;
  unpaidDays?: number;
  workingDays?: number;
  presentDays?: number;
  halfDays?: number;
  paidLeaveDays?: number;
  unpaidLeaveDays?: number;
  absentDays?: number;
  lateMarksCount?: number;
  lateDeductionDays?: number;
  baseMonthlyGross?: number;
  leaveDeductionAmount?: number;
  lateDeductionAmount?: number;
  grossEarnings: number;
  employeePf?: number;
  employerPf?: number;
  employeeEsi?: number;
  employerEsi?: number;
  professionalTax?: number;
  tds?: number;
  loanEmi?: number;
  overtimePay?: number;
  netSalary: number;
  paymentStatus: 'pending' | 'paid';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface LoanAdvance {
  loanId: string;
  companyId: string;
  companyOwnerUid: string;
  employeeId: string;
  employeeUid: string;
  employeeName: string;
  kind: 'loan' | 'salary_advance';
  principalAmount: number;
  monthlyEmi: number;
  outstandingBalance: number;
  reason?: string;
  status: 'pending' | 'approved' | 'rejected' | 'settled';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Reimbursement {
  reimbursementId: string;
  companyId: string;
  companyOwnerUid: string;
  employeeId: string;
  employeeUid: string;
  employeeName: string;
  category: 'travel' | 'food' | 'fuel' | 'medical' | 'accommodation' | 'internet' | 'other';
  amount: number;
  expenseDate: string;
  description?: string;
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface EmployeeDocument {
  docId: string;
  companyId: string;
  companyOwnerUid: string;
  employeeId: string;
  employeeUid: string;
  employeeName: string;
  docType:
    | 'aadhaar'
    | 'pan'
    | 'pf_passbook'
    | 'uan'
    | 'esi'
    | 'bank_proof'
    | 'passport'
    | 'driving_license'
    | 'photo_id'
    | 'resume'
    | 'educational'
    | 'offer_letter'
    | 'appointment_letter'
    | 'experience_letter'
    | 'relieving_letter'
    | 'form_16'
    | 'other';
  fileName: string;
  mimeType?: string;
  fileSizeBytes?: number;
  fileDataUrl?: string;
  documentNumber?: string;
  reviewNote?: string;
  status: 'pending_verification' | 'approved' | 'rejected' | 'expired';
  expiryDate?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AuditLog {
  logId: string;
  companyId: string;
  companyOwnerUid: string;
  actorUid: string;
  actorName: string;
  action: string;
  targetCollection: string;
  targetId: string;
  summary: string;
  createdAt?: unknown;
}
