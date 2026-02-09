'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';

import { useAuth } from '@/providers/AuthProvider';
import Navigation, { BottomNavigation } from '@/components/Navigation';

const GO_API_URL = process.env.NEXT_PUBLIC_GO_API_URL || '';
const STRIPE_PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '';

const stripePromise = STRIPE_PK ? loadStripe(STRIPE_PK) : null;

type CreateSetupIntentResp = {
  clientSecret: string;
  customerId: string;
};

function PaymentMethodForm({ dojoId }: { dojoId: string }) {
  const router = useRouter();
  const { user } = useAuth();

  const stripe = useStripe();
  const elements = useElements();

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!user || !stripe || !elements) return;

      setSaving(true);
      setErr(null);

      // ✅ Stripeにカードを登録（サーバーにカード番号は行かない）
      const result = await stripe.confirmSetup({
        elements,
        redirect: 'if_required',
      });

      if (result.error) {
        setErr(result.error.message || 'Failed to save card.');
        setSaving(false);
        return;
      }

      const setupIntent = result.setupIntent;
      const pm = typeof setupIntent?.payment_method === 'string' ? setupIntent.payment_method : null;

      if (!pm) {
        setErr('Payment method was not returned. Please try again.');
        setSaving(false);
        return;
      }

      // ✅ Customerの default_payment_method に設定（請求に使えるようにする）
      try {
        const token = await user.getIdToken();
        const res = await fetch(`${GO_API_URL}/v1/stripe/set-default-payment-method`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ dojoId, paymentMethodId: pm }),
        });

        if (!res.ok) throw new Error('failed');

        setDone(true);
        setSaving(false);

        // 戻す（必要ならクエリ付けてトースト表示など）
        setTimeout(() => {
          router.push(`/dojos/${dojoId}/settings/billing?pm_updated=1`);
        }, 700);
      } catch {
        setErr('Saved card, but failed to set as default. Please try again.');
        setSaving(false);
      }
    },
    [user, stripe, elements, dojoId, router]
  );

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
      <h2 className="text-xl font-bold text-gray-900 mb-2">Add / Update Card</h2>
      <p className="text-gray-600 text-sm mb-6">
        Your card details are handled securely by Stripe. We never see or store your card number.
      </p>

      {err && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
          {err}
        </div>
      )}

      {done && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4">
          Card saved!
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <PaymentElement />

        <button
          type="submit"
          disabled={!stripe || !elements || saving}
          className="w-full py-3 rounded-lg font-medium bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save card'}
        </button>
      </form>
    </div>
  );
}

export default function PaymentMethodPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();

  const dojoId = typeof params?.dojoId === 'string' ? params.dojoId : '';

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const options = useMemo(() => (clientSecret ? { clientSecret } : undefined), [clientSecret]);

  const load = useCallback(async () => {
    if (!user || !dojoId) return;

    if (!stripePromise) {
      setErr('Missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setErr(null);

      const token = await user.getIdToken();
      const res = await fetch(`${GO_API_URL}/v1/stripe/create-setup-intent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          dojoId,
          customerEmail: user.email || undefined,
        }),
      });

      if (!res.ok) throw new Error('failed');

      const data: CreateSetupIntentResp = await res.json();
      setClientSecret(data.clientSecret);
      setLoading(false);
    } catch {
      setErr('Failed to start card setup. Please try again.');
      setLoading(false);
    }
  }, [user, dojoId]);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-3xl mx-auto px-4 py-8 pb-24">
        <button
          onClick={() => router.push(`/dojos/${dojoId}/settings/billing`)}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Billing
        </button>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : err ? (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {err}
          </div>
        ) : clientSecret && stripePromise && options ? (
          <Elements stripe={stripePromise} options={options}>
            <PaymentMethodForm dojoId={dojoId} />
          </Elements>
        ) : (
          <div className="text-gray-600">No client secret.</div>
        )}
      </main>

      <BottomNavigation />
    </div>
  );
}
