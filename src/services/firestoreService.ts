import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  Unsubscribe,
} from 'firebase/firestore';
import { User } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import {
  UserProfile,
  UserRole,
  Company,
  Employee,
  Shift,
  OfficeLocation,
  AttendanceDevice,
  FaceRegistration,
  AttendanceRecord,
  AttendanceEvent,
  AttendanceCorrection,
  LeaveRequest,
  SalaryStructure,
  PayrollRun,
  Payslip,
  LoanAdvance,
  Reimbursement,
  EmployeeDocument,
  AuditLog,
} from '../types/payroll';

export const COMPANY_ADMIN_EMAIL = 'wavecodeankita@gmail.com';
export const HR_MANAGER_EMAIL = 'ankitakhot012@gmail.com';

export function resolveFixedRoleForEmail(
  email?: string | null,
  emailVerified?: boolean | null
): UserRole {
  if (!emailVerified || !email) return 'employee';
  const normalized = email.trim().toLowerCase();
  if (normalized === COMPANY_ADMIN_EMAIL) return 'company_admin';
  if (normalized === HR_MANAGER_EMAIL) return 'hr_manager';
  return 'employee';
}

export function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  const ts = Date.now().toString(36).toUpperCase();
  return `${prefix}_${ts}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

export function defaultCompanyIdForUid(uid: string): string {
  const tag = uid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) || 'MAIN';
  return `COMP_${tag}`;
}

export async function ensureUserProfile(firebaseUser: User): Promise<UserProfile> {
  const uid = firebaseUser.uid;
  const userRef = doc(db, 'users', uid);
  const fixedRole = resolveFixedRoleForEmail(firebaseUser.email, firebaseUser.emailVerified);
  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const existing = snap.data() as UserProfile;
      if (existing.role !== fixedRole) {
        await updateDoc(userRef, {
          role: fixedRole,
          updatedAt: serverTimestamp(),
        });
        return { ...existing, role: fixedRole };
      }
      return existing;
    }
    const profile: UserProfile = {
      uid,
      email: (firebaseUser.email || 'user@company.local').toLowerCase(),
      displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User',
      role: fixedRole,
      companyId: defaultCompanyIdForUid(uid),
      employeeId: `EMP_${uid.slice(0, 8)}`,
    };
    await setDoc(userRef, {
      ...profile,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return profile;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${uid}`);
  }
}

export async function linkEmployeeWorkspace(firebaseUser: User): Promise<{
  employee: Employee | null;
  company: Company | null;
  shift: Shift | null;
  location: OfficeLocation | null;
}> {
  const uid = firebaseUser.uid;
  const email = (firebaseUser.email || '').trim().toLowerCase();
  try {
    let emp: Employee | null = null;

    const byUidSnap = await getDocs(
      query(collection(db, 'employees'), where('employeeUid', '==', uid))
    );
    if (!byUidSnap.empty) {
      emp = byUidSnap.docs[0].data() as Employee;
    }

    if (!emp && email) {
      const byEmailLower = await getDocs(
        query(collection(db, 'employees'), where('email', '==', email))
      );
      if (!byEmailLower.empty) {
        emp = byEmailLower.docs[0].data() as Employee;
      } else if (firebaseUser.email && firebaseUser.email !== email) {
        const byEmailExact = await getDocs(
          query(collection(db, 'employees'), where('email', '==', firebaseUser.email))
        );
        if (!byEmailExact.empty) {
          emp = byEmailExact.docs[0].data() as Employee;
        }
      }
    }

    if (!emp) {
      return { employee: null, company: null, shift: null, location: null };
    }

    if (emp.employeeUid !== uid) {
      await updateDoc(doc(db, 'employees', emp.employeeId), {
        employeeUid: uid,
        updatedAt: serverTimestamp(),
      });
      emp = { ...emp, employeeUid: uid };
    }

    const userSnap = await getDoc(doc(db, 'users', uid));
    if (userSnap.exists()) {
      const userData = userSnap.data() as UserProfile;
      if (userData.companyId !== emp.companyId || userData.employeeId !== emp.employeeId) {
        await updateDoc(doc(db, 'users', uid), {
          companyId: emp.companyId,
          employeeId: emp.employeeId,
          updatedAt: serverTimestamp(),
        });
      }
    }

    if (email) {
      try {
        const regSnap = await getDocs(
          query(collection(db, 'faceRegistrations'), where('employeeEmail', '==', email))
        );
        await Promise.all(
          regSnap.docs
            .filter((d) => (d.data() as FaceRegistration).employeeUid !== uid)
            .map((d) =>
              updateDoc(doc(db, 'faceRegistrations', d.id), {
                employeeUid: uid,
                updatedAt: serverTimestamp(),
              })
            )
        );
      } catch {
        // Non-fatal: employee may not have a pre-enrolled face registration yet.
      }
    }

    const [compSnap, shiftSnap, locSnap] = await Promise.all([
      getDoc(doc(db, 'companies', emp.companyId)),
      emp.shiftId ? getDoc(doc(db, 'shifts', emp.shiftId)) : Promise.resolve(null),
      emp.workLocationId ? getDoc(doc(db, 'officeLocations', emp.workLocationId)) : Promise.resolve(null),
    ]);

    return {
      employee: emp,
      company: compSnap.exists() ? (compSnap.data() as Company) : null,
      shift: shiftSnap && shiftSnap.exists() ? (shiftSnap.data() as Shift) : null,
      location: locSnap && locSnap.exists() ? (locSnap.data() as OfficeLocation) : null,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `employees/${uid}`);
  }
}

