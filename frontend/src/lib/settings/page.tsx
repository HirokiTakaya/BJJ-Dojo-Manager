// app/dojos/[dojoId]/settings/page.tsx
'use client';

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import Navigation, { BottomNavigation } from '@/components/Navigation';

interface SettingsItem {
  title: string;
  description: string;
  href: string;
  icon: React.ReactNode;
}

export default function SettingsPage() {
  const params = useParams();
  const router = useRouter();
  const dojoId = typeof params?.dojoId === 'string' ? params.dojoId : '';

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
    // Add more settings items here as needed
    // {
    //   title: 'Dojo Profile',
    //   description: 'Update dojo name, location, and details',
    //   href: `/dojos/${dojoId}/settings/profile`,
    //   icon: (...)
    // },
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
        <div className="space-y-3">
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
      </main>

      <BottomNavigation />
    </div>
  );
}
