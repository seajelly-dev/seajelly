import { tool } from "ai";
import { z } from "zod/v4";
import {
  promoteFile,
  removeFile,
  getFileInfo,
  searchFiles,
  getUsageStats,
  getActiveWriteStorage,
} from "@/lib/jellybox/storage";

interface CreateJellyBoxToolkitToolsOptions {
  agentId: string;
  channelId?: string;
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
    jellybox_persist: tool({
      description:
        "Persist a temporarily staged file to permanent JellyBox cloud storage. " +
        "Use this when the user explicitly asks to save, store, or keep a file. " +
        "The file_id can be found in the session history as `file_id=<uuid>` in file references, " +
        "or in the system prompt under 'Current Turn File Context' as 'Staged File ID'. " +
        "You can also pass the file's public URL instead of the ID. " +
        "Do NOT call this unless the user clearly requests storage.",
      inputSchema: z.object({
        staged_file_id: z.string().describe(
          "The file ID (UUID) or the public URL of the temp file to persist. " +
          "Look for file_id=<uuid> in session history file references."
        ),
      }),
      execute: async ({ staged_file_id }: { staged_file_id: string }) => {
        try {
          const result = await promoteFile(staged_file_id, { agentId, channelId });
          return {
            success: true,
            file_id: result.fileId,
            public_url: result.publicUrl,
            storage: result.storageName,
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : "Persist failed" };
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
            const info = await getFileInfo(file_id, {
              agentId,
              channelId,
            });
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
              channelId,
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

          const results = await searchFiles({ agentId, channelId, limit: 10 });
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
          await removeFile(file_id, {
            agentId,
            channelId,
          });
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
          const stats = await getUsageStats({
            agentId,
            channelId,
          });
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

    jellybox_fetch: tool({
      description:
        "Download a file from a JellyBox URL and return its base64 content. " +
        "Use this when you need to read, analyze, or edit a file from a previous turn " +
        "(e.g. the user asks 'edit that image' and you need the image data from session history). " +
        "Only works with URLs from the configured R2 storage domain.",
      inputSchema: z.object({
        url: z.string().describe("The public URL of the file to fetch (from session history file references)"),
      }),
      execute: async ({ url }: { url: string }) => {
        try {
          const storage = await getActiveWriteStorage();
          if (storage) {
            const storageHost = new URL(storage.publicUrl).host;
            const targetHost = new URL(url).host;
            if (targetHost !== storageHost) {
              return { success: false, error: `URL domain mismatch. Expected ${storageHost}` };
            }
          }

          const res = await fetch(url);
          if (!res.ok) {
            return { success: false, error: `Fetch failed: HTTP ${res.status}` };
          }
          const buf = Buffer.from(await res.arrayBuffer());
          const mime = res.headers.get("content-type") || "application/octet-stream";
          return {
            success: true,
            base64: buf.toString("base64"),
            mime,
            size: buf.length,
            size_human: formatBytes(buf.length),
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : "Fetch failed" };
        }
      },
    }),
  };
}
