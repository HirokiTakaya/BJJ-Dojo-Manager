// app/dojos/[dojoId]/settings/page.tsx
'use client';

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/providers/AuthProvider';
import Navigation, { BottomNavigation } from '@/components/Navigation';

const GO_API_URL = process.env.NEXT_PUBLIC_GO_API_URL || '';

interface SettingsItem {
  title: string;
  description: string;
  href: string;
  icon: React.ReactNode;
}

export default function SettingsPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const dojoId = typeof params?.dojoId === 'string' ? params.dojoId : '';

  // Promo code state
  const [promoCode, setPromoCode] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoSuccess, setPromoSuccess] = useState('');
  const [promoError, setPromoError] = useState('');

  const handleApplyPromo = async () => {
    if (!promoCode.trim() || !user || !dojoId) return;

    setPromoLoading(true);
    setPromoSuccess('');
    setPromoError('');

    try {
      const token = await user.getIdToken();
      const res = await fetch(`${GO_API_URL}/v1/dojos/${dojoId}/promo-code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: promoCode.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setPromoError(data.error || 'Failed to apply promo code.');
        return;
      }

      setPromoSuccess(data.message || 'Promo code applied successfully!');
      setPromoCode('');
    } catch {
      setPromoError('Network error. Please try again.');
    } finally {
      setPromoLoading(false);
    }
  };

  const settingsItems: SettingsItem[] = [
    {
      title: 'Billing & Plans',
      description: 'Manage your subscription and view usage',
      href: `/dojos/${dojoId}/settings/billing`,
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
          />
        </svg>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-2xl mx-auto px-4 py-8 pb-24">
        {/* Back button */}
        <button
          onClick={() => router.push(`/dojos/${dojoId}/timetable`)}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Dojo
        </button>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-600 mt-2">Manage your dojo settings</p>
        </div>

        {/* Settings List */}
        <div className="space-y-3 mb-8">
          {settingsItems.map((item) => (
            <button
              key={item.href}
              onClick={() => router.push(item.href)}
              className="w-full bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4 hover:bg-gray-50 hover:border-gray-300 transition text-left"
            >
              <div className="w-12 h-12 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600 flex-shrink-0">
                {item.icon}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-gray-900">{item.title}</h3>
                <p className="text-sm text-gray-500">{item.description}</p>
              </div>
              <svg
                className="w-5 h-5 text-gray-400 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))}
        </div>

        {/* Promo Code Section */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center text-purple-600 flex-shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Promo Code</h3>
              <p className="text-sm text-gray-500">Have a promo code? Enter it below to unlock features.</p>
            </div>
          </div>

          <div className="flex gap-3">
            <input
              type="text"
              value={promoCode}
              onChange={(e) => {
                setPromoCode(e.target.value.toUpperCase());
                setPromoError('');
                setPromoSuccess('');
              }}
              placeholder="Enter promo code"
              className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-purple-500"
              disabled={promoLoading}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleApplyPromo();
              }}
            />
            <button
              onClick={handleApplyPromo}
              disabled={promoLoading || !promoCode.trim()}
              className="px-6 py-2.5 bg-purple-600 text-white rounded-xl text-sm font-medium hover:bg-purple-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {promoLoading ? 'Applying...' : 'Apply'}
            </button>
          </div>

          {promoSuccess && (
            <div className="mt-3 flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {promoSuccess}
            </div>
          )}

          {promoError && (
            <div className="mt-3 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              {promoError}
            </div>
          )}
        </div>
      </main>

      <BottomNavigation />
    </div>
  );
}