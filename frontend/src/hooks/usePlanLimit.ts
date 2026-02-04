// hooks/usePlanLimit.ts
'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/providers/AuthProvider';

const GO_API_URL = process.env.NEXT_PUBLIC_GO_API_URL || '';

interface PlanLimitResult {
  allowed: boolean;
  error?: string;
}

interface UsePlanLimitReturn {
  checkLimit: (dojoId: string, resource: 'member' | 'staff' | 'announcement' | 'class') => Promise<boolean>;
  loading: boolean;
  showUpgradeModal: boolean;
  limitMessage: string | null;
  closeModal: () => void;
  UpgradeModal: React.FC;
}

export function usePlanLimit(): UsePlanLimitReturn {
  const { user } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [limitMessage, setLimitMessage] = useState<string | null>(null);
  const [currentDojoId, setCurrentDojoId] = useState<string>('');

  const checkLimit = useCallback(
    async (dojoId: string, resource: 'member' | 'staff' | 'announcement' | 'class'): Promise<boolean> => {
      if (!user) return true; // Allow if no user (fail open)

      setLoading(true);
      setCurrentDojoId(dojoId);

      try {
        const token = await user.getIdToken();
        const res = await fetch(`${GO_API_URL}/v1/dojos/${dojoId}/plan-limit/${resource}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data: PlanLimitResult = await res.json();

        if (!data.allowed) {
          setLimitMessage(data.error || `${resource} limit reached. Upgrade your plan to add more.`);
          setShowUpgradeModal(true);
          return false;
        }

        return true;
      } catch (err) {
        console.error('Failed to check plan limit:', err);
        // Fail open - allow action if check fails
        return true;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  const closeModal = useCallback(() => {
    setShowUpgradeModal(false);
    setLimitMessage(null);
  }, []);

  const goToBilling = useCallback(() => {
    closeModal();
    router.push(`/dojos/${currentDojoId}/settings/billing`);
  }, [router, currentDojoId, closeModal]);

  // Upgrade Modal Component
  const UpgradeModal: React.FC = () => {
    if (!showUpgradeModal) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/50"
          onClick={closeModal}
        />

        {/* Modal */}
        <div className="relative bg-white rounded-2xl shadow-xl max-w-md w-full mx-4 p-6">
          {/* Icon */}
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center">
              <svg
                className="w-8 h-8 text-orange-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
          </div>

          {/* Title */}
          <h3 className="text-xl font-bold text-center text-gray-900 mb-2">
            Plan Limit Reached
          </h3>

          {/* Message */}
          <p className="text-center text-gray-600 mb-6">
            {limitMessage}
          </p>

          {/* Benefits */}
          <div className="bg-gray-50 rounded-lg p-4 mb-6">
            <p className="text-sm font-medium text-gray-900 mb-2">
              Upgrade to unlock:
            </p>
            <ul className="space-y-2">
              <li className="flex items-center gap-2 text-sm text-gray-600">
                <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                More members & staff
              </li>
              <li className="flex items-center gap-2 text-sm text-gray-600">
                <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                More classes & announcements
              </li>
              <li className="flex items-center gap-2 text-sm text-gray-600">
                <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Advanced features
              </li>
            </ul>
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={closeModal}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition"
            >
              Maybe Later
            </button>
            <button
              onClick={goToBilling}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition"
            >
              View Plans
            </button>
          </div>
        </div>
      </div>
    );
  };

  return {
    checkLimit,
    loading,
    showUpgradeModal,
    limitMessage,
    closeModal,
    UpgradeModal,
  };
}