async function createDocIfMissing(
  collectionName: string,
  docId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const ref = doc(db, collectionName, docId);
  try {
    const existing = await getDoc(ref);
    if (!existing.exists()) {
      await setDoc(ref, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `${collectionName}/${docId}`);
  }
}

export async function initializeWorkspaceForUser(
  firebaseUser: User,
  companyName: string,
  companyCode: string,
  latitude: number,
  longitude: number
): Promise<string> {
  const uid = firebaseUser.uid;
  const tag = uid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) || 'MAIN';
  const companyId = `COMP_${tag}`;
  const shiftGeneralId = `SHIFT_GEN_${tag}`;
  const shiftMorningId = `SHIFT_MORN_${tag}`;
  const shiftNightId = `SHIFT_NGT_${tag}`;
  const officeId = `LOC_HQ_${tag}`;
  const empId = `EMP_${uid.slice(0, 8)}`;
  const structId = `SAL_${empId}`;
  const fixedRole = resolveFixedRoleForEmail(firebaseUser.email, firebaseUser.emailVerified);
  const empRole: NonNullable<Employee['role']> =
    fixedRole === 'hr_manager' ? 'hr_manager' : 'company_admin';

  await createDocIfMissing('companies', companyId, {
    companyId,
    name: companyName.trim(),
    code: companyCode.trim().toUpperCase(),
    industry: 'Technology & Enterprise Services',
    plan: 'enterprise',
    status: 'active',
    companyOwnerUid: uid,
    attendancePolicy: {
      enabledMethods: ['selfie_gps', 'face_verification', 'gps', 'qr_code', 'fingerprint', 'manual_hr'],
      faceConfidenceThreshold: 80,
      maxVerificationRetries: 3,
      requireLiveness: true,
      requireGeofence: true,
      allowWfhCheckIn: true,
    },
    statutoryConfig: {
      pfRateEmployee: 0.12,
      pfRateEmployer: 0.125,
      pfWageCeiling: 15000,
      esiEmployeeRate: 0.0075,
      esiEmployerRate: 0.0325,
      esiWageCeiling: 21000,
      ptState: 'Maharashtra',
    },
  });

  await Promise.all([
    createDocIfMissing('officeLocations', officeId, {
      locationId: officeId,
      companyId,
      companyOwnerUid: uid,
      name: `${companyCode.trim().toUpperCase()} Head Office`,
      address: 'Primary Registered Branch',
      latitude,
      longitude,
      radiusMeters: 300,
      allowWfh: true,
    }),
    createDocIfMissing('shifts', shiftGeneralId, {
      shiftId: shiftGeneralId,
      companyId,
      companyOwnerUid: uid,
      name: 'General Shift',
      code: 'GEN',
      shiftType: 'general',
      startTime: '09:30',
      endTime: '18:30',
      breakDurationMinutes: 60,
      gracePeriodMinutes: 15,
      requiredWorkMinutes: 480,
      overtimeEligible: true,
      isNightShift: false,
    }),
    createDocIfMissing('shifts', shiftMorningId, {
      shiftId: shiftMorningId,
      companyId,
      companyOwnerUid: uid,
      name: 'Morning Operations',
      code: 'MORN',
      shiftType: 'morning',
      startTime: '07:00',
      endTime: '16:00',
      breakDurationMinutes: 45,
      gracePeriodMinutes: 10,
      requiredWorkMinutes: 480,
      overtimeEligible: true,
      isNightShift: false,
    }),
    createDocIfMissing('shifts', shiftNightId, {
      shiftId: shiftNightId,
      companyId,
      companyOwnerUid: uid,
      name: 'Night Shift',
      code: 'NGT',
      shiftType: 'night',
      startTime: '22:00',
      endTime: '07:00',
      breakDurationMinutes: 60,
      gracePeriodMinutes: 15,
      requiredWorkMinutes: 480,
      overtimeEligible: true,
      isNightShift: true,
    }),
    createDocIfMissing('employees', empId, {
      employeeId: empId,
      companyId,
      companyOwnerUid: uid,
      employeeUid: uid,
      employeeCode: 'EMP001',
      fullName: firebaseUser.displayName || 'Workspace Administrator',
      email: (firebaseUser.email || 'admin@company.local').toLowerCase(),
      phone: '+91 9800000000',
      department: 'Executive & Operations',
      designation: empRole === 'hr_manager' ? 'HR Manager' : 'Company Administrator',
      shiftId: shiftGeneralId,
      workLocationId: officeId,
      employmentType: 'full_time',
      employmentStatus: 'active',
      joiningDate: new Date().toISOString().slice(0, 10),
      panMasked: 'ABCDE****F',
      uan: '100987654321',
      esiNumber: 'NA',
      bankAccountMasked: 'XXXX-XXXX-4821',
      deviceEmployeeCode: '1001',
      role: empRole,
    }),
    createDocIfMissing('salaryStructures', structId, {
      structureId: structId,
      companyId,
      companyOwnerUid: uid,
      employeeId: empId,
      employeeUid: uid,
      employeeName: firebaseUser.displayName || 'Workspace Administrator',
      basic: 45000,
      hra: 22500,
      da: 0,
      conveyance: 3000,
      medical: 2500,
      specialAllowance: 17000,
      grossMonthly: 90000,
      annualCtc: 1080000,
      pfApplicable: true,
      esiApplicable: false,
      ptApplicable: true,
      taxRegime: 'new',
      effectiveDate: new Date().toISOString().slice(0, 10),
    }),
  ]);

  await logAuditEvent({
    companyId,
    companyOwnerUid: uid,
    actorUid: uid,
    actorName: firebaseUser.displayName || firebaseUser.email || 'Admin',
    action: 'WORKSPACE_INITIALIZED',
    targetCollection: 'companies',
    targetId: companyId,
    summary: `Initialized organization ${companyName} (${companyCode}) with default shifts and HQ geofence.`,
  });

  return companyId;
}

