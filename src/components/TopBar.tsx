import React from 'react';
import { Menu, LogOut } from 'lucide-react';
import { Company, UserProfile, UserRole } from '../types/payroll';

interface TopBarProps {
  title: string;
  userProfile: UserProfile;
  effectiveRole: UserRole;
  companies?: Company[];
  activeCompanyId?: string;
  onSelectCompany?: (companyId: string) => void;
  onOpenMobileMenu: () => void;
  onSignOut: () => void;
}

const ROLE_TEXT: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  company_admin: 'Company Admin',
  hr_manager: 'HR Manager',
  accountant: 'Accountant',
  dept_manager: 'Dept. Manager',
  employee: 'Employee',
};

export const TopBar: React.FC<TopBarProps> = ({
  title,
  userProfile,
  effectiveRole,
  companies = [],
  activeCompanyId,
  onSelectCompany,
  onOpenMobileMenu,
  onSignOut,
}) => {
  const showCompanySwitcher =
    (effectiveRole === 'company_admin' || effectiveRole === 'hr_manager') &&
    companies.length > 1 &&
    Boolean(onSelectCompany);

  return (
    <header className="sticky top-0 z-20 h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Open navigation menu"
          className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 shrink-0"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-semibold text-slate-900 truncate">{title}</h1>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {showCompanySwitcher && (
          <select
            value={activeCompanyId}
            onChange={(e) => onSelectCompany?.(e.target.value)}
            aria-label="Select Workspace"
            className="hidden md:block px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg max-w-[160px]"
          >
            {companies.map((c) => (
              <option key={c.companyId} value={c.companyId}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
        )}
        <div className="hidden sm:block text-right min-w-0">
          <p className="text-sm font-medium text-slate-900 truncate max-w-[180px]">
            {userProfile.displayName}
          </p>
          <p className="text-xs text-slate-500 truncate">
            {ROLE_TEXT[effectiveRole]} · {activeCompanyId || userProfile.companyId}
          </p>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign Out</span>
        </button>
      </div>
    </header>
  );
};
