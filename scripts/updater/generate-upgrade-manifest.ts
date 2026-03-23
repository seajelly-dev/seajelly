#!/usr/bin/env tsx

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type DbMode = "none" | "manual_apply";
type PatchType = "create_file" | "update_file" | "delete_file";

type UpdateManifestPatch = {
  type: PatchType;
  path: string;
  diff?: string;
  expected_blob_sha?: string;
};

type UpdateManifest = {
  manifest_version: 1;
  release_tag: string;
  release_commit_sha: string;
  previous_supported_tag: string;
  previous_supported_tags?: string[];
  requires_manual_review?: boolean;
  required_env_keys?: string[];
  commit_message: string;
  patches: UpdateManifestPatch[];
  db: {
    mode: DbMode;
    destructive: boolean;
    sql_path?: string;
    summary?: string;
  };
  notes_md?: string;
};

type ParsedArgs = {
  from?: string;
  to: string;
  output: string;
  releaseTag?: string;
  previousSupportedTag?: string;
  previousSupportedTags: string[];
  releaseCommitSha?: string;
  commitMessage?: string;
  dbMode?: DbMode;
  dbSqlPath?: string;
  dbSummary?: string;
  requiredEnvKeys: string[];
  notesFile?: string;
  manualReview: boolean;
  destructiveDb: boolean;
  initialRelease: boolean;
  stdout: boolean;
  help: boolean;
};

const DEFAULT_OUTPUT = ".seajelly/upgrade-manifest.json";
const DEFAULT_IGNORED_PATHS = new Set([DEFAULT_OUTPUT]);

function printHelp() {
  console.log(`
Generate a SEAJelly upgrade manifest from git history.

Usage:
  pnpm tsx scripts/updater/generate-upgrade-manifest.ts --from v0.1.0 --release-tag v0.1.1

Options:
  --from <ref>                   Previous release tag or ref
  --to <ref>                     Target ref. Defaults to HEAD
  --release-tag <tag>            Release tag to write. Defaults to v + package.json version
  --previous-supported-tag <tag> Explicit previous supported release tag
  --previous-supported-tags <a,b,c>
                                 Extra supported source release tags for bridge releases
  --release-commit-sha <sha>     Override release_commit_sha in output
  --commit-message <message>     Override manifest commit message
  --db-mode <none|manual_apply>  Database mode. Defaults to none, or manual_apply when --db-sql-path is set
  --db-sql-path <path>           Relative SQL file path for DB updates
  --db-summary <text>            Short DB summary
  --required-env <a,b,c>         Comma-separated required env keys
  --notes-file <path>            Markdown file to use as notes_md
  --manual-review                Set requires_manual_review=true
  --destructive-db               Set db.destructive=true
  --initial-release              Generate an initial baseline manifest with no patches
  --output <path>                Output path. Defaults to .seajelly/upgrade-manifest.json
  --stdout                       Print JSON to stdout instead of writing a file
  --help                         Show this help
`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    to: "HEAD",
    output: DEFAULT_OUTPUT,
    previousSupportedTags: [],
    requiredEnvKeys: [],
    manualReview: false,
    destructiveDb: false,
    initialRelease: false,
    stdout: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case "--":
        break;
      case "--from":
        parsed.from = next;
        i += 1;
        break;
      case "--to":
        parsed.to = next;
        i += 1;
        break;
      case "--output":
        parsed.output = next;
        i += 1;
        break;
      case "--release-tag":
        parsed.releaseTag = next;
        i += 1;
        break;
      case "--previous-supported-tag":
        parsed.previousSupportedTag = next;
        i += 1;
        break;
      case "--previous-supported-tags":
        parsed.previousSupportedTags = next
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        i += 1;
        break;
      case "--release-commit-sha":
        parsed.releaseCommitSha = next;
        i += 1;
        break;
      case "--commit-message":
        parsed.commitMessage = next;
        i += 1;
        break;
      case "--db-mode":
        parsed.dbMode = next as DbMode;
        i += 1;
        break;
      case "--db-sql-path":
        parsed.dbSqlPath = next;
        i += 1;
        break;
      case "--db-summary":
        parsed.dbSummary = next;
        i += 1;
        break;
      case "--required-env":
        parsed.requiredEnvKeys = next
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        i += 1;
        break;
      case "--notes-file":
        parsed.notesFile = next;
        i += 1;
        break;
      case "--manual-review":
        parsed.manualReview = true;
        break;
      case "--destructive-db":
        parsed.destructiveDb = true;
        break;
      case "--initial-release":
        parsed.initialRelease = true;
        break;
      case "--stdout":
        parsed.stdout = true;
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      default:
        if (arg.startsWith("--")) {
          throw new Error(`Unknown argument: ${arg}`);
        }
    }
  }

  return parsed;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trimEnd();
}