export async function logAuditEvent(input: {
  companyId: string;
  companyOwnerUid: string;
  actorUid: string;
  actorName: string;
  action: string;
  targetCollection: string;
  targetId: string;
  summary: string;
}): Promise<void> {
  const logId = makeId('LOG');
  const authenticatedUid = auth.currentUser?.uid || input.actorUid;
  const actorName = auth.currentUser?.displayName || input.actorName || auth.currentUser?.email || 'User';
  try {
    await setDoc(doc(db, 'auditLogs', logId), {
      logId,
      companyId: input.companyId,
      companyOwnerUid: input.companyOwnerUid,
      actorUid: authenticatedUid,
      actorName,
      action: input.action,
      targetCollection: input.targetCollection,
      targetId: input.targetId,
      summary: input.summary.slice(0, 320),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `auditLogs/${logId}`);
  }
}

export function subscribeCompanyScoped<T>(
  collectionName: string,
  filterField: 'companyOwnerUid' | 'employeeUid',
  filterValue: string,
  onData: (items: T[]) => void
): Unsubscribe {
  const q = query(collection(db, collectionName), where(filterField, '==', filterValue));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => d.data() as T);
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, collectionName);
    }
  );
}

export function subscribeWorkspaceCollection<T>(
  collectionName: string,
  onData: (items: T[]) => void
): Unsubscribe {
  return onSnapshot(
    collection(db, collectionName),
    (snapshot) => {
      const items = snapshot.docs.map((d) => d.data() as T);
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, collectionName);
    }
  );
}

export const subscribeSuperAdminCollection = subscribeWorkspaceCollection;

export async function createDocStrict(
  collectionName: string,
  docId: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    await setDoc(doc(db, collectionName, docId), {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `${collectionName}/${docId}`);
  }
}

export async function createImmutableEvent(
  collectionName: 'attendanceEvents' | 'auditLogs',
  docId: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    await setDoc(doc(db, collectionName, docId), {
      ...data,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `${collectionName}/${docId}`);
  }
}

export async function updateDocStrict(
  collectionName: string,
  docId: string,
  patch: Record<string, unknown>
): Promise<void> {
  try {
    await updateDoc(doc(db, collectionName, docId), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `${collectionName}/${docId}`);
  }
}

export async function deleteDocStrict(collectionName: string, docId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, collectionName, docId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `${collectionName}/${docId}`);
  }
}

export type CollectionMap = {
  companies: Company;
  employees: Employee;
  shifts: Shift;
  officeLocations: OfficeLocation;
  attendanceDevices: AttendanceDevice;
  faceRegistrations: FaceRegistration;
  attendance: AttendanceRecord;
  attendanceEvents: AttendanceEvent;
  attendanceCorrections: AttendanceCorrection;
  leaveRequests: LeaveRequest;
  salaryStructures: SalaryStructure;
  payrollRuns: PayrollRun;
  payslips: Payslip;
  loans: LoanAdvance;
  reimbursements: Reimbursement;
  employeeDocuments: EmployeeDocument;
  auditLogs: AuditLog;
};
