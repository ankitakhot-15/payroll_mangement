import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { auth, googleProvider } from './lib/firebase';
import {
  ensureUserProfile,
  initializeWorkspaceForUser,
  linkEmployeeWorkspace,
  subscribeCompanyScoped,
  subscribeWorkspaceCollection,
} from './services/firestoreService';
import {
  AttendanceCorrection,
  AttendanceDevice,
  AttendanceRecord,
  AuditLog,
  Company,
  Employee,
  EmployeeDocument,
  FaceRegistration,
  LeaveRequest,
  LoanAdvance,
  OfficeLocation,
  PayrollRun,
  Payslip,
  Reimbursement,
  SalaryStructure,
  Shift,
  UserProfile,
} from './types/payroll';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Sidebar, NavSection } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { LoginScreen } from './pages/LoginScreen';
import { WorkspaceOnboarding } from './pages/WorkspaceOnboarding';
import { DashboardPage } from './pages/DashboardPage';
import { MyAttendancePage } from './pages/MyAttendancePage';
import { FaceRegistrationPage } from './pages/FaceRegistrationPage';
import { AdminAttendancePage } from './pages/AdminAttendancePage';
import { DevicesAndLocationsPage } from './pages/DevicesAndLocationsPage';
import { ShiftsAndLeavesPage } from './pages/ShiftsAndLeavesPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { PayrollAndStatutoryPage } from './pages/PayrollAndStatutoryPage';
import { LoansReimbursementsReportsPage } from './pages/LoansReimbursementsReportsPage';

const SECTION_TITLES: Record<NavSection, string> = {
  dashboard: 'Executive Overview',
  'my-attendance': 'My Attendance & Late Mark Tracker',
  'face-registration': 'Biometric Face Enrollment',
  'admin-attendance': 'Attendance Monitoring, Working Days & Late Marks',
  'devices-locations': 'Fingerprint Devices, Geofences & QR Kiosk',
  'shifts-leaves': 'Shift Scheduling & Leave Management',
  employees: 'Employee Directory & KYC Documents',
  payroll: 'Payroll Engine, Attendance Deductions & Payslips',
  'loans-reimbursements': 'Loans, Advances & Reimbursements',
  'reports-settings': 'Statutory Exports, Policy & Audit Trail',
};

