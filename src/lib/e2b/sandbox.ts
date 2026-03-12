import { Sandbox } from "@e2b/code-interpreter";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto/encrypt";

function getSupabase() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function getE2BApiKey(): Promise<string | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("secrets")
    .select("encrypted_value")
    .eq("key_name", "E2B_API_KEY")
    .single();

  if (!data?.encrypted_value) return null;
  try {
    return decrypt(data.encrypted_value);
  } catch {
    return null;
  }
}

export interface CodeResult {
  text?: string;
  png?: string;
  html?: string;
}

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  results: CodeResult[];
  error?: string;
  previewUrl?: string;
  sandboxId?: string;
  executionTimeMs: number;
}

export async function createE2BSandbox(apiKey: string): Promise<Sandbox> {
  return Sandbox.create({ apiKey });
}

function extractLogs(execution: { logs: { stdout: unknown[]; stderr: unknown[] } }): { stdout: string; stderr: string } {
  const stringify = (arr: unknown[]) =>
    arr.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "line" in item) return (item as { line: string }).line;
      return JSON.stringify(item);
    }).join("\n");
  return { stdout: stringify(execution.logs.stdout), stderr: stringify(execution.logs.stderr) };
}

export async function runPythonCode(
  apiKey: string,
  code: string
): Promise<ExecutionResult> {
  const start = Date.now();
  const sbx = await Sandbox.create({ apiKey });
  try {
    const execution = await sbx.runCode(code, { language: "python" });
    const { stdout, stderr } = extractLogs(execution);

    const results: CodeResult[] = (execution.results ?? []).map(
      (r: { text?: string; png?: string; html?: string }) => ({
        text: r.text,
        png: r.png,
        html: r.html,
      })
    );

    return {
      stdout,
      stderr,
      results,
      error: execution.error ? `${execution.error.name}: ${execution.error.value}` : undefined,
      sandboxId: sbx.sandboxId,
      executionTimeMs: Date.now() - start,
    };
  } finally {
    await sbx.kill().catch(() => {});
  }
}

export async function runJavaScriptCode(
  apiKey: string,
  code: string
): Promise<ExecutionResult> {
  const start = Date.now();
  const sbx = await Sandbox.create({ apiKey });
  try {
    const execution = await sbx.runCode(code, { language: "js" });
    const { stdout, stderr } = extractLogs(execution);

    const results: CodeResult[] = (execution.results ?? []).map(
      (r: { text?: string }) => ({ text: r.text })
    );

    return {
      stdout,
      stderr,
      results,
      error: execution.error ? `${execution.error.name}: ${execution.error.value}` : undefined,
      sandboxId: sbx.sandboxId,
      executionTimeMs: Date.now() - start,
    };
  } finally {
    await sbx.kill().catch(() => {});
  }
}

export function runHTMLPreview(html: string): ExecutionResult {
  return {
    stdout: "",
    stderr: "",
    results: [{ html }],
    executionTimeMs: 0,
  };
}

export async function saveHTMLPreview(
  html: string,
  title?: string
): Promise<{ id: string; previewUrl: string }> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("html_previews")
    .insert({ html, title: title || "Untitled" })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to store preview");
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");

  return {
    id: data.id,
    previewUrl: `${baseUrl}/preview/${data.id}`,
  };
}

const BUILD_TIMEOUT_MS = 55 * 60 * 1000;
const RESULT_FILE = "/home/user/.build_result.json";
const AUTO_COMMAND = "__AUTO__";
const BUILD_STALL_TIMEOUT_MS = 15 * 60 * 1000;

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface BuildVerifyParams {
  apiKey: string;
  repoUrl: string;
  githubToken?: string;
  files: { path: string; content: string }[];
  deleteFiles?: string[];
  installCmd?: string;
  buildCmd?: string;
  serveCmd?: string;
  port?: number;
}

