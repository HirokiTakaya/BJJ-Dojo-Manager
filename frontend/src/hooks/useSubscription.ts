// hooks/useSubscription.ts
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/providers/AuthProvider';

const GO_API_URL = process.env.NEXT_PUBLIC_GO_API_URL || '';

export interface ResourceUsage {
  current: number;
  limit: number;
}

export interface UsageInfo {
  members: ResourceUsage;
  staff: ResourceUsage;
  announcements: ResourceUsage;
  classes: ResourceUsage;
}

export interface SubscriptionInfo {
  plan: 'free' | 'pro' | 'business';
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | 'none';
  periodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  usage: UsageInfo;
}

interface UseSubscriptionReturn {
  subscription: SubscriptionInfo | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useSubscription(dojoId: string): UseSubscriptionReturn {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSubscription = useCallback(async () => {
    if (!user || !dojoId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const token = await user.getIdToken();
      const res = await fetch(`${GO_API_URL}/v1/dojos/${dojoId}/subscription`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.ok) {
        const data = await res.json();
        setSubscription(data);
      } else if (res.status === 404) {
        // No subscription - default to free
        setSubscription({
          plan: 'free',
          status: 'none',
          usage: {
            members: { current: 0, limit: 20 },
            staff: { current: 0, limit: 2 },
            announcements: { current: 0, limit: 3 },
            classes: { current: 0, limit: 5 },
          },
        });
      } else {
        throw new Error('Failed to fetch subscription');
      }
    } catch (err) {
      console.error('Failed to fetch subscription:', err);
      setError('Failed to load subscription info');
      // Default to free on error
      setSubscription({
        plan: 'free',
        status: 'none',
        usage: {
          members: { current: 0, limit: 20 },
          staff: { current: 0, limit: 2 },
          announcements: { current: 0, limit: 3 },
          classes: { current: 0, limit: 5 },
        },
      });
    } finally {
      setLoading(false);
    }
  }, [user, dojoId]);

  useEffect(() => {
    fetchSubscription();
  }, [fetchSubscription]);

  return {
    subscription,
    loading,
    error,
    refresh: fetchSubscription,
  };
}

// Utility functions

export function canAdd(subscription: SubscriptionInfo | null, resource: keyof UsageInfo): boolean {
  if (!subscription) return true;
  const usage = subscription.usage[resource];
  if (usage.limit === -1) return true; // Unlimited
  return usage.current < usage.limit;
}

export function getRemaining(subscription: SubscriptionInfo | null, resource: keyof UsageInfo): number | 'unlimited' {
  if (!subscription) return 'unlimited';
  const usage = subscription.usage[resource];
  if (usage.limit === -1) return 'unlimited';
  return Math.max(0, usage.limit - usage.current);
}

export function getUsagePercentage(current: number, limit: number): number {
  if (limit === -1) return 0;
  if (limit === 0) return 100;
  return Math.min(100, Math.round((current / limit) * 100));
}

export function formatLimit(limit: number): string {
  if (limit === -1) return 'Unlimited';
  return limit.toString();
}
