import { cookies } from "next/headers";
import { SETUP_BOOTSTRAP_COOKIE } from "@/lib/setup/bootstrap";
import {
  getSetupEnvironmentIssues,
  type SetupEnvironmentIssue,
} from "@/lib/setup/environment";
import { createClient, createStrictServiceClient } from "@/lib/supabase/server";

export type SetupBlockingReason =
  | "missing_service_role_env"
  | "invalid_deployment_env"
  | null;

export interface SetupStatus {
  needsSetup: boolean;
  setupComplete: boolean;
  currentStep: number;
  hasSupabaseKeys: boolean;
  hasAdmin: boolean;
  hasActiveAdminSession: boolean;
  hasServiceRoleEnv: boolean;
  hasLLMKey: boolean;
  hasAgent: boolean;
  hasBootstrapCookie: boolean;
  blockingReason: SetupBlockingReason;
  environmentIssues: SetupEnvironmentIssue[];
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const cookieStore = await cookies();
  const hasBootstrapCookie = Boolean(cookieStore.get(SETUP_BOOTSTRAP_COOKIE)?.value);
  const hasServiceRoleEnv = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const environmentIssues = getSetupEnvironmentIssues();
  const blockingReason: SetupBlockingReason = !hasServiceRoleEnv
    ? "missing_service_role_env"
    : environmentIssues.length > 0
      ? "invalid_deployment_env"
      : null;

  if (blockingReason) {
    return {
      needsSetup: true,
      setupComplete: false,
      currentStep: 0,
      hasSupabaseKeys: false,
      hasAdmin: false,
      hasActiveAdminSession: false,
      hasServiceRoleEnv,
      hasLLMKey: false,
      hasAgent: false,
      hasBootstrapCookie,
      blockingReason,
      environmentIssues,
    };
  }

  const db = createStrictServiceClient();
  const sessionClient = await createClient();
  const [
    admins,
    secrets,
    agents,
    providerKeys,
    {
      data: { user },
    },
  ] = await Promise.all([
    db.from("admins").select("auth_uid"),
    db.from("secrets").select("key_name"),
    db.from("agents").select("*", { count: "exact", head: true }),
    db.from("provider_api_keys").select("*", { count: "exact", head: true }),
    sessionClient.auth.getUser(),
  ]);

  const hasAdmin = !admins.error && (admins.data?.length ?? 0) > 0;
  const hasActiveAdminSession = Boolean(
    user &&
      !admins.error &&
      (admins.data ?? []).some((admin) => admin.auth_uid === user.id)
  );
  const secretKeys = !secrets.error ? (secrets.data ?? []).map((row) => row.key_name) : [];
  const hasSupabaseKeys =
    secretKeys.includes("SUPABASE_ACCESS_TOKEN") &&
    secretKeys.includes("SUPABASE_PROJECT_REF");
  const hasLLMKey = !providerKeys.error && (providerKeys.count ?? 0) > 0;
  const hasAgent = !agents.error && (agents.count ?? 0) > 0;

  const setupComplete =
    hasServiceRoleEnv && hasSupabaseKeys && hasAdmin && hasLLMKey && hasAgent;

  let currentStep = 0;
  if (hasSupabaseKeys) currentStep = 1;
  if (hasSupabaseKeys && hasAdmin && hasActiveAdminSession) currentStep = 2;
  if (
    hasSupabaseKeys &&
    hasAdmin &&
    hasActiveAdminSession &&
    hasServiceRoleEnv &&
    hasLLMKey
  ) {
    currentStep = 3;
  }
  if (setupComplete) currentStep = 4;

  return {
    needsSetup: !setupComplete,
    setupComplete,
    currentStep,
    hasSupabaseKeys,
    hasAdmin,
    hasActiveAdminSession,
    hasServiceRoleEnv,
    hasLLMKey,
    hasAgent,
    hasBootstrapCookie,
    blockingReason: null,
    environmentIssues,
  };
}
