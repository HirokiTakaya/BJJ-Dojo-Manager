// src/lib/uiLabels.ts
export const TYPE_LABEL: Record<'notice' | 'memo', string> = {
  notice: 'Announcement',
  memo: 'Note',
};

export const TAB_LABEL = {
  all: 'All',
  notice: 'Announcements',
  memo: 'Notes',
} as const;

export const COPY = {
  inboxTitle: 'Updates',
  searchPlaceholder: 'Search announcements or notes',
  empty: 'Nothing new yet.',
  loading: 'Loading updates…',
  back: 'Back',
  composeTitle: 'Create Update',
  preview: 'Preview',
  edit: 'Edit',
  saveDraft: 'Save Draft',
  publish: 'Publish',
  audience: 'Audience',
  recipientsAll: 'Everyone',
  recipientsCustom: 'Specific people (UIDs)',
  typeLabel: 'Category',
  titleLabel: 'Title',
  bodyLabel: 'Message',
  windowLabel: 'Visible window',
  sendAtLabel: 'Publish time (optional)',
  attachments: 'Attachments (optional)',
};