function AppShell() {
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [locations, setLocations] = useState<OfficeLocation[]>([]);
  const [devices, setDevices] = useState<AttendanceDevice[]>([]);
  const [faceRegs, setFaceRegs] = useState<FaceRegistration[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [corrections, setCorrections] = useState<AttendanceCorrection[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [salaryStructures, setSalaryStructures] = useState<SalaryStructure[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([]);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loans, setLoans] = useState<LoanAdvance[]>([]);
  const [reimbursements, setReimbursements] = useState<Reimbursement[]>([]);
  const [documents, setDocuments] = useState<EmployeeDocument[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [dataReady, setDataReady] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setUserProfile(null);
        setCompanies([]);
        setEmployees([]);
        setAuthReady(true);
        setDataReady(false);
        return;
      }
      const profile = await ensureUserProfile(user);
      setUserProfile(profile);
      setActiveSection('dashboard');
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady || !firebaseUser || !userProfile) return;

    const uid = firebaseUser.uid;
    const isOperator = userProfile.role === 'company_admin' || userProfile.role === 'hr_manager';

    if (isOperator) {
      const unsubs = [
        subscribeWorkspaceCollection<Company>('companies', (items) => {
          setCompanies(items);
          setDataReady(true);
        }),
        subscribeWorkspaceCollection<Employee>('employees', setEmployees),
        subscribeWorkspaceCollection<Shift>('shifts', setShifts),
        subscribeWorkspaceCollection<OfficeLocation>('officeLocations', setLocations),
        subscribeWorkspaceCollection<AttendanceDevice>('attendanceDevices', setDevices),
        subscribeWorkspaceCollection<FaceRegistration>('faceRegistrations', setFaceRegs),
        subscribeWorkspaceCollection<AttendanceRecord>('attendance', setAttendance),
        subscribeWorkspaceCollection<AttendanceCorrection>('attendanceCorrections', setCorrections),
        subscribeWorkspaceCollection<LeaveRequest>('leaveRequests', setLeaves),
        subscribeWorkspaceCollection<SalaryStructure>('salaryStructures', setSalaryStructures),
        subscribeWorkspaceCollection<PayrollRun>('payrollRuns', setPayrollRuns),
        subscribeWorkspaceCollection<Payslip>('payslips', setPayslips),
        subscribeWorkspaceCollection<LoanAdvance>('loans', setLoans),
        subscribeWorkspaceCollection<Reimbursement>('reimbursements', setReimbursements),
        subscribeWorkspaceCollection<EmployeeDocument>('employeeDocuments', setDocuments),
        subscribeWorkspaceCollection<AuditLog>('auditLogs', setAuditLogs),
      ];
      return () => unsubs.forEach((u) => u());
    }

    let cancelled = false;
    let unsubs: Array<() => void> = [];

    void (async () => {
      const linked = await linkEmployeeWorkspace(firebaseUser);
      if (cancelled) return;

      setEmployees(linked.employee ? [linked.employee] : []);
      setCompanies(linked.company ? [linked.company] : []);
      setShifts(linked.shift ? [linked.shift] : []);
      setLocations(linked.location ? [linked.location] : []);
      setDevices([]);
      setPayrollRuns([]);
      setAuditLogs([]);

      if (linked.employee && linked.company) {
        unsubs = [
          subscribeCompanyScoped<FaceRegistration>('faceRegistrations', 'employeeUid', uid, setFaceRegs),
          subscribeCompanyScoped<AttendanceRecord>('attendance', 'employeeUid', uid, setAttendance),
          subscribeCompanyScoped<AttendanceCorrection>('attendanceCorrections', 'employeeUid', uid, setCorrections),
          subscribeCompanyScoped<LeaveRequest>('leaveRequests', 'employeeUid', uid, setLeaves),
          subscribeCompanyScoped<SalaryStructure>('salaryStructures', 'employeeUid', uid, setSalaryStructures),
          subscribeCompanyScoped<Payslip>('payslips', 'employeeUid', uid, setPayslips),
          subscribeCompanyScoped<LoanAdvance>('loans', 'employeeUid', uid, setLoans),
          subscribeCompanyScoped<Reimbursement>('reimbursements', 'employeeUid', uid, setReimbursements),
          subscribeCompanyScoped<EmployeeDocument>('employeeDocuments', 'employeeUid', uid, setDocuments),
        ];
      }
      setDataReady(true);
    })();

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [authReady, firebaseUser, userProfile, refreshTick]);

  const handleGoogleSignIn = async () => {
    await signInWithPopup(auth, googleProvider);
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <p className="text-sm font-medium text-slate-600">Connecting to NexusPay workspace...</p>
      </div>
    );
  }

  if (!firebaseUser || !userProfile) {
    return <LoginScreen onGoogleSignIn={handleGoogleSignIn} />;
  }

  if (!dataReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <p className="text-sm font-medium text-slate-600">Loading Firestore workspace...</p>
      </div>
    );
  }

  const effectiveRole = userProfile.role;
  const isOperator = effectiveRole === 'company_admin' || effectiveRole === 'hr_manager';
  const rankedCompanies = [...companies].sort((a, b) => {
    const empDiff =
      employees.filter((e) => e.companyId === b.companyId).length -
      employees.filter((e) => e.companyId === a.companyId).length;
    if (empDiff !== 0) return empDiff;
    const docDiff =
      documents.filter((d) => d.companyId === b.companyId).length -
      documents.filter((d) => d.companyId === a.companyId).length;
    return docDiff;
  });
  const activeCompany =
    (selectedCompanyId ? companies.find((c) => c.companyId === selectedCompanyId) : undefined) ||
    rankedCompanies[0] ||
    companies.find((c) => c.companyOwnerUid === firebaseUser.uid) ||
    companies[0];

  if (!activeCompany) {
    if (isOperator) {
      return (
        <WorkspaceOnboarding
          userEmail={userProfile.email}
          onCreateWorkspace={async (name, code, lat, lng) => {
            await initializeWorkspaceForUser(firebaseUser, name, code, lat, lng);
          }}
        />
      );
    }

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-4">
          <h1 className="text-xl font-semibold text-slate-900">Employee Account Pending Link</h1>
          <p className="text-sm text-slate-600">
            Signed in as <span className="font-mono font-semibold text-slate-800">{userProfile.email}</span> (Employee).
          </p>
          <p className="text-sm text-slate-600">
            Ask your Company Admin or HR Manager to add your email in the Employees directory, then refresh below.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setDataReady(false);
                setRefreshTick((t) => t + 1);
              }}
              className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
            >
              Check Workspace Access
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  const companyEmployees = employees.filter((x) => x.companyId === activeCompany.companyId);
  const companyShifts = shifts.filter((x) => x.companyId === activeCompany.companyId);
  const companyLocations = locations.filter((x) => x.companyId === activeCompany.companyId);
  const companyDevices = devices.filter((x) => x.companyId === activeCompany.companyId);
  const companyFaceRegs = faceRegs.filter((x) => x.companyId === activeCompany.companyId);
  const companyAttendance = attendance.filter((x) => x.companyId === activeCompany.companyId);
  const companyCorrections = corrections.filter((x) => x.companyId === activeCompany.companyId);
  const companyLeaves = leaves.filter((x) => x.companyId === activeCompany.companyId);
  const companySalaryStructures = salaryStructures.filter((x) => x.companyId === activeCompany.companyId);
  const companyPayrollRuns = payrollRuns.filter((x) => x.companyId === activeCompany.companyId);
  const companyPayslips = payslips.filter((x) => x.companyId === activeCompany.companyId);
  const companyLoans = loans.filter((x) => x.companyId === activeCompany.companyId);
  const companyReimbursements = reimbursements.filter((x) => x.companyId === activeCompany.companyId);
  const companyDocuments = documents.filter((x) => x.companyId === activeCompany.companyId);
  const companyAuditLogs = auditLogs.filter((x) => x.companyId === activeCompany.companyId);

  const currentEmployee: Employee =
    companyEmployees.find(
      (e) =>
        e.employeeUid === firebaseUser.uid ||
        e.email.toLowerCase() === userProfile.email.toLowerCase()
    ) || {
      employeeId: userProfile.employeeId || `EMP_${firebaseUser.uid.slice(0, 8)}`,
      companyId: activeCompany.companyId,
      companyOwnerUid: activeCompany.companyOwnerUid,
      employeeUid: firebaseUser.uid,
      employeeCode: effectiveRole === 'hr_manager' ? 'HRM01' : 'ADM01',
      fullName: userProfile.displayName,
      email: userProfile.email,
      department: effectiveRole === 'hr_manager' ? 'Human Resources' : 'Executive',
      designation: effectiveRole === 'hr_manager' ? 'HR Manager' : 'Company Admin',
      employmentStatus: 'active',
    };

  const assignedShift =
    companyShifts.find((s) => s.shiftId === currentEmployee.shiftId) || companyShifts[0];
  const myFaceReg = companyFaceRegs.find((r) => r.employeeId === currentEmployee.employeeId);

  return (
    <div className="min-h-screen bg-slate-50 w-full max-w-full overflow-x-hidden">
      <Sidebar
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        effectiveRole={effectiveRole}
        actualRole={userProfile.role}
        onPreviewRoleChange={() => {}}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        companyName={activeCompany.name}
      />

      <div className="lg:pl-64 min-h-screen flex flex-col min-w-0">
        <TopBar
          title={SECTION_TITLES[activeSection]}
          userProfile={userProfile}
          effectiveRole={effectiveRole}
          companies={companies}
          activeCompanyId={activeCompany.companyId}
          onSelectCompany={setSelectedCompanyId}
          onOpenMobileMenu={() => setMobileOpen(true)}
          onSignOut={handleSignOut}
        />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto min-w-0">
          {activeSection === 'dashboard' && (
            <DashboardPage
              effectiveRole={effectiveRole}
              company={activeCompany}
              employees={companyEmployees}
              attendance={companyAttendance}
              corrections={companyCorrections}
              leaves={companyLeaves}
              payrollRuns={companyPayrollRuns}
              payslips={companyPayslips}
              auditLogs={companyAuditLogs}
              currentEmployee={currentEmployee}
              onNavigate={setActiveSection}
            />
          )}

          {activeSection === 'my-attendance' && (
            <MyAttendancePage
              company={activeCompany}
              employee={currentEmployee}
              shift={assignedShift}
              officeLocations={companyLocations}
              faceRegistration={myFaceReg}
              attendanceRecords={companyAttendance}
              leaves={companyLeaves}
            />
          )}

          {activeSection === 'face-registration' && (
            <FaceRegistrationPage
              company={activeCompany}
              employee={currentEmployee}
              employees={companyEmployees}
              effectiveRole={effectiveRole}
              registrations={companyFaceRegs}
            />
          )}

          {activeSection === 'admin-attendance' && (
            <AdminAttendancePage
              company={activeCompany}
              currentEmployee={currentEmployee}
              employees={companyEmployees}
              attendance={companyAttendance}
              corrections={companyCorrections}
              leaves={companyLeaves}
            />
          )}

          {activeSection === 'devices-locations' && (
            <DevicesAndLocationsPage
              company={activeCompany}
              currentEmployee={currentEmployee}
              employees={companyEmployees}
              devices={companyDevices}
              locations={companyLocations}
            />
          )}

          {activeSection === 'shifts-leaves' && (
            <ShiftsAndLeavesPage
              company={activeCompany}
              currentEmployee={currentEmployee}
              effectiveRole={effectiveRole}
              shifts={companyShifts}
              leaves={companyLeaves}
            />
          )}

          {activeSection === 'employees' && (
            <EmployeesPage
              company={activeCompany}
              currentEmployee={currentEmployee}
              effectiveRole={effectiveRole}
              employees={companyEmployees}
              shifts={companyShifts}
              locations={companyLocations}
              documents={companyDocuments}
            />
          )}

          {activeSection === 'payroll' && (
            <PayrollAndStatutoryPage
              company={activeCompany}
              currentEmployee={currentEmployee}
              effectiveRole={effectiveRole}
              employees={companyEmployees}
              salaryStructures={companySalaryStructures}
              attendance={companyAttendance}
              leaves={companyLeaves}
              loans={companyLoans}
              payrollRuns={companyPayrollRuns}
              payslips={companyPayslips}
            />
          )}

          {(activeSection === 'loans-reimbursements' || activeSection === 'reports-settings') && (
            <LoansReimbursementsReportsPage
              mode={activeSection}
              company={activeCompany}
              currentEmployee={currentEmployee}
              effectiveRole={effectiveRole}
              loans={companyLoans}
              reimbursements={companyReimbursements}
              attendance={companyAttendance}
              payrollRuns={companyPayrollRuns}
              payslips={companyPayslips}
              auditLogs={companyAuditLogs}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  );
}
