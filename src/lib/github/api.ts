import { parseRepo } from "./config";

const API = "https://api.github.com";

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function encodeRepoPath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export async function getFile(
  token: string,
  repo: string,
  path: string,
  branch = "main"
): Promise<{ content: string; sha: string }> {
  const { owner, name } = parseRepo(repo);
  const url = `${API}/repos/${owner}/${name}/contents/${encodeRepoPath(path)}?ref=${branch}`;
  const res = await fetch(url, { headers: headers(token) });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub getFile failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  if (data.type !== "file" || !data.content) {
    throw new Error(`Path is not a file: ${path}`);
  }
  const content = Buffer.from(data.content, "base64").toString("utf-8");
  return { content, sha: data.sha };
}

export async function listTree(
  token: string,
  repo: string,
  path = "",
  branch = "main"
): Promise<string[]> {
  const { owner, name } = parseRepo(repo);

  const refRes = await fetch(
    `${API}/repos/${owner}/${name}/git/ref/heads/${branch}`,
    { headers: headers(token) }
  );
  if (!refRes.ok) throw new Error(`Failed to get branch ref: ${refRes.status}`);
  const refData = await refRes.json();
  const commitSha = refData.object.sha;

  const commitRes = await fetch(
    `${API}/repos/${owner}/${name}/git/commits/${commitSha}`,
    { headers: headers(token) }
  );
  if (!commitRes.ok) throw new Error(`Failed to get commit: ${commitRes.status}`);
  const commitData = await commitRes.json();
  const treeSha = commitData.tree.sha;

  const treeRes = await fetch(
    `${API}/repos/${owner}/${name}/git/trees/${treeSha}?recursive=1`,
    { headers: headers(token) }
  );
  if (!treeRes.ok) throw new Error(`Failed to get tree: ${treeRes.status}`);
  const treeData = await treeRes.json();
  if (treeData.truncated) {
    throw new Error("Repository tree is too large for recursive listing. Narrow the path and try again.");
  }

  const IGNORE = [
    "node_modules/",
    ".git/",
    ".next/",
    "dist/",
    ".vercel/",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
  ];

  return (treeData.tree as { path: string; type: string }[])
    .filter(
      (entry) =>
        entry.type === "blob" &&
        !IGNORE.some((ig) => entry.path.startsWith(ig) || entry.path.includes(`/${ig}`))
    )
    .map((entry) => entry.path)
    .filter((p) => (path ? p.startsWith(path) : true));
}

export interface CompareResult {
  aheadBy: number;
  behindBy: number;
  totalCommits: number;
  files: {
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string;
  }[];
  commits: {
    sha: string;
    message: string;
    date: string;
  }[];
}

