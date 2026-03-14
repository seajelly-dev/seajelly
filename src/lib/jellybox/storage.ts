import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto/encrypt";
import {
  createR2Client,
  uploadToR2,
  deleteFromR2,
  type R2Credentials,
} from "./r2-client";
import type { S3Client } from "@aws-sdk/client-s3";
import type { JellyBoxStorage } from "@/types/database";

function getSupabase() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

interface DecryptedStorage {
  id: string;
  name: string;
  bucketName: string;
  publicUrl: string;
  maxBytes: number;
  client: S3Client;
}

function decryptStorage(row: JellyBoxStorage): DecryptedStorage {
  const creds: R2Credentials = {
    endpoint: row.endpoint,
    accessKeyId: decrypt(row.encrypted_access_key_id),
    secretAccessKey: decrypt(row.encrypted_secret_access_key),
  };
  return {
    id: row.id,
    name: row.name,
    bucketName: row.bucket_name,
    publicUrl: row.public_url.replace(/\/+$/, ""),
    maxBytes: row.max_bytes,
    client: createR2Client(creds),
  };
}

export async function getActiveWriteStorage(): Promise<DecryptedStorage | null> {
  const db = getSupabase();
  const { data, error } = await db
    .from("jellybox_storages")
    .select("*")
    .eq("is_active_write", true)
    .limit(1)
    .single();
  if (error || !data) return null;
  return decryptStorage(data as JellyBoxStorage);
}

export async function getStorageById(storageId: string): Promise<DecryptedStorage | null> {
  const db = getSupabase();
  const { data, error } = await db
    .from("jellybox_storages")
    .select("*")
    .eq("id", storageId)
    .single();
  if (error || !data) return null;
  return decryptStorage(data as JellyBoxStorage);
}

function buildFileKey(originalName: string): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const ext = originalName.includes(".")
    ? "." + originalName.split(".").pop()
    : "";
  return `jellybox/${ts}-${rand}${ext}`;
}

export interface UploadResult {
  fileId: string;
  publicUrl: string;
  fileSize: number;
  storageId: string;
  storageName: string;
}

export async function uploadFile(params: {
  body: Buffer;
  originalName: string;
  mimeType?: string;
  agentId?: string;
  channelId?: string;
}): Promise<UploadResult> {
  const storage = await getActiveWriteStorage();
  if (!storage) {
    throw new Error("No active JellyBox storage configured. Add an R2 storage in Dashboard > JellyBox.");
  }

  const fileKey = buildFileKey(params.originalName);
  await uploadToR2(storage.client, storage.bucketName, fileKey, params.body, params.mimeType);

  const publicUrl = `${storage.publicUrl}/${fileKey}`;
  const db = getSupabase();
  const { data: record, error } = await db
    .from("jellybox_files")
    .insert({
      storage_id: storage.id,
      agent_id: params.agentId ?? null,
      channel_id: params.channelId ?? null,
      file_key: fileKey,
      original_name: params.originalName,
      mime_type: params.mimeType ?? null,
      file_size: params.body.length,
      public_url: publicUrl,
    })
    .select("id")
    .single();

  if (error || !record) {
    throw new Error(`Failed to record file metadata: ${error?.message ?? "unknown"}`);
  }

  return {
    fileId: record.id,
    publicUrl,
    fileSize: params.body.length,
    storageId: storage.id,
    storageName: storage.name,
  };
}

export async function removeFile(fileId: string): Promise<void> {
  const db = getSupabase();
  const { data: file, error: findErr } = await db
    .from("jellybox_files")
    .select("id, storage_id, file_key")
    .eq("id", fileId)
    .single();

  if (findErr || !file) {
    throw new Error(`File not found: ${fileId}`);
  }

  const storage = await getStorageById(file.storage_id);
  if (storage) {
    try {
      await deleteFromR2(storage.client, storage.bucketName, file.file_key);
    } catch {
      // best effort — still remove DB record
    }
  }

  const { error: delErr } = await db
    .from("jellybox_files")
    .delete()
    .eq("id", fileId);
  if (delErr) {
    throw new Error(`Failed to delete file record: ${delErr.message}`);
  }
}

export interface FileInfo {
  id: string;
  originalName: string;
  mimeType: string | null;
  fileSize: number;
  publicUrl: string;
  storageName: string;
  createdAt: string;
}

export async function getFileInfo(fileId: string): Promise<FileInfo | null> {
  const db = getSupabase();
  const { data, error } = await db
    .from("jellybox_files")
    .select("*, jellybox_storages(name)")
    .eq("id", fileId)
    .single();
  if (error || !data) return null;
  return {
    id: data.id,
    originalName: data.original_name,
    mimeType: data.mime_type,
    fileSize: data.file_size,
    publicUrl: data.public_url,
    storageName: (data.jellybox_storages as { name: string } | null)?.name ?? "unknown",
    createdAt: data.created_at,
  };
}

export async function searchFiles(params: {
  searchName?: string;
  agentId?: string;
  limit?: number;
}): Promise<FileInfo[]> {
  const db = getSupabase();
  let q = db
    .from("jellybox_files")
    .select("*, jellybox_storages(name)")
    .order("created_at", { ascending: false })
    .limit(params.limit ?? 20);

  if (params.agentId) q = q.eq("agent_id", params.agentId);
  if (params.searchName) q = q.ilike("original_name", `%${params.searchName}%`);

  const { data, error } = await q;
  if (error || !data) return [];
  return data.map((d) => ({
    id: d.id,
    originalName: d.original_name,
    mimeType: d.mime_type,
    fileSize: d.file_size,
    publicUrl: d.public_url,
    storageName: (d.jellybox_storages as { name: string } | null)?.name ?? "unknown",
    createdAt: d.created_at,
  }));
}

export interface StorageUsage {
  storageId: string;
  storageName: string;
  fileCount: number;
  usedBytes: number;
  maxBytes: number;
}

export async function getUsageStats(agentId?: string): Promise<{
  totalFiles: number;
  totalBytes: number;
  storages: StorageUsage[];
}> {
  const db = getSupabase();

  const { data: storages } = await db
    .from("jellybox_storages")
    .select("id, name, max_bytes")
    .order("created_at", { ascending: true });

  if (!storages || storages.length === 0) {
    return { totalFiles: 0, totalBytes: 0, storages: [] };
  }

  let filesQuery = db
    .from("jellybox_files")
    .select("storage_id, file_size");
  if (agentId) filesQuery = filesQuery.eq("agent_id", agentId);
  const { data: files } = await filesQuery;

  const byStorage = new Map<string, { count: number; bytes: number }>();
  for (const f of files ?? []) {
    const entry = byStorage.get(f.storage_id) ?? { count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += f.file_size;
    byStorage.set(f.storage_id, entry);
  }

  let totalFiles = 0;
  let totalBytes = 0;
  const result: StorageUsage[] = storages.map((s) => {
    const entry = byStorage.get(s.id) ?? { count: 0, bytes: 0 };
    totalFiles += entry.count;
    totalBytes += entry.bytes;
    return {
      storageId: s.id,
      storageName: s.name,
      fileCount: entry.count,
      usedBytes: entry.bytes,
      maxBytes: s.max_bytes,
    };
  });

  return { totalFiles, totalBytes, storages: result };
}
