'use client';
import React from 'react';

type Props = {
  status?: string | null;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
};

export const StatusBadge: React.FC<Props> = ({ status, title, className, style }) => {
  const raw = String(status ?? '').trim();
  if (!raw) return null;

  const key = raw.replace(/[\s_-]+/g, '').toLowerCase();

  const ACTIVE = new Set([
    'active', 'sent', 'live', 'inprogress', 'ongoing', 'current'
  ]);
  const UPCOMING = new Set([
    'upcoming', 'scheduled', 'future', 'pending'
  ]);
  const COMPLETE = new Set([
    'complete', 'completed', 'done', 'archived', 'expired', 'past', 'closed'
  ]);

  const normalized: 'active' | 'upcoming' | 'complete' | null =
    ACTIVE.has(key) ? 'active' :
    UPCOMING.has(key) ? 'upcoming' :
    COMPLETE.has(key) ? 'complete' :
    null;

  if (!normalized) return null;

  const config = {
    active: {
      label: 'Active',
      dotColor: '#22c55e',
      bgColor: '#f0fdf4',
      textColor: '#166534',
    },
    upcoming: {
      label: 'Upcoming',
      dotColor: '#f59e0b',
      bgColor: '#fffbeb',
      textColor: '#92400e',
    },
    complete: {
      label: 'Complete',
      dotColor: '#94a3b8',
      bgColor: '#f8fafc',
      textColor: '#64748b',
    },
  };

  const { label, dotColor, bgColor, textColor } = config[normalized];

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 12px',
        borderRadius: '20px',
        fontSize: '12px',
        fontWeight: 600,
        background: bgColor,
        color: textColor,
        ...style,
      }}
      aria-label={label}
      title={title ?? label}
    >
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: dotColor,
          boxShadow: normalized === 'active'
            ? `0 0 0 2px ${bgColor}, 0 0 0 3px ${dotColor}40`
            : 'none',
        }}
      />
      {label}
    </span>
  );
};