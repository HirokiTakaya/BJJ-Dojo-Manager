// lib/stripe/config.ts

export type PlanType = 'free' | 'pro' | 'business';
export type BillingPeriod = 'monthly' | 'yearly';

export interface PlanFeature {
  name: string;
  free: string | boolean;
  pro: string | boolean;
  business: string | boolean;
}

export interface PlanConfig {
  name: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  popular?: boolean;
  limits: {
    members: number;
    staff: number;
    announcements: number;
    classes: number;
  };
  features: string[];
}

export const PLANS: Record<PlanType, PlanConfig> = {
  free: {
    name: 'Free',
    description: 'Perfect for trying out or small dojos',
    monthlyPrice: 0,
    yearlyPrice: 0,
    limits: {
      members: 20,
      staff: 2,
      announcements: 3,
      classes: 5,
    },
    features: [
      'Up to 20 members',
      'Up to 2 staff accounts',
      'Up to 3 active announcements',
      'Up to 5 classes/week',
      'Basic scheduling',
      'Member directory',
      'Email support',
    ],
  },
  pro: {
    name: 'Pro',
    description: 'For growing dojos with daily operations',
    monthlyPrice: 49,
    yearlyPrice: 490, // ~17% discount
    popular: true,
    limits: {
      members: 150,
      staff: 10,
      announcements: 20,
      classes: 30,
    },
    features: [
      'Up to 150 members',
      'Up to 10 staff accounts',
      'Up to 20 active announcements',
      'Up to 30 classes/week',
      'Advanced scheduling',
      'Attendance tracking',
      'Member analytics',
      'Priority email support',
    ],
  },
  business: {
    name: 'Business',
    description: 'For large dojos & multi-location',
    monthlyPrice: 179,
    yearlyPrice: 1790, // ~17% discount
    limits: {
      members: -1, // unlimited
      staff: -1, // unlimited
      announcements: -1, // unlimited
      classes: -1, // unlimited
    },
    features: [
      'Unlimited members',
      'Unlimited staff accounts',
      'Unlimited announcements',
      'Unlimited classes',
      'Multi-location support',
      'Role-based permissions',
      'Advanced analytics & reports',
      'API access',
      'Dedicated support',
      'Custom onboarding',
    ],
  },
};

// Feature comparison table for pricing page
export const FEATURE_COMPARISON: PlanFeature[] = [
  { name: 'Members', free: '20', pro: '150', business: 'Unlimited' },
  { name: 'Staff accounts', free: '2', pro: '10', business: 'Unlimited' },
  { name: 'Announcements', free: '3', pro: '20', business: 'Unlimited' },
  { name: 'Classes per week', free: '5', pro: '30', business: 'Unlimited' },
  { name: 'Scheduling', free: 'Basic', pro: 'Advanced', business: 'Advanced' },
  { name: 'Attendance tracking', free: false, pro: true, business: true },
  { name: 'Member analytics', free: false, pro: true, business: true },
  { name: 'Multi-location', free: false, pro: false, business: true },
  { name: 'Role-based permissions', free: false, pro: false, business: true },
  { name: 'API access', free: false, pro: false, business: true },
  { name: 'Support', free: 'Email', pro: 'Priority', business: 'Dedicated' },
];

// Stripe Price IDs (set in environment variables)
export const STRIPE_PRICES = {
  pro: {
    monthly: process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO_MONTHLY || '',
    yearly: process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO_YEARLY || '',
  },
  business: {
    monthly: process.env.NEXT_PUBLIC_STRIPE_PRICE_BUSINESS_MONTHLY || '',
    yearly: process.env.NEXT_PUBLIC_STRIPE_PRICE_BUSINESS_YEARLY || '',
  },
};

export function formatPrice(amount: number, period?: BillingPeriod): string {
  if (amount === 0) return 'Free';
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(amount);
  
  if (period === 'yearly') {
    return `${formatted}/year`;
  }
  return `${formatted}/mo`;
}

export function getYearlyDiscount(plan: PlanType): number {
  if (plan === 'free') return 0;
  const config = PLANS[plan];
  const monthlyTotal = config.monthlyPrice * 12;
  const savings = monthlyTotal - config.yearlyPrice;
  return Math.round((savings / monthlyTotal) * 100);
}