export async function startBuildVerify(
  params: BuildVerifyParams
): Promise<{ sandboxId: string }> {
  const {
    apiKey,
    repoUrl,
    githubToken,
    files,
    deleteFiles = [],
    installCmd = AUTO_COMMAND,
    buildCmd = AUTO_COMMAND,
    serveCmd,
    port = 3000,
  } = params;

  const sbx = await Sandbox.create({ apiKey, timeoutMs: BUILD_TIMEOUT_MS });

  const cloneUrl = githubToken
    ? repoUrl.replace("https://", `https://${githubToken}@`)
    : repoUrl;

  await sbx.commands.run("mkdir -p /home/user/patches", { timeoutMs: 5_000 });
  for (const file of files) {
    const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
    if (dir) {
      await sbx.commands.run(`mkdir -p ${shellEscape(`/home/user/patches/${dir}`)}`, { timeoutMs: 5_000 });
    }
    const patchPath = `/home/user/patches/${file.path}`;
    await sbx.files.write(patchPath, file.content);
  }

  await sbx.files.write(
    RESULT_FILE,
    JSON.stringify({ status: "building", phase: "queued", log: "Build queued." })
  );

  const deleteScript = deleteFiles
    .map((f) => `rm -f ${shellEscape(`/home/user/project/${f}`)}`)
    .join("\n");

  const patchScript = files
    .map((f) => {
      const dir = f.path.includes("/") ? f.path.substring(0, f.path.lastIndexOf("/")) : "";
      const mkdirCmd = dir ? `mkdir -p ${shellEscape(`/home/user/project/${dir}`)}` : "";
      return `${mkdirCmd}\ncp ${shellEscape(`/home/user/patches/${f.path}`)} ${shellEscape(`/home/user/project/${f.path}`)}`;
    })
    .join("\n");

  const script = `#!/bin/bash
set -uo pipefail
RESULT_FILE="${RESULT_FILE}"
AUTO_COMMAND="${AUTO_COMMAND}"
PORT="${port}"
INSTALL_CMD=${shellEscape(installCmd)}
BUILD_CMD=${shellEscape(buildCmd)}
SERVE_CMD=${shellEscape(serveCmd?.trim() || AUTO_COMMAND)}
cd /home/user

write_status() {
  python - "$1" "$2" "$3" "$4" "$5" "$RESULT_FILE" <<'PY'
import json
import sys
from datetime import datetime, timezone

status, phase, log, preview, preview_port, result_file = sys.argv[1:7]
payload = {
    "status": status,
    "phase": phase,
    "log": log,
    "preview": preview == "true",
    "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
}
if preview_port != "null":
    payload["previewPort"] = int(preview_port)

with open(result_file, "w", encoding="utf-8") as fh:
    json.dump(payload, fh)
PY
}

pick_runner() {
  if [ -f pnpm-lock.yaml ]; then
    echo "pnpm"
  elif [ -f yarn.lock ]; then
    echo "yarn"
  else
    echo "npm"
  fi
}

has_script() {
  python - "$1" <<'PY'
import json
import sys
from pathlib import Path

script = sys.argv[1]
package_json = Path("package.json")
if not package_json.exists():
    raise SystemExit(1)
data = json.loads(package_json.read_text(encoding="utf-8"))
scripts = data.get("scripts", {})
raise SystemExit(0 if script in scripts else 1)
PY
}

is_next_project() {
  python - <<'PY'
import json
from pathlib import Path

package_json = Path("package.json")
if not package_json.exists():
    raise SystemExit(1)
data = json.loads(package_json.read_text(encoding="utf-8"))
deps = data.get("dependencies", {})
dev_deps = data.get("devDependencies", {})
raise SystemExit(0 if "next" in deps or "next" in dev_deps else 1)
PY
}

# Clone
write_status "building" "clone" "Cloning repository..." "false" "null"
git clone --depth 1 ${shellEscape(cloneUrl)} project > /tmp/clone.log 2>&1
if [ $? -ne 0 ]; then
  CLONE_LOG=$(cat /tmp/clone.log | head -20 | tr '"' "'" | tr '\\n' ' ')
  write_status "failed" "clone" "$CLONE_LOG" "false" "null"
  exit 1
fi
cd project

# Apply patches
${deleteScript}
${patchScript}

RUNNER=$(pick_runner)
if [ "$RUNNER" = "pnpm" ] || [ "$RUNNER" = "yarn" ]; then
  if command -v corepack >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 || true
  fi
fi
if [ "$INSTALL_CMD" = "$AUTO_COMMAND" ]; then
  if [ "$RUNNER" = "pnpm" ]; then
    INSTALL_CMD="pnpm install --frozen-lockfile"
  elif [ "$RUNNER" = "yarn" ]; then
    INSTALL_CMD="yarn install --frozen-lockfile"
  elif [ -f package-lock.json ]; then
    INSTALL_CMD="npm ci"
  else
    INSTALL_CMD="npm install"
  fi
fi

if [ "$BUILD_CMD" = "$AUTO_COMMAND" ]; then
  if has_script build; then
    if [ "$RUNNER" = "pnpm" ]; then
      BUILD_CMD="pnpm build"
    elif [ "$RUNNER" = "yarn" ]; then
      BUILD_CMD="yarn build"
    else
      BUILD_CMD="npm run build"
    fi
  else
    BUILD_CMD="true"
  fi
fi

if [ "$SERVE_CMD" = "$AUTO_COMMAND" ]; then
  if is_next_project && has_script start; then
    if [ "$RUNNER" = "pnpm" ]; then
      SERVE_CMD="PORT=$PORT HOSTNAME=0.0.0.0 pnpm start"
    elif [ "$RUNNER" = "yarn" ]; then
      SERVE_CMD="PORT=$PORT HOSTNAME=0.0.0.0 yarn start"
    else
      SERVE_CMD="PORT=$PORT HOSTNAME=0.0.0.0 npm run start"
    fi
  elif [ -d dist ]; then
    SERVE_CMD="npx serve dist -l $PORT"
  elif [ -d build ]; then
    SERVE_CMD="npx serve build -l $PORT"
  elif [ -d out ]; then
    SERVE_CMD="npx serve out -l $PORT"
  else
    SERVE_CMD=""
  fi
fi

# Install
write_status "building" "install" "Installing dependencies..." "false" "null"
bash -lc "$INSTALL_CMD" > /tmp/install.log 2>&1
if [ $? -ne 0 ]; then
  INSTALL_LOG=$(tail -30 /tmp/install.log | tr '"' "'" | tr '\\n' ' ')
  write_status "failed" "install" "$INSTALL_LOG" "false" "null"
  exit 1
fi

# Build
write_status "building" "build" "Running build..." "false" "null"
bash -lc "$BUILD_CMD" > /tmp/build.log 2>&1
if [ $? -ne 0 ]; then
  BUILD_LOG=$(tail -30 /tmp/build.log | tr '"' "'" | tr '\\n' ' ')
  write_status "failed" "build" "$BUILD_LOG" "false" "null"
  exit 1
fi

BUILD_LOG=$(tail -10 /tmp/build.log | tr '"' "'" | tr '\\n' ' ')

if [ -n "$SERVE_CMD" ]; then
  write_status "building" "serve" "Starting preview server..." "false" "null"
  bash -lc "$SERVE_CMD" > /tmp/serve.log 2>&1 &
  SERVE_PID=$!
  PREVIEW_READY=0
  for _ in $(seq 1 20); do
    python - "$PORT" <<'PY'
import sys
import urllib.request
import urllib.error

port = int(sys.argv[1])
try:
    with urllib.request.urlopen(f"http://127.0.0.1:{port}", timeout=2) as response:
        raise SystemExit(0 if response.status < 500 else 1)
except urllib.error.HTTPError as error:
    raise SystemExit(0 if error.code < 500 else 1)
except Exception:
    raise SystemExit(1)
PY
    if [ $? -eq 0 ]; then
      PREVIEW_READY=1
      break
    fi
    if ! kill -0 "$SERVE_PID" 2>/dev/null; then
      break
    fi
    sleep 1
  done

  if [ "$PREVIEW_READY" -ne 1 ]; then
    SERVE_LOG=$(tail -30 /tmp/serve.log | tr '"' "'" | tr '\\n' ' ')
    write_status "failed" "serve" "$SERVE_LOG" "false" "null"
    exit 1
  fi

  write_status "success" "complete" "$BUILD_LOG" "true" "$PORT"
else
  write_status "success" "complete" "$BUILD_LOG" "false" "null"
fi
`;

  await sbx.files.write("/home/user/build.sh", script);
  await sbx.commands.run("chmod +x /home/user/build.sh", { timeoutMs: 5_000 });
  await sbx.commands.run("/home/user/build.sh", { background: true });

  return { sandboxId: sbx.sandboxId };
}

