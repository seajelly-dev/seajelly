import { tool } from "ai";
import { z } from "zod/v4";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  uploadFile,
  removeFile,
  getFileInfo,
  searchFiles,
  getUsageStats,
} from "@/lib/jellybox/storage";

interface CreateJellyBoxToolkitToolsOptions {
  agentId: string;
  channelId?: string;
  supabase: SupabaseClient;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i > 0 ? 2 : 0)} ${units[i]}`;
}

export function createJellyBoxToolkitTools({
  agentId,
  channelId,
}: CreateJellyBoxToolkitToolsOptions) {
  return {
    jellybox_upload: tool({
      description:
        "Upload a file to JellyBox cloud storage. Accepts a URL to fetch from or base64-encoded data. " +
        "Returns a permanent public URL. Use this when the user wants to store, save, or persist a file, image, " +
        "or document for later retrieval.",
      inputSchema: z.object({
        source_url: z
          .string()
          .optional()
          .describe("URL to fetch the file from. Mutually exclusive with base64_data."),
        base64_data: z
          .string()
          .optional()
          .describe("Base64-encoded file content. Mutually exclusive with source_url."),
        filename: z.string().describe("Target filename including extension, e.g. 'photo.jpg'"),
        mime_type: z
          .string()
          .optional()
          .describe("MIME type, e.g. 'image/png'. Auto-detected from extension if omitted."),
      }),
      execute: async ({
        source_url,
        base64_data,
        filename,
        mime_type,
      }: {
        source_url?: string;
        base64_data?: string;
        filename: string;
        mime_type?: string;
      }) => {
        try {
          if (!source_url && !base64_data) {
            return { success: false, error: "Provide either source_url or base64_data" };
          }

          let body: Buffer;
          if (source_url) {
            const res = await fetch(source_url);
            if (!res.ok) {
              return { success: false, error: `Failed to fetch URL: ${res.status} ${res.statusText}` };
            }
            body = Buffer.from(await res.arrayBuffer());
            if (!mime_type) {
              mime_type = res.headers.get("content-type") ?? undefined;
            }
          } else {
            body = Buffer.from(base64_data!, "base64");
          }

          const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
          if (body.length > MAX_FILE_SIZE) {
            return { success: false, error: `File too large: ${formatBytes(body.length)}. Max 50MB.` };
          }

          const result = await uploadFile({
            body,
            originalName: filename,
            mimeType: mime_type,
            agentId,
            channelId,
          });

          return {
            success: true,
            file_id: result.fileId,
            public_url: result.publicUrl,
            file_size: formatBytes(result.fileSize),
            storage: result.storageName,
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : "Upload failed" };
        }
      },
    }),

    jellybox_info: tool({
      description:
        "Look up file information from JellyBox cloud storage. " +
        "Query by file ID for exact match, or search by filename for fuzzy match. " +
        "Returns file metadata including public URL, size, and storage location.",
      inputSchema: z.object({
        file_id: z.string().optional().describe("Exact file ID to look up"),
        search_name: z
          .string()
          .optional()
          .describe("Fuzzy search by original filename"),
      }),
      execute: async ({
        file_id,
        search_name,
      }: {
        file_id?: string;
        search_name?: string;
      }) => {
        try {
          if (file_id) {
            const info = await getFileInfo(file_id);
            if (!info) return { success: false, error: `File not found: ${file_id}` };
            return {
              success: true,
              files: [{
                id: info.id,
                name: info.originalName,
                mime_type: info.mimeType,
                size: formatBytes(info.fileSize),
                public_url: info.publicUrl,
                storage: info.storageName,
                created_at: info.createdAt,
              }],
            };
          }

          if (search_name) {
            const results = await searchFiles({
              searchName: search_name,
              agentId,
              limit: 10,
            });
            return {
              success: true,
              files: results.map((f) => ({
                id: f.id,
                name: f.originalName,
                mime_type: f.mimeType,
                size: formatBytes(f.fileSize),
                public_url: f.publicUrl,
                storage: f.storageName,
                created_at: f.createdAt,
              })),
            };
          }

          const results = await searchFiles({ agentId, limit: 10 });
          return {
            success: true,
            files: results.map((f) => ({
              id: f.id,
              name: f.originalName,
              mime_type: f.mimeType,
              size: formatBytes(f.fileSize),
              public_url: f.publicUrl,
              storage: f.storageName,
              created_at: f.createdAt,
            })),
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : "Query failed" };
        }
      },
    }),

    jellybox_delete: tool({
      description:
        "Delete a file from JellyBox cloud storage. " +
        "Removes both the R2 object and the database record. This action is irreversible.",
      inputSchema: z.object({
        file_id: z.string().describe("The ID of the file to delete"),
      }),
      execute: async ({ file_id }: { file_id: string }) => {
        try {
          await removeFile(file_id);
          return { success: true, message: `File ${file_id} deleted` };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : "Delete failed" };
        }
      },
    }),

    jellybox_usage: tool({
      description:
        "Get JellyBox cloud storage usage statistics. " +
        "Shows total files, total size, and per-storage breakdown with capacity limits.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const stats = await getUsageStats(agentId);
          return {
            success: true,
            total_files: stats.totalFiles,
            total_size: formatBytes(stats.totalBytes),
            storages: stats.storages.map((s) => ({
              name: s.storageName,
              files: s.fileCount,
              used: formatBytes(s.usedBytes),
              capacity: formatBytes(s.maxBytes),
              usage_percent: s.maxBytes > 0
                ? `${((s.usedBytes / s.maxBytes) * 100).toFixed(1)}%`
                : "N/A",
            })),
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : "Stats failed" };
        }
      },
    }),
  };
}