function getRepoRoot(cwd: string): string {
  return git(cwd, ["rev-parse", "--show-toplevel"]).trim();
}

function normalizeReleaseTag(input: string): string {
  return input.startsWith("v") ? input : `v${input}`;
}

function normalizeReleaseTags(inputs: string[]): string[] {
  return Array.from(
    new Set(
      inputs
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => normalizeReleaseTag(item)),
    ),
  );
}

function getPackageVersion(repoRoot: string): string {
  const packageJsonPath = path.join(repoRoot, "package.json");
  const raw = fs.readFileSync(packageJsonPath, "utf8");
  const data = JSON.parse(raw) as { version?: string };
  if (!data.version?.trim()) {
    throw new Error("package.json is missing version");
  }
  return data.version.trim();
}

function getBlobSha(repoRoot: string, ref: string, filePath: string): string {
  return git(repoRoot, ["rev-parse", `${ref}:${filePath}`]).trim();
}

function getFileContent(repoRoot: string, ref: string, filePath: string): string {
  return execFileSync("git", ["show", `${ref}:${filePath}`], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function listChangedFiles(repoRoot: string, fromRef: string, toRef: string) {
  const output = git(repoRoot, [
    "diff",
    "--name-status",
    "--diff-filter=AMD",
    "--no-renames",
    fromRef,
    toRef,
  ]);

  if (!output.trim()) {
    return [] as Array<{ status: "A" | "M" | "D"; path: string }>;
  }

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, ...rest] = line.split("\t");
      return {
        status: status as "A" | "M" | "D",
        path: rest.join("\t"),
      };
    });
}

function buildCreateDiff(filePath: string, content: string): string {
  const lines = content.split("\n");
  const output = [`@@ ${filePath}`];
  for (const line of lines) {
    output.push(`+${line}`);
  }
  return output.join("\n");
}

function convertUnifiedDiffToV4A(filePath: string, diff: string): string {
  const lines = diff.split("\n");
  const out: string[] = [];

  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith("diff --git ")) continue;
    if (line.startsWith("index ")) continue;
    if (line.startsWith("--- ")) continue;
    if (line.startsWith("+++ ")) continue;
    if (line === "\\ No newline at end of file") continue;

    if (line.startsWith("@@")) {
      const match = line.match(/^@@ -[^ ]+ \+[^ ]+ @@ ?(.*)$/);
      const hint = match?.[1]?.trim() || filePath;
      out.push(`@@ ${hint}`);
      continue;
    }

    if (
      line.startsWith(" ") ||
      line.startsWith("+") ||
      line.startsWith("-")
    ) {
      out.push(line);
    }
  }

  if (out.length === 0) {
    throw new Error(`No applicable text diff hunks found for ${filePath}`);
  }

  return out.join("\n");
}

