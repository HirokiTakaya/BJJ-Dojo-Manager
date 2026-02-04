// components/PlanLimitBanner.tsx
'use client';

import React from 'react';
import Link from 'next/link';
import { SubscriptionInfo, getUsagePercentage } from '@/hooks/useSubscription';

interface PlanLimitBannerProps {
  subscription: SubscriptionInfo | null;
  dojoId: string;
  resource?: 'members' | 'staff' | 'announcements' | 'classes';
}

export function PlanLimitBanner({ subscription, dojoId, resource }: PlanLimitBannerProps) {
  if (!subscription) return null;

  // Check if any resource is at 80%+ usage
  const resources = resource 
    ? [resource] 
    : (['members', 'staff', 'announcements', 'classes'] as const);
  
  let highestUsage = 0;
  let highestResource = '';

  for (const res of resources) {
    const usage = subscription.usage[res];
    if (usage.limit === -1) continue; // Skip unlimited
    
    const percentage = getUsagePercentage(usage.current, usage.limit);
    if (percentage > highestUsage) {
      highestUsage = percentage;
      highestResource = res;
    }
  }

  // Don't show banner if under 80%
  if (highestUsage < 80) return null;

  const isAtLimit = highestUsage >= 100;
  const usage = subscription.usage[highestResource as keyof typeof subscription.usage];

  return (
    <div
      className={`rounded-lg p-4 mb-4 ${
        isAtLimit
          ? 'bg-red-50 border border-red-200'
          : 'bg-yellow-50 border border-yellow-200'
      }`}
    >
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          {isAtLimit ? (
            <svg
              className="w-5 h-5 text-red-600 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          ) : (
            <svg
              className="w-5 h-5 text-yellow-600 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          )}
          <div>
            <p className={`font-medium ${isAtLimit ? 'text-red-800' : 'text-yellow-800'}`}>
              {isAtLimit
                ? `${highestResource} limit reached (${usage.current}/${usage.limit})`
                : `Approaching ${highestResource} limit (${usage.current}/${usage.limit})`}
            </p>
            <p className={`text-sm ${isAtLimit ? 'text-red-600' : 'text-yellow-600'}`}>
              {isAtLimit
                ? `Upgrade your plan to add more ${highestResource}.`
                : `You're using ${highestUsage}% of your ${highestResource} quota.`}
            </p>
          </div>
        </div>
        <Link
          href={`/dojos/${dojoId}/settings/billing`}
          className={`px-4 py-2 rounded-lg font-medium text-sm whitespace-nowrap ${
            isAtLimit
              ? 'bg-red-600 text-white hover:bg-red-700'
              : 'bg-yellow-600 text-white hover:bg-yellow-700'
          } transition`}
        >
          Upgrade Plan
        </Link>
      </div>
    </div>
  );
}

// Small badge for inline usage
interface UpgradeBadgeProps {
  show: boolean;
  dojoId: string;
  size?: 'sm' | 'md';
}

export function UpgradeBadge({ show, dojoId, size = 'sm' }: UpgradeBadgeProps) {
  if (!show) return null;

  return (
    <Link
      href={`/dojos/${dojoId}/settings/billing`}
      className={`inline-flex items-center gap-1 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-full hover:from-blue-600 hover:to-purple-600 transition ${
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm'
      }`}
    >
      <svg
        className={size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'}
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
      Upgrade
    </Link>
  );
}
