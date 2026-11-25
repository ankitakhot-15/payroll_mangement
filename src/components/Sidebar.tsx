import React from 'react';
import {
  LayoutDashboard,
  Clock,
  ScanFace,
  Users,
  CalendarDays,
  Fingerprint,
  IndianRupee,
  Wallet,
  FileBarChart2,
  X,
  ShieldCheck,
} from 'lucide-react';
import { UserRole } from '../types/payroll';

export type NavSection =
  | 'dashboard'
  | 'my-attendance'
  | 'face-registration'
  | 'admin-attendance'
  | 'devices-locations'
  | 'shifts-leaves'
  | 'employees'
  | 'payroll'
  | 'loans-reimbursements'
  | 'reports-settings';

interface SidebarProps {
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  effectiveRole: UserRole;
  actualRole: UserRole;
  onPreviewRoleChange: (role: UserRole) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  companyName: string;
}

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  company_admin: 'Company Admin',
  hr_manager: 'HR Manager',
  accountant: 'Accountant',
  dept_manager: 'Dept. Manager',
  employee: 'Employee',
};

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSelectSection,
  effectiveRole,
  actualRole,
  onPreviewRoleChange,
  mobileOpen,
  onCloseMobile,
  companyName,
}) => {
  const isAdminOrHr = ['super_admin', 'company_admin', 'hr_manager'].includes(effectiveRole);
  const isManager = effectiveRole === 'dept_manager';
  const isAccountant = ['super_admin', 'company_admin', 'accountant'].includes(effectiveRole);

  const navItems: Array<{ id: NavSection; label: string; icon: React.ReactNode; visible: boolean }> = [
    { id: 'dashboard', label: 'Overview', icon: <LayoutDashboard className="w-4 h-4" />, visible: true },
    { id: 'my-attendance', label: 'My Attendance', icon: <Clock className="w-4 h-4" />, visible: true },
    { id: 'face-registration', label: 'Face Enrollment', icon: <ScanFace className="w-4 h-4" />, visible: true },
    {
      id: 'admin-attendance',
      label: 'Attendance Monitor',
      icon: <ShieldCheck className="w-4 h-4" />,
      visible: isAdminOrHr || isManager,
    },
    {
      id: 'devices-locations',
      label: 'Devices & Geofence',
      icon: <Fingerprint className="w-4 h-4" />,
      visible: isAdminOrHr,
    },
    {
      id: 'shifts-leaves',
      label: 'Shifts & Leave',
      icon: <CalendarDays className="w-4 h-4" />,
      visible: true,
    },
    {
      id: 'employees',
      label: isAdminOrHr || isManager ? 'Employees & KYC Docs' : 'My KYC & Docs',
      icon: <Users className="w-4 h-4" />,
      visible: true,
    },
    {
      id: 'payroll',
      label: 'Payroll & Statutory',
      icon: <IndianRupee className="w-4 h-4" />,
      visible: isAccountant || effectiveRole === 'employee' || isAdminOrHr,
    },
    {
      id: 'loans-reimbursements',
      label: 'Loans & Expenses',
      icon: <Wallet className="w-4 h-4" />,
      visible: true,
    },
    {
      id: 'reports-settings',
      label: 'Reports & Settings',
      icon: <FileBarChart2 className="w-4 h-4" />,
      visible: isAdminOrHr || isAccountant || isManager,
    },
  ];

  const handleNav = (id: NavSection) => {
    onSelectSection(id);
    onCloseMobile();
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-slate-900 text-slate-100 select-none">
      <div className="h-16 px-5 flex items-center justify-between border-b border-slate-800 shrink-0">
        <div className="min-w-0">
          <p className="text-base font-bold tracking-tight text-white truncate">NexusPay</p>
          <p className="text-xs text-slate-400 truncate">{companyName || 'Enterprise HRMS'}</p>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation menu"
          className="lg:hidden p-1.5 text-slate-400 hover:text-white rounded-lg"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {navItems
          .filter((item) => item.visible)
          .map((item) => {
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
                  active
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <span className="shrink-0">{item.icon}</span>
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
      </nav>

      <div className="p-4 border-t border-slate-800 space-y-1 shrink-0">
        <p className="text-[11px] uppercase tracking-wider text-slate-500">Assigned Portal Role</p>
        <p className="text-xs font-semibold text-slate-200">{ROLE_LABELS[effectiveRole]}</p>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:w-64 lg:block z-30">
        {sidebarContent}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative w-72 max-w-[85vw] h-full z-10">{sidebarContent}</aside>
        </div>
      )}
    </>
  );
};
