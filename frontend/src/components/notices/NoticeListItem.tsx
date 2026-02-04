'use client';
import React, { useMemo, useState } from 'react';
import { StatusBadge } from './StatusBadge';

export type NoticeListItemProps = {
  titleLeft: string;     // "Notice" / "Memo"
  titleMain: string;     // subject
  dateText?: string;     // range
  status?: string;
  onClick?: () => void;
  disabled?: boolean;
};

// Type accent colors
const typeAccent: Record<string, string> = {
  announcement: '#0ea5e9',
  notice: '#0ea5e9',
  'gym update': '#8b5cf6',
  memo: '#8b5cf6',
};

export const NoticeListItem: React.FC<NoticeListItemProps> = ({
  titleLeft,
  titleMain,
  dateText,
  status,
  onClick,
  disabled,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const accentColor = useMemo(() => {
    const key = titleLeft.toLowerCase();
    return typeAccent[key] || '#0ea5e9';
  }, [titleLeft]);

  const badgeStatus = useMemo(() => {
    const s = String(status ?? '').trim().toLowerCase();
    if (['active', 'sent', 'live', 'inprogress', 'ongoing', 'current'].includes(s)) return 'active';
    if (['upcoming', 'scheduled', 'future', 'pending'].includes(s)) return 'upcoming';
    if (['complete', 'completed', 'done', 'archived', 'expired', 'past', 'closed'].includes(s)) return 'complete';
    return undefined;
  }, [status]);

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      disabled={disabled}
      className="w-full text-left bg-white rounded-xl overflow-hidden transition-all duration-200"
      style={{
        display: 'grid',
        gridTemplateColumns: '4px 1fr auto',
        border: '1px solid #e2e8f0',
        boxShadow: isHovered && !disabled
          ? '0 8px 24px -4px rgba(0,0,0,0.1), 0 0 0 1px rgba(0,0,0,0.05)'
          : '0 1px 3px rgba(0,0,0,0.04)',
        transform: isHovered && !disabled ? 'translateY(-2px)' : 'translateY(0)',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {/* Left Accent Line */}
      <div
        style={{
          background: accentColor,
          borderRadius: '12px 0 0 12px',
        }}
      />

      {/* Main Content */}
      <div style={{ padding: '20px 24px' }}>
        {/* Top: Type & Date */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '8px',
        }}>
          <span style={{
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
            color: accentColor,
          }}>
            {titleLeft}
          </span>
          {dateText && (
            <>
              <span style={{
                width: '3px',
                height: '3px',
                borderRadius: '50%',
                background: '#cbd5e1',
              }} />
              <span style={{
                fontSize: '13px',
                color: '#64748b',
                fontWeight: 500,
              }}>
                {dateText}
              </span>
            </>
          )}
        </div>

        {/* Title */}
        <h3 style={{
          fontSize: '17px',
          fontWeight: 600,
          color: '#0f172a',
          lineHeight: 1.4,
          margin: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {titleMain}
        </h3>
      </div>

      {/* Right: Status & Arrow */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        padding: '20px 20px 20px 0',
      }}>
        {/* Status Badge */}
        {badgeStatus && <StatusBadge status={badgeStatus} />}

        {/* Arrow */}
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            background: isHovered && !disabled ? '#f1f5f9' : 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease',
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            style={{
              transform: isHovered && !disabled ? 'translateX(2px)' : 'translateX(0)',
              transition: 'transform 0.2s ease',
            }}
          >
            <path
              d="M6 3L11 8L6 13"
              stroke={isHovered && !disabled ? '#0f172a' : '#94a3b8'}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    </button>
  );
};