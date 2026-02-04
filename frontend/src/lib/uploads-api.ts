/**
 * lib/uploads-api.ts
 * Firebase Functions バックエンド経由でファイルアップロード
 */

import { apiPost } from "./api-client";

export type SignedUploadUrl = {
  uploadUrl: string; downloadUrl: string; objectPath: string; token: string; contentType: string; bucket: string;
};

export async function createSignedUploadUrl(params: {
  filename: string; contentType: string; folder?: string; dojoId?: string;
}): Promise<SignedUploadUrl> {
  return apiPost<SignedUploadUrl>("/createSignedUploadUrl", params);
}

export async function uploadProfileImage(contentType: string): Promise<SignedUploadUrl> {
  return apiPost<SignedUploadUrl>("/uploadProfileImage", { contentType });
}

export async function uploadFile(file: File, options?: { folder?: string; dojoId?: string }): Promise<string> {
  const { uploadUrl, downloadUrl } = await createSignedUploadUrl({
    filename: file.name,
    contentType: file.type,
    folder: options?.folder,
    dojoId: options?.dojoId,
  });

  await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });

  return downloadUrl;
}

export async function uploadProfilePhoto(file: File): Promise<string> {
  const { uploadUrl, downloadUrl } = await uploadProfileImage(file.type);

  await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });

  return downloadUrl;
}

export function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

export function isImageFile(filename: string): boolean {
  return ["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(getFileExtension(filename));
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