export async function compareCommits(
  token: string,
  repo: string,
  base: string,
  head: string,
): Promise<CompareResult> {
  const { owner, name } = parseRepo(repo);
  const res = await fetch(
    `${API}/repos/${owner}/${name}/compare/${base}...${head}`,
    { headers: headers(token) },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub compare failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return {
    aheadBy: data.ahead_by ?? 0,
    behindBy: data.behind_by ?? 0,
    totalCommits: data.total_commits ?? 0,
    files: (data.files ?? []).map(
      (f: Record<string, unknown>) => ({
        filename: f.filename as string,
        status: f.status as string,
        additions: (f.additions as number) ?? 0,
        deletions: (f.deletions as number) ?? 0,
        patch: typeof f.patch === "string" ? (f.patch as string).slice(0, 2000) : undefined,
      }),
    ),
    commits: (data.commits ?? []).slice(-20).map(
      (c: Record<string, unknown>) => {
        const commit = c.commit as Record<string, unknown>;
        const author = commit.author as Record<string, unknown> | undefined;
        return {
          sha: c.sha as string,
          message: ((commit.message as string) ?? "").split("\n")[0],
          date: (author?.date as string) ?? "",
        };
      },
    ),
  };
}

export interface CodeSearchResult {
  totalCount: number;
  items: {
    path: string;
    matchedLines: string[];
  }[];
}

export async function searchCode(
  token: string,
  repo: string,
  query: string,
  maxResults = 10,
): Promise<CodeSearchResult> {
  const { owner, name } = parseRepo(repo);
  const q = encodeURIComponent(`${query} repo:${owner}/${name}`);
  const res = await fetch(
    `${API}/search/code?q=${q}&per_page=${Math.min(maxResults, 30)}`,
    {
      headers: {
        ...headers(token),
        Accept: "application/vnd.github.text-match+json",
      },
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub code search failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return {
    totalCount: data.total_count ?? 0,
    items: (data.items ?? []).map((item: Record<string, unknown>) => {
      const textMatches = Array.isArray(item.text_matches)
        ? (item.text_matches as Record<string, unknown>[])
        : [];
      const matchedLines = textMatches
        .map((m) => (typeof m.fragment === "string" ? m.fragment : ""))
        .filter(Boolean)
        .slice(0, 3);
      return {
        path: item.path as string,
        matchedLines,
      };
    }),
  };
}

interface FileChange {
  path: string;
  content: string;
}

export async function createCommitAndPush(
  token: string,
  repo: string,
  files: FileChange[],
  deleteFiles: string[],
  message: string,
  branch = "main"
): Promise<{ commitSha: string; commitUrl: string }> {
  const { owner, name } = parseRepo(repo);
  const h = headers(token);

  const refRes = await fetch(
    `${API}/repos/${owner}/${name}/git/ref/heads/${branch}`,
    { headers: h }
  );
  if (!refRes.ok) throw new Error(`Failed to get ref: ${refRes.status}`);
  const refData = await refRes.json();
  const baseSha = refData.object.sha;

  const commitRes = await fetch(
    `${API}/repos/${owner}/${name}/git/commits/${baseSha}`,
    { headers: h }
  );
  if (!commitRes.ok) throw new Error(`Failed to get base commit: ${commitRes.status}`);
  const baseCommit = await commitRes.json();
  const baseTreeSha = baseCommit.tree.sha;

  const treeItems: { path: string; mode: string; type: string; sha?: string | null; content?: string }[] = [];

  for (const file of files) {
    const blobRes = await fetch(`${API}/repos/${owner}/${name}/git/blobs`, {
      method: "POST",
      headers: { ...h, "Content-Type": "application/json" },
      body: JSON.stringify({ content: file.content, encoding: "utf-8" }),
    });
    if (!blobRes.ok) throw new Error(`Failed to create blob for ${file.path}: ${blobRes.status}`);
    const blobData = await blobRes.json();
    treeItems.push({
      path: file.path,
      mode: "100644",
      type: "blob",
      sha: blobData.sha,
    });
  }

  for (const path of deleteFiles) {
    treeItems.push({
      path,
      mode: "100644",
      type: "blob",
      sha: null,
    });
  }

  const newTreeRes = await fetch(`${API}/repos/${owner}/${name}/git/trees`, {
    method: "POST",
    headers: { ...h, "Content-Type": "application/json" },
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
  });
  if (!newTreeRes.ok) {
    const body = await newTreeRes.text();
    throw new Error(`Failed to create tree: ${newTreeRes.status} ${body}`);
  }
  const newTree = await newTreeRes.json();

  const newCommitRes = await fetch(
    `${API}/repos/${owner}/${name}/git/commits`,
    {
      method: "POST",
      headers: { ...h, "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        tree: newTree.sha,
        parents: [baseSha],
      }),
    }
  );
  if (!newCommitRes.ok) throw new Error(`Failed to create commit: ${newCommitRes.status}`);
  const newCommit = await newCommitRes.json();

  const updateRefRes = await fetch(
    `${API}/repos/${owner}/${name}/git/refs/heads/${branch}`,
    {
      method: "PATCH",
      headers: { ...h, "Content-Type": "application/json" },
      body: JSON.stringify({ sha: newCommit.sha, force: false }),
    }
  );
  if (!updateRefRes.ok) {
    const body = await updateRefRes.text();
    throw new Error(`Failed to update ref: ${updateRefRes.status} ${body}`);
  }

  return {
    commitSha: newCommit.sha,
    commitUrl: `https://github.com/${owner}/${name}/commit/${newCommit.sha}`,
  };
}

export async function revertCommit(
  token: string,
  repo: string,
  commitSha: string,
  branch = "main"
): Promise<{ commitSha: string; commitUrl: string }> {
  const { owner, name } = parseRepo(repo);
  const h = headers(token);

  const commitRes = await fetch(
    `${API}/repos/${owner}/${name}/git/commits/${commitSha}`,
    { headers: h }
  );
  if (!commitRes.ok) throw new Error(`Failed to get commit ${commitSha}: ${commitRes.status}`);
  const commitData = await commitRes.json();

  if (!commitData.parents?.length) {
    throw new Error("Cannot revert: commit has no parents (initial commit).");
  }
  const parentSha = commitData.parents[0].sha;

  const parentCommitRes = await fetch(
    `${API}/repos/${owner}/${name}/git/commits/${parentSha}`,
    { headers: h }
  );
  if (!parentCommitRes.ok) throw new Error(`Failed to get parent commit: ${parentCommitRes.status}`);
  const parentCommit = await parentCommitRes.json();
  const parentTreeSha = parentCommit.tree.sha;

  const refRes = await fetch(
    `${API}/repos/${owner}/${name}/git/ref/heads/${branch}`,
    { headers: h }
  );
  if (!refRes.ok) throw new Error(`Failed to get branch ref: ${refRes.status}`);
  const refData = await refRes.json();
  const currentHeadSha = refData.object.sha;

  const newCommitRes = await fetch(
    `${API}/repos/${owner}/${name}/git/commits`,
    {
      method: "POST",
      headers: { ...h, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `revert: undo commit ${commitSha.slice(0, 8)}`,
        tree: parentTreeSha,
        parents: [currentHeadSha],
      }),
    }
  );
  if (!newCommitRes.ok) throw new Error(`Failed to create revert commit: ${newCommitRes.status}`);
  const newCommit = await newCommitRes.json();

  const updateRefRes = await fetch(
    `${API}/repos/${owner}/${name}/git/refs/heads/${branch}`,
    {
      method: "PATCH",
      headers: { ...h, "Content-Type": "application/json" },
      body: JSON.stringify({ sha: newCommit.sha, force: false }),
    }
  );
  if (!updateRefRes.ok) {
    const body = await updateRefRes.text();
    throw new Error(`Failed to update ref: ${updateRefRes.status} ${body}`);
  }

  return {
    commitSha: newCommit.sha,
    commitUrl: `https://github.com/${owner}/${name}/commit/${newCommit.sha}`,
  };
}

export async function getVercelBuildLogs(
  vercelToken: string,
  deploymentId: string,
  maxLines = 80
): Promise<string> {
  const res = await fetch(
    `https://api.vercel.com/v3/deployments/${deploymentId}/events?limit=-1&direction=backward`,
    { headers: { Authorization: `Bearer ${vercelToken}` } }
  );
  if (!res.ok) return `[Failed to fetch build logs: ${res.status}]`;

  const events: { type?: string; text?: string; payload?: { text?: string } }[] = await res.json();

  const errorLines = events
    .filter((e) => e.type === "stderr" || e.type === "error" || e.type === "fatal")
    .map((e) => e.text ?? e.payload?.text ?? "")
    .filter(Boolean);

  if (errorLines.length === 0) {
    const allLines = events
      .filter((e) => e.type === "stdout" || e.type === "stderr" || e.type === "command")
      .map((e) => e.text ?? e.payload?.text ?? "")
      .filter(Boolean);
    return allLines.slice(-maxLines).join("\n") || "[No log output found]";
  }

  return errorLines.slice(-maxLines).join("\n");
}

export async function checkVercelDeployment(
  vercelToken: string,
  projectId: string,
  commitSha: string
): Promise<{
  state: "BUILDING" | "READY" | "ERROR" | "QUEUED" | "CANCELED" | "NOT_FOUND";
  deploymentId?: string;
  url?: string;
  createdAt?: string;
  errorMessage?: string;
  buildLogs?: string;
}> {
  const res = await fetch(
    `https://api.vercel.com/v6/deployments?projectId=${projectId}&limit=10`,
    {
      headers: {
        Authorization: `Bearer ${vercelToken}`,
      },
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Vercel API error (${res.status}): ${body}`);
  }
  const data = await res.json();
  const deployments = data.deployments ?? [];

  const sha = commitSha.trim().toLowerCase();
  const matchSha = (candidate: unknown): boolean => {
    if (typeof candidate !== "string") return false;
    const c = candidate.toLowerCase();
    return c === sha || c.startsWith(sha) || sha.startsWith(c);
  };

  const match = deployments.find(
    (d: Record<string, unknown>) =>
      matchSha((d.meta as Record<string, unknown>)?.githubCommitSha) ||
      matchSha((d.gitSource as Record<string, unknown>)?.sha)
  );

  if (!match) {
    return { state: "NOT_FOUND" };
  }

  const stateMap: Record<string, string> = {
    BUILDING: "BUILDING",
    READY: "READY",
    ERROR: "ERROR",
    QUEUED: "QUEUED",
    CANCELED: "CANCELED",
    INITIALIZING: "QUEUED",
  };

  const state = (stateMap[match.state ?? match.readyState] ?? "BUILDING") as
    "BUILDING" | "READY" | "ERROR" | "QUEUED" | "CANCELED";
  const deploymentId = match.uid as string | undefined;

  const result: {
    state: typeof state;
    deploymentId?: string;
    url?: string;
    createdAt?: string;
    errorMessage?: string;
    buildLogs?: string;
  } = {
    state,
    deploymentId,
    url: match.url ? `https://${match.url}` : undefined,
    createdAt: match.createdAt ? new Date(match.createdAt).toISOString() : undefined,
    errorMessage: state === "ERROR" ? ((match.errorMessage as string) ?? "Build failed") : undefined,
  };

  if (state === "ERROR" && deploymentId) {
    try {
      result.buildLogs = await getVercelBuildLogs(vercelToken, deploymentId);
    } catch {
      result.buildLogs = "[Failed to retrieve build logs]";
    }
  }

  return result;
}
