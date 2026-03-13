import { applyDiff, PatchApplicationError } from "./apply-diff";
import { getFile, createCommitAndPush } from "./api";

export interface PatchOperation {
  type: "create_file" | "update_file" | "delete_file";
  path: string;
  diff?: string;
}

export interface PatchResult {
  commitSha: string;
  commitUrl: string;
  patchedFiles: string[];
}

export interface PatchError {
  file: string;
  message: string;
}

/**
 * Read original files from GitHub, apply V4A diffs, then commit in one atomic push.
 *
 * Flow:
 *   1. For each update_file: read original via GitHub API → applyDiff
 *   2. For each create_file: applyDiff("", diff, "create")
 *   3. Collect all results + delete list → createCommitAndPush
 */
export async function applyPatchesToGitHub(
  token: string,
  repo: string,
  operations: PatchOperation[],
  message: string,
  branch = "main",
): Promise<PatchResult> {
  const files: { path: string; content: string }[] = [];
  const deleteFiles: string[] = [];
  const patchedFiles: string[] = [];
  const errors: PatchError[] = [];

  for (const op of operations) {
    try {
      switch (op.type) {
        case "update_file": {
          if (!op.diff) {
            errors.push({ file: op.path, message: "update_file requires a diff" });
            break;
          }
          const { content: original } = await getFile(token, repo, op.path, branch);
          const patched = applyDiff(original, op.diff, "default");
          files.push({ path: op.path, content: patched });
          patchedFiles.push(op.path);
          break;
        }

        case "create_file": {
          if (!op.diff) {
            errors.push({ file: op.path, message: "create_file requires a diff" });
            break;
          }
          const content = applyDiff("", op.diff, "create");
          files.push({ path: op.path, content });
          patchedFiles.push(op.path);
          break;
        }

        case "delete_file": {
          deleteFiles.push(op.path);
          patchedFiles.push(op.path);
          break;
        }
      }
    } catch (err) {
      const msg =
        err instanceof PatchApplicationError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Unknown error";
      errors.push({ file: op.path, message: msg });
    }
  }

  if (errors.length > 0) {
    const summary = errors
      .map((e) => `${e.file}: ${e.message}`)
      .join("\n");
    throw new PatchApplicationError(
      `Patch failed for ${errors.length} file(s):\n${summary}`,
    );
  }

  if (files.length === 0 && deleteFiles.length === 0) {
    throw new PatchApplicationError("No files to commit after applying patches.");
  }

  const result = await createCommitAndPush(
    token,
    repo,
    files,
    deleteFiles,
    message,
    branch,
  );

  return {
    commitSha: result.commitSha,
    commitUrl: result.commitUrl,
    patchedFiles,
  };
}
