/**
 * V4A diff parser and applier.
 * Ported from OpenAI's reference implementation (openai-agents-js).
 *
 * V4A format example:
 *   @@ export async function runAgentLoop
 *    export async function runAgentLoop(event: AgentEvent): Promise<LoopResult> {
 *      const traceId = event.trace_id;
 *   +  const newFlag = true;
 *      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
 *
 * Prefix semantics:
 *   " " (space) = context line (must match original)
 *   "+"         = line to add
 *   "-"         = line to remove
 *   "@@ "       = hunk header — search anchor text
 *   "*** "      = file-level directive (ignored here; handled by patch harness)
 */

export class PatchApplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchApplicationError";
  }
}

interface DiffLine {
  type: "context" | "add" | "remove";
  content: string;
}

interface DiffHunk {
  contextHint: string;
  lines: DiffLine[];
}

function normalizeLine(s: string): string {
  return s.replace(/\s+$/, "");
}

function linesMatch(a: string, b: string): boolean {
  return normalizeLine(a) === normalizeLine(b);
}

function parseDiffHunks(diff: string): DiffHunk[] {
  const rawLines = diff.split("\n");
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;

  for (const raw of rawLines) {
    if (raw.startsWith("*** ")) continue;

    if (raw.startsWith("@@ ")) {
      if (current && current.lines.length > 0) {
        hunks.push(current);
      }
      current = { contextHint: raw.slice(3).trim(), lines: [] };
      continue;
    }

    if (!current) {
      if (raw.startsWith("+") || raw.startsWith("-") || raw.startsWith(" ")) {
        current = { contextHint: "", lines: [] };
      } else {
        continue;
      }
    }

    if (raw.startsWith("+")) {
      current.lines.push({ type: "add", content: raw.slice(1) });
    } else if (raw.startsWith("-")) {
      current.lines.push({ type: "remove", content: raw.slice(1) });
    } else if (raw.startsWith(" ")) {
      current.lines.push({ type: "context", content: raw.slice(1) });
    }
  }

  if (current && current.lines.length > 0) {
    hunks.push(current);
  }
  return hunks;
}

function findHunkLocation(
  fileLines: string[],
  hunk: DiffHunk,
  searchFrom: number,
): number {
  const expectedLines = hunk.lines.filter(
    (l) => l.type === "context" || l.type === "remove",
  );

  if (expectedLines.length === 0) {
    if (hunk.contextHint) {
      for (let i = searchFrom; i < fileLines.length; i++) {
        if (fileLines[i].includes(hunk.contextHint)) return i;
      }
    }
    return searchFrom;
  }

  const firstExpected = expectedLines[0].content;

  const tryMatchAt = (start: number): boolean => {
    let fi = start;
    for (const exp of expectedLines) {
      if (fi >= fileLines.length || !linesMatch(fileLines[fi], exp.content)) {
        return false;
      }
      fi++;
    }
    return true;
  };

  for (let i = searchFrom; i < fileLines.length; i++) {
    if (linesMatch(fileLines[i], firstExpected) && tryMatchAt(i)) {
      return i;
    }
  }

  if (hunk.contextHint) {
    for (let i = searchFrom; i < fileLines.length; i++) {
      if (fileLines[i].includes(hunk.contextHint)) {
        const nearStart = Math.max(0, i - 10);
        const nearEnd = Math.min(fileLines.length, i + 80);
        for (let j = nearStart; j < nearEnd; j++) {
          if (linesMatch(fileLines[j], firstExpected) && tryMatchAt(j)) {
            return j;
          }
        }
      }
    }
  }

  // Last resort: scan from the start (for hunks whose order in the file
  // doesn't match the order in the diff).
  for (let i = 0; i < searchFrom; i++) {
    if (linesMatch(fileLines[i], firstExpected) && tryMatchAt(i)) {
      return i;
    }
  }

  throw new PatchApplicationError(
    `Cannot locate hunk. Hint: "${hunk.contextHint || "(none)"}". ` +
      `First expected line: "${firstExpected}"`,
  );
}

function applyHunk(
  fileLines: string[],
  hunk: DiffHunk,
  searchFrom: number,
): { result: string[]; nextSearch: number } {
  const start = findHunkLocation(fileLines, hunk, searchFrom);
  const before = fileLines.slice(0, start);
  const result = [...before];
  let fi = start;

  for (const line of hunk.lines) {
    switch (line.type) {
      case "context":
        if (fi >= fileLines.length) {
          throw new PatchApplicationError(
            `Context line past end of file: "${line.content}"`,
          );
        }
        if (!linesMatch(fileLines[fi], line.content)) {
          throw new PatchApplicationError(
            `Context mismatch at line ${fi + 1}: ` +
              `expected "${line.content}", got "${fileLines[fi]}"`,
          );
        }
        result.push(fileLines[fi]);
        fi++;
        break;

      case "remove":
        if (fi >= fileLines.length) {
          throw new PatchApplicationError(
            `Remove line past end of file: "${line.content}"`,
          );
        }
        if (!linesMatch(fileLines[fi], line.content)) {
          throw new PatchApplicationError(
            `Remove mismatch at line ${fi + 1}: ` +
              `expected "${line.content}", got "${fileLines[fi]}"`,
          );
        }
        fi++;
        break;

      case "add":
        result.push(line.content);
        break;
    }
  }

  const remaining = fileLines.slice(fi);
  result.push(...remaining);
  return { result, nextSearch: result.length - remaining.length };
}

/**
 * Apply a V4A diff to a source string.
 *
 * @param input   Original file content (for update) or empty string (for create).
 * @param diff    V4A diff text — may or may not include `*** ` / `@@ ` headers.
 * @param mode    "default" for updating existing files, "create" for new files.
 * @returns       The modified file content.
 * @throws        PatchApplicationError if the diff cannot be applied.
 */
export function applyDiff(
  input: string,
  diff: string,
  mode: "default" | "create" = "default",
): string {
  if (mode === "create") {
    const lines = diff.split("\n");
    const out: string[] = [];
    for (const line of lines) {
      if (line.startsWith("*** ") || line.startsWith("@@ ")) continue;
      if (line.startsWith("+")) {
        out.push(line.slice(1));
      } else if (line.startsWith(" ")) {
        out.push(line.slice(1));
      }
    }
    return out.join("\n");
  }

  const hunks = parseDiffHunks(diff);
  if (hunks.length === 0) return input;

  let fileLines = input.split("\n");
  let searchFrom = 0;

  for (const hunk of hunks) {
    const { result, nextSearch } = applyHunk(fileLines, hunk, searchFrom);
    fileLines = result;
    searchFrom = nextSearch;
  }

  return fileLines.join("\n");
}
