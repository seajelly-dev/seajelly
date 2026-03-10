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
