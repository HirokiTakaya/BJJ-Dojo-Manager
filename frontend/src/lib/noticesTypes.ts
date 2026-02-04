export type NoticeType = 'notice' | 'memo';
export type NoticeStatus = 'draft' | 'scheduled' | 'sent' | 'archived';
export type AudienceType = 'all' | 'uids';

export type AttachmentMeta = {
  name: string;
  size: number;
  type: string;
  url: string;
};

export type NoticeDoc = {
  type: NoticeType;
  title: string;
  body?: string;

  // Audience
  audienceType: AudienceType;
  audienceUids?: string[]; // required if audienceType==='uids'

  // Window + scheduling
  startTime: any; // Firestore Timestamp
  endTime: any;   // Firestore Timestamp
  sendAt: any;    // Firestore Timestamp (ALWAYS present; used for member query)

  status: NoticeStatus;

  attachments?: AttachmentMeta[];

  createdAt?: any;
  createdBy: string;
  updatedAt?: any;
};

export type NoticeRow = { id: string } & NoticeDoc;
