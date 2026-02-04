// components/UpgradeBadge.tsx
//
// A small badge to show when a feature requires upgrade
//
// Usage:
// <UpgradeBadge plan="pro" feature="Unlimited members" />

'use client';

import { PlanType, PLANS } from '@/lib/stripe/config';

interface UpgradeBadgeProps {
  plan: PlanType;
  feature?: string;
  size?: 'sm' | 'md';
}

export function UpgradeBadge({ plan, feature, size = 'sm' }: UpgradeBadgeProps) {
  const planInfo = PLANS[plan];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${
        size === 'sm'
          ? 'px-2 py-0.5 text-xs'
          : 'px-3 py-1 text-sm'
      } ${
        plan === 'pro'
          ? 'bg-blue-100 text-blue-700'
          : 'bg-purple-100 text-purple-700'
      }`}
      title={feature ? `${feature} requires ${planInfo.name} plan` : undefined}
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
          d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
        />
      </svg>
      {planInfo.name}
    </span>
  );
}

export default UpgradeBadge;
