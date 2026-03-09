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

export async function installPackages(
  apiKey: string,
  packages: string[],
  manager: "pip" | "npm" = "pip"
): Promise<{ stdout: string; stderr: string; error?: string }> {
  const sbx = await Sandbox.create({ apiKey });
  try {
    const cmd =
      manager === "pip"
        ? `pip install ${packages.join(" ")}`
        : `npm install ${packages.join(" ")}`;

    const result = await sbx.commands.run(cmd, { timeoutMs: 120_000 });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.exitCode !== 0 ? `Exit code: ${result.exitCode}` : undefined,
    };
  } finally {
    await sbx.kill().catch(() => {});
  }
}

export async function sandboxFileOps(
  apiKey: string,
  operation: "write" | "read" | "list",
  path: string,
  content?: string
): Promise<{ data?: string | string[]; error?: string }> {
  const sbx = await Sandbox.create({ apiKey });
  try {
    if (operation === "write") {
      if (!content) return { error: "Content is required for write operation" };
      await sbx.files.write(path, content);
      return { data: `File written: ${path}` };
    }
    if (operation === "read") {
      const data = await sbx.files.read(path);
      return { data: data.toString() };
    }
    if (operation === "list") {
      const entries = await sbx.files.list(path);
      return { data: entries.map((e) => e.name) };
    }
    return { error: `Unknown operation: ${operation}` };
  } finally {
    await sbx.kill().catch(() => {});
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