export interface BuildStatus {
  status: "building" | "success" | "failed";
  phase?: string;
  log?: string;
  previewUrl?: string;
  errorCode?: string;
  updatedAt?: string;
}

export async function checkBuildStatus(
  apiKey: string,
  sandboxId: string,
  port = 3000
): Promise<BuildStatus> {
  let sbx: Sandbox;
  try {
    sbx = await Sandbox.connect(sandboxId, { apiKey });
  } catch (err) {
    return {
      status: "failed",
      phase: "connect",
      log: err instanceof Error ? err.message : "Sandbox is no longer reachable",
      errorCode: "sandbox_unreachable",
    };
  }

  try {
    const content = await sbx.files.read(RESULT_FILE);
    const text = String(content);
    const result = JSON.parse(text) as {
      status: string;
      phase?: string;
      log?: string;
      preview?: boolean;
      previewPort?: number;
      updatedAt?: string;
    };

    if (result.status === "success") {
      const previewPort = result.previewPort ?? port;
      return {
        status: "success",
        phase: result.phase,
        log: result.log,
        previewUrl: result.preview ? `https://${sbx.getHost(previewPort)}` : undefined,
        updatedAt: result.updatedAt,
      };
    }

    if (result.status === "building") {
      if (result.updatedAt) {
        const updatedAtMs = Date.parse(result.updatedAt);
        if (Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs > BUILD_STALL_TIMEOUT_MS) {
          await sbx.kill().catch(() => {});
          return {
            status: "failed",
            phase: result.phase || "building",
            log: `Build appears stalled for more than ${Math.floor(BUILD_STALL_TIMEOUT_MS / 60000)} minutes.`,
            errorCode: "build_stalled",
            updatedAt: result.updatedAt,
          };
        }
      }
      return {
        status: "building",
        phase: result.phase,
        log: result.log,
        updatedAt: result.updatedAt,
      };
    }

    await sbx.kill().catch(() => {});
    return {
      status: "failed",
      phase: result.phase,
      log: result.log,
      errorCode: "build_failed",
      updatedAt: result.updatedAt,
    };
  } catch (err) {
    return {
      status: "failed",
      phase: "status",
      log: err instanceof Error ? err.message : "Failed to read build status",
      errorCode: "status_read_failed",
    };
  }
}

export async function testConnection(apiKey: string): Promise<{ success: boolean; error?: string }> {
  try {
    const sbx = await Sandbox.create({ apiKey });
    await sbx.kill();
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
