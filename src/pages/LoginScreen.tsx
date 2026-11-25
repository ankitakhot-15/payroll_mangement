import React, { useState } from 'react';
import { ShieldCheck, Fingerprint, IndianRupee, MapPin, ArrowRight } from 'lucide-react';

interface LoginScreenProps {
  onGoogleSignIn: () => Promise<void>;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onGoogleSignIn }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSignIn = async () => {
    setLoading(true);
    setError('');
    try {
      await onGoogleSignIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete Google sign-in.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row w-full overflow-x-hidden">
      <div className="lg:w-1/2 bg-slate-900 text-white p-8 sm:p-12 lg:p-16 flex flex-col justify-between">
        <div>
          <p className="text-lg font-bold tracking-tight text-white">NexusPay</p>
        </div>

        <div className="my-10 lg:my-0 space-y-6 max-w-lg">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white [text-wrap:balance]">
            Enterprise Payroll &amp; Biometric Attendance
          </h1>
          <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
            Unified attendance verification, shift scheduling, Indian statutory compliance (EPF, ESI,
            Professional Tax, TDS), and automated monthly payroll processing.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="border border-slate-800 rounded-xl p-4 space-y-1.5">
              <Fingerprint className="w-5 h-5 text-indigo-400" />
              <p className="text-sm font-semibold text-white">Check-In &amp; Check-Out Selfie</p>
              <p className="text-xs text-slate-400">
                Live selfie liveness &amp; GPS verification required on both check-in and check-out.
              </p>
            </div>
            <div className="border border-slate-800 rounded-xl p-4 space-y-1.5">
              <IndianRupee className="w-5 h-5 text-indigo-400" />
              <p className="text-sm font-semibold text-white">Statutory Payroll Engine</p>
              <p className="text-xs text-slate-400">
                Automated EPF, ESI, Maharashtra PT slabs, TDS, and PDF payslips.
              </p>
            </div>
            <div className="border border-slate-800 rounded-xl p-4 space-y-1.5">
              <MapPin className="w-5 h-5 text-indigo-400" />
              <p className="text-sm font-semibold text-white">Event-Only Privacy</p>
              <p className="text-xs text-slate-400">
                Location is captured strictly during punch events—never tracked silently.
              </p>
            </div>
            <div className="border border-slate-800 rounded-xl p-4 space-y-1.5">
              <ShieldCheck className="w-5 h-5 text-indigo-400" />
              <p className="text-sm font-semibold text-white">Fixed Role Access</p>
              <p className="text-xs text-slate-400">
                Dedicated Company Admin, HR Manager, and Employee portals by verified account.
              </p>
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-400">
          Firebase Authentication &amp; Firestore Verified Workspace
        </p>
      </div>

      <div className="lg:w-1/2 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
          <div className="space-y-1.5">
            <h2 className="text-xl font-semibold text-slate-900">Sign in to your workspace</h2>
            <p className="text-sm text-slate-600">
              Authenticate with your verified Google account. Your role is assigned automatically.
            </p>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
              {error}
            </div>
          )}

          <button
            type="button"
            disabled={loading}
            onClick={handleSignIn}
            className="w-full inline-flex items-center justify-center gap-3 px-4 py-3 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            <span>{loading ? 'Authenticating...' : 'Continue with Google'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
