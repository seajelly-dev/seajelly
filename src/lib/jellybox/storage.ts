import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto/encrypt";
import {
  createR2Client,
  uploadToR2,
  deleteFromR2,
  copyInR2,
  type R2Credentials,
} from "./r2-client";
import type { S3Client } from "@aws-sdk/client-s3";
import type { JellyBoxStorage, JellyBoxFileZone } from "@/types/database";
import { downloadInboundFile } from "@/lib/agent/media/download";

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

interface FileAccessScope {
  agentId?: string;
  channelId?: string;
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

function fileExt(name: string): string {
  return name.includes(".") ? "." + name.split(".").pop() : "";
}

function buildFileKey(originalName: string, zone: JellyBoxFileZone = "persistent", channelId?: string): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const ext = fileExt(originalName);
  const prefix = zone === "temp" ? "temp" : "files";
  const segment = channelId ?? "_global";
  return `${prefix}/${segment}/${ts}-${rand}${ext}`;
}

function applyFileAccessScope<T>(
  query: T,
  scope?: FileAccessScope,
): T {
  let scopedQuery = query;

  if (scope?.agentId) {
    scopedQuery = (scopedQuery as T & { eq: (column: string, value: string) => T }).eq("agent_id", scope.agentId);
  }
  if (scope?.channelId) {
    scopedQuery = (scopedQuery as T & { eq: (column: string, value: string) => T }).eq("channel_id", scope.channelId);
  }

  return scopedQuery;
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
  zone?: JellyBoxFileZone;
}): Promise<UploadResult> {
  const storage = await getActiveWriteStorage();
  if (!storage) {
    throw new Error("No active JellyBox storage configured. Add an R2 storage in Dashboard > JellyBox.");
  }

  const zone = params.zone ?? "persistent";
  const fileKey = buildFileKey(params.originalName, zone, params.channelId);
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
      zone,
    })
    .select("id")
    .single();

  if (error || !record) {
    try {
      await deleteFromR2(storage.client, storage.bucketName, fileKey);
    } catch {
      // best effort rollback
    }
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

// ── Stage / Promote / Cleanup ──

export interface StagedFile {
  fileRecordId: string | null;
  publicUrl: string | null;
  base64: string | null;
  mimeType: string;
  effectiveImageMime: string;
  fileName: string | null;
  sizeBytes: number;
}

export async function stageInboundFile(params: {
  platform: string;
  agentId: string;
  channelId?: string;
  fileId: string;
  fileMime?: string | null;
  fileName?: string | null;
  logger?: (msg: string) => void;
}): Promise<StagedFile | null> {
  const downloaded = await downloadInboundFile({
    agentId: params.agentId,
    platform: params.platform,
    fileId: params.fileId,
    fileMime: params.fileMime,
    fileName: params.fileName,
    logger: params.logger,
  });
  if (!downloaded) return null;

  const storage = await getActiveWriteStorage();
  if (!storage) {
    return {
      fileRecordId: null,
      publicUrl: null,
      base64: downloaded.base64,
      mimeType: downloaded.mimeType,
      effectiveImageMime: downloaded.effectiveImageMime,
      fileName: downloaded.fileName,
      sizeBytes: downloaded.sizeBytes,
    };
  }

  try {
    const body = Buffer.from(downloaded.base64, "base64");
    const originalName = downloaded.fileName || `upload_${Date.now()}.${downloaded.mimeType.split("/")[1] || "bin"}`;
    const fileKey = buildFileKey(originalName, "temp", params.channelId);
    await uploadToR2(storage.client, storage.bucketName, fileKey, body, downloaded.mimeType);

    const publicUrl = `${storage.publicUrl}/${fileKey}`;
    const db = getSupabase();
    const { data: record, error } = await db
      .from("jellybox_files")
      .insert({
        storage_id: storage.id,
        agent_id: params.agentId,
        channel_id: params.channelId ?? null,
        file_key: fileKey,
        original_name: originalName,
        mime_type: downloaded.mimeType,
        file_size: body.length,
        public_url: publicUrl,
        zone: "temp" as JellyBoxFileZone,
      })
      .select("id")
      .single();

    if (error || !record) {
      await deleteFromR2(storage.client, storage.bucketName, fileKey).catch(() => {});
      throw new Error(error?.message ?? "DB insert failed");
    }

    return {
      fileRecordId: record.id,
      publicUrl,
      base64: null,
      mimeType: downloaded.mimeType,
      effectiveImageMime: downloaded.effectiveImageMime,
      fileName: downloaded.fileName,
      sizeBytes: body.length,
    };
  } catch (err) {
    params.logger?.(`R2 stage failed, falling back to base64: ${err instanceof Error ? err.message : "unknown"}`);
    return {
      fileRecordId: null,
      publicUrl: null,
      base64: downloaded.base64,
      mimeType: downloaded.mimeType,
      effectiveImageMime: downloaded.effectiveImageMime,
      fileName: downloaded.fileName,
      sizeBytes: downloaded.sizeBytes,
    };
  }
}

export interface PromoteResult {
  fileId: string;
  publicUrl: string;
  storageName: string;
}

export async function promoteFile(
  fileId: string,
  scope: FileAccessScope,
): Promise<PromoteResult> {
  const db = getSupabase();

  const query = applyFileAccessScope(
    db.from("jellybox_files")
      .select("id, storage_id, file_key, original_name, channel_id, zone")
      .eq("id", fileId)
      .eq("zone", "temp"),
    scope,
  );
  const { data: file, error: findErr } = await query.single();
  if (findErr || !file) {
    throw new Error(`Temp file not found or access denied: ${fileId}`);
  }

  const storage = await getStorageById(file.storage_id);
  if (!storage) {
    throw new Error(`Storage not found for file: ${fileId}`);
  }

  const newKey = buildFileKey(file.original_name, "persistent", file.channel_id ?? undefined);
  await copyInR2(storage.client, storage.bucketName, file.file_key, newKey);
  await deleteFromR2(storage.client, storage.bucketName, file.file_key);

  const newUrl = `${storage.publicUrl}/${newKey}`;
  const { error: updateErr } = await db
    .from("jellybox_files")
    .update({ zone: "persistent", file_key: newKey, public_url: newUrl })
    .eq("id", fileId);

  if (updateErr) {
    throw new Error(`Failed to update file record: ${updateErr.message}`);
  }

  return { fileId, publicUrl: newUrl, storageName: storage.name };
}

export async function cleanupTempFile(fileId: string): Promise<void> {
  const db = getSupabase();
  const { data: file } = await db
    .from("jellybox_files")
    .select("id, storage_id, file_key, zone")
    .eq("id", fileId)
    .eq("zone", "temp")
    .maybeSingle();
  if (!file) return;

  const storage = await getStorageById(file.storage_id);
  if (storage) {
    await deleteFromR2(storage.client, storage.bucketName, file.file_key).catch(() => {});
  }
  await db.from("jellybox_files").delete().eq("id", file.id);
}

export async function cleanupExpiredTempFiles(ttlMs: number = 24 * 60 * 60 * 1000): Promise<number> {
  const db = getSupabase();
  const cutoff = new Date(Date.now() - ttlMs).toISOString();

  const { data: files } = await db
    .from("jellybox_files")
    .select("id, storage_id, file_key")
    .eq("zone", "temp")
    .lt("created_at", cutoff)
    .limit(100);

  if (!files || files.length === 0) return 0;

  const storageCache = new Map<string, DecryptedStorage | null>();
  let cleaned = 0;

  for (const file of files) {
    let storage = storageCache.get(file.storage_id);
    if (storage === undefined) {
      storage = await getStorageById(file.storage_id);
      storageCache.set(file.storage_id, storage);
    }
    if (storage) {
      await deleteFromR2(storage.client, storage.bucketName, file.file_key).catch(() => {});
    }
    await db.from("jellybox_files").delete().eq("id", file.id);
    cleaned++;
  }

  return cleaned;
}

export async function stageOutputFile(params: {
  agentId: string;
  channelId?: string;
  body: Buffer;
  originalName: string;
  mimeType: string;
}): Promise<{ fileRecordId: string; publicUrl: string } | null> {
  const storage = await getActiveWriteStorage();
  if (!storage) return null;

  try {
    const fileKey = buildFileKey(params.originalName, "temp", params.channelId);
    await uploadToR2(storage.client, storage.bucketName, fileKey, params.body, params.mimeType);

    const publicUrl = `${storage.publicUrl}/${fileKey}`;
    const db = getSupabase();
    const { data: record, error } = await db
      .from("jellybox_files")
      .insert({
        storage_id: storage.id,
        agent_id: params.agentId,
        channel_id: params.channelId ?? null,
        file_key: fileKey,
        original_name: params.originalName,
        mime_type: params.mimeType,
        file_size: params.body.length,
        public_url: publicUrl,
        zone: "temp" as JellyBoxFileZone,
      })
      .select("id")
      .single();

    if (error || !record) {
      await deleteFromR2(storage.client, storage.bucketName, fileKey).catch(() => {});
      return null;
    }

    return { fileRecordId: record.id, publicUrl };
  } catch {
    return null;
  }
}

export async function cleanupChannelTempFiles(channelId: string): Promise<number> {
  const db = getSupabase();
  const { data: files } = await db
    .from("jellybox_files")
    .select("id, storage_id, file_key")
    .eq("channel_id", channelId)
    .eq("zone", "temp")
    .limit(200);

  if (!files || files.length === 0) return 0;

  const storageCache = new Map<string, DecryptedStorage | null>();
  let cleaned = 0;

  for (const file of files) {
    let storage = storageCache.get(file.storage_id);
    if (storage === undefined) {
      storage = await getStorageById(file.storage_id);
      storageCache.set(file.storage_id, storage);
    }
    if (storage) {
      await deleteFromR2(storage.client, storage.bucketName, file.file_key).catch(() => {});
    }
    await db.from("jellybox_files").delete().eq("id", file.id);
    cleaned++;
  }

  return cleaned;
}

export async function removeFile(fileId: string, scope?: FileAccessScope): Promise<void> {
  const db = getSupabase();
  const fileQuery = applyFileAccessScope(
    db
    .from("jellybox_files")
    .select("id, storage_id, file_key")
    .eq("id", fileId),
    scope,
  );
  const { data: file, error: findErr } = await fileQuery.single();

  if (findErr || !file) {
    throw new Error(`File not found: ${fileId}`);
  }

  const storage = await getStorageById(file.storage_id);
  if (!storage) {
    throw new Error(`Storage not found for file: ${fileId}`);
  }
  try {
    await deleteFromR2(storage.client, storage.bucketName, file.file_key);
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Failed to delete remote file object: ${error.message}`
        : "Failed to delete remote file object",
    );
  }

  const deleteQuery = applyFileAccessScope(
    db
    .from("jellybox_files")
    .delete()
    .eq("id", fileId),
    scope,
  );
  const { error: delErr } = await deleteQuery;
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

export async function getFileInfo(fileId: string, scope?: FileAccessScope): Promise<FileInfo | null> {
  const db = getSupabase();
  const query = applyFileAccessScope(
    db
    .from("jellybox_files")
    .select("*, jellybox_storages(name)")
    .eq("id", fileId)
    .eq("zone", "persistent"),
    scope,
  );
  const { data, error } = await query.single();
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
  channelId?: string;
  limit?: number;
}): Promise<FileInfo[]> {
  const db = getSupabase();
  let q = applyFileAccessScope(
    db
    .from("jellybox_files")
    .select("*, jellybox_storages(name)")
    .eq("zone", "persistent")
    .order("created_at", { ascending: false })
    .limit(params.limit ?? 20),
    {
      agentId: params.agentId,
      channelId: params.channelId,
    },
  );

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

export async function getUsageStats(params: FileAccessScope = {}): Promise<{
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

  const filesQuery = applyFileAccessScope(
    db
    .from("jellybox_files")
    .select("storage_id, file_size")
    .eq("zone", "persistent"),
    params,
  );
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

export async function removeStorage(storageId: string): Promise<void> {
  const db = getSupabase();
  const storage = await getStorageById(storageId);

  if (!storage) {
    throw new Error(`Storage not found: ${storageId}`);
  }

  const { data: files, error: listError } = await db
    .from("jellybox_files")
    .select("id, file_key")
    .eq("storage_id", storageId);

  if (listError) {
    throw new Error(`Failed to list storage files: ${listError.message}`);
  }

  for (const file of files ?? []) {
    try {
      await deleteFromR2(storage.client, storage.bucketName, file.file_key);
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? `Failed to delete remote object ${file.file_key}: ${error.message}`
          : `Failed to delete remote object ${file.file_key}`,
      );
    }
  }

  const { error: deleteError } = await db
    .from("jellybox_storages")
    .delete()
    .eq("id", storageId);

  if (deleteError) {
    throw new Error(`Failed to delete storage: ${deleteError.message}`);
  }
}