function generatePatchForFile(
  repoRoot: string,
  fromRef: string,
  toRef: string,
  file: { status: "A" | "M" | "D"; path: string },
): UpdateManifestPatch {
  if (file.status === "A") {
    const content = getFileContent(repoRoot, toRef, file.path);
    return {
      type: "create_file",
      path: file.path,
      diff: buildCreateDiff(file.path, content),
    };
  }

  if (file.status === "D") {
    return {
      type: "delete_file",
      path: file.path,
      expected_blob_sha: getBlobSha(repoRoot, fromRef, file.path),
    };
  }

  const unifiedDiff = execFileSync(
    "git",
    [
      "diff",
      "--no-color",
      "--unified=3",
      "--no-renames",
      fromRef,
      toRef,
      "--",
      file.path,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  return {
    type: "update_file",
    path: file.path,
    diff: convertUnifiedDiffToV4A(file.path, unifiedDiff),
    expected_blob_sha: getBlobSha(repoRoot, fromRef, file.path),
  };
}

function getDefaultNotesPath(repoRoot: string, releaseTag: string): string {
  return path.join(repoRoot, "release-notes", `${releaseTag}.md`);
}

function getNotesMarkdown(
  repoRoot: string,
  releaseTag: string,
  fromRef: string | undefined,
  toRef: string,
  notesFile?: string,
  initialRelease = false,
): string | undefined {
  const explicitPath = notesFile ? path.resolve(repoRoot, notesFile) : null;
  const defaultNotesPath = getDefaultNotesPath(repoRoot, releaseTag);

  if (explicitPath && fs.existsSync(explicitPath)) {
    return fs.readFileSync(explicitPath, "utf8").trim();
  }

  if (!explicitPath && fs.existsSync(defaultNotesPath)) {
    return fs.readFileSync(defaultNotesPath, "utf8").trim();
  }

  if (initialRelease || !fromRef) {
    return `## Highlights\n\n- Initial public release of ${releaseTag}\n`;
  }

  const logOutput = git(repoRoot, [
    "log",
    "--format=%s",
    `${fromRef}..${toRef}`,
  ]);

  const entries = logOutput
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    return undefined;
  }

  return `## Changes\n\n${entries.map((entry) => `- ${entry}`).join("\n")}`;
}

function writeManifest(
  repoRoot: string,
  outputPath: string,
  manifest: UpdateManifest,
) {
  const absoluteOutputPath = path.resolve(repoRoot, outputPath);
  fs.mkdirSync(path.dirname(absoluteOutputPath), { recursive: true });
  fs.writeFileSync(
    absoluteOutputPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const repoRoot = getRepoRoot(process.cwd());
  const packageVersion = getPackageVersion(repoRoot);
  const releaseTag = normalizeReleaseTag(args.releaseTag || packageVersion);
  const releaseCommitSha =
    args.releaseCommitSha?.trim() || git(repoRoot, ["rev-parse", args.to]).trim();
  const previousTagCandidates = normalizeReleaseTags([
    args.previousSupportedTag || "",
    ...args.previousSupportedTags,
    args.initialRelease ? releaseTag : args.from?.startsWith("v") ? args.from : "",
  ]);
  const previousSupportedTag = previousTagCandidates[0] || "";

  if (!args.initialRelease && !args.from) {
    throw new Error("--from is required unless --initial-release is used");
  }
  if (!previousSupportedTag) {
    throw new Error(
      "previous_supported_tag is required. Pass --previous-supported-tag when --from is not a release tag.",
    );
  }

  const dbMode: DbMode =
    args.dbMode || (args.dbSqlPath ? "manual_apply" : "none");
  if (dbMode === "manual_apply" && !args.dbSqlPath) {
    throw new Error("--db-sql-path is required when --db-mode=manual_apply");
  }

  const changedFiles = args.initialRelease
    ? []
    : listChangedFiles(repoRoot, args.from!, args.to)
        .filter((file) => !DEFAULT_IGNORED_PATHS.has(file.path));

  const patches = changedFiles.map((file) =>
    generatePatchForFile(repoRoot, args.from!, args.to, file),
  );

  const notesMd = getNotesMarkdown(
    repoRoot,
    releaseTag,
    args.from,
    args.to,
    args.notesFile,
    args.initialRelease,
  );

  const manifest: UpdateManifest = {
    manifest_version: 1,
    release_tag: releaseTag,
    release_commit_sha: releaseCommitSha,
    previous_supported_tag: previousSupportedTag,
    previous_supported_tags: previousTagCandidates,
    requires_manual_review: args.manualReview || undefined,
    required_env_keys:
      args.requiredEnvKeys.length > 0 ? args.requiredEnvKeys : undefined,
    commit_message:
      args.commitMessage?.trim() || `release: upgrade to ${releaseTag}`,
    patches,
    db: {
      mode: dbMode,
      destructive: args.destructiveDb,
      sql_path: args.dbSqlPath,
      summary: args.dbSummary,
    },
    notes_md: notesMd,
  };

  if (args.stdout) {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return;
  }

  writeManifest(repoRoot, args.output, manifest);
  console.log(
    `Generated ${path.relative(repoRoot, path.resolve(repoRoot, args.output))} with ${patches.length} patch(es).`,
  );
}

try {
  main();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Unknown manifest generation error",
  );
  process.exit(1);
}
