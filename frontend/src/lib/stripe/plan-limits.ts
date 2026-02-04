// lib/stripe/plan-limits.ts

import { PLANS, PlanType } from './config';

export interface ResourceUsage {
  current: number;
  limit: number;
}

export interface SubscriptionInfo {
  plan: PlanType;
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | 'none';
  periodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
  usage: {
    members: ResourceUsage;
    staff: ResourceUsage;
    announcements: ResourceUsage;
    classes: ResourceUsage;
  };
}

/**
 * Check if user can add more of a resource
 */
export function canAdd(
  info: SubscriptionInfo,
  resource: 'members' | 'staff' | 'announcements' | 'classes'
): boolean {
  const usage = info.usage[resource];
  // -1 means unlimited
  if (usage.limit === -1) return true;
  return usage.current < usage.limit;
}

/**
 * Get remaining capacity for a resource
 */
export function getRemaining(
  info: SubscriptionInfo,
  resource: 'members' | 'staff' | 'announcements' | 'classes'
): number | 'unlimited' {
  const usage = info.usage[resource];
  if (usage.limit === -1) return 'unlimited';
  return Math.max(0, usage.limit - usage.current);
}

/**
 * Get usage percentage (0-100)
 */
export function getUsagePercentage(current: number, limit: number): number {
  if (limit === -1) return 0; // unlimited
  if (limit === 0) return 100;
  return Math.min(100, Math.round((current / limit) * 100));
}

/**
 * Format limit for display
 */
export function formatLimit(limit: number): string {
  if (limit === -1) return 'Unlimited';
  return limit.toString();
}

/**
 * Get upgrade recommendation based on usage
 */
export function getUpgradeRecommendation(info: SubscriptionInfo): PlanType | null {
  const { plan, usage } = info;
  
  // Already on business - no upgrade available
  if (plan === 'business') return null;
  
  // Check if approaching limits (80%+)
  const resources = ['members', 'staff', 'announcements', 'classes'] as const;
  
  for (const resource of resources) {
    const { current, limit } = usage[resource];
    if (limit !== -1) {
      const percentage = getUsagePercentage(current, limit);
      if (percentage >= 80) {
        // Recommend next tier
        return plan === 'free' ? 'pro' : 'business';
      }
    }
  }
  
  return null;
}

/**
 * Check if user needs upgrade for a specific action
 */
export function needsUpgradeFor(
  info: SubscriptionInfo,
  resource: 'members' | 'staff' | 'announcements' | 'classes',
  additionalCount: number = 1
): PlanType | null {
  const usage = info.usage[resource];
  
  // Unlimited
  if (usage.limit === -1) return null;
  
  // Check if adding would exceed limit
  if (usage.current + additionalCount > usage.limit) {
    const { plan } = info;
    if (plan === 'free') return 'pro';
    if (plan === 'pro') return 'business';
    return null; // Already on highest plan
  }
  
  return null;
}

/**
 * Get limit for a resource based on plan
 */
export function getPlanLimit(
  plan: PlanType,
  resource: 'members' | 'staff' | 'announcements' | 'classes'
): number {
  return PLANS[plan].limits[resource];
}
