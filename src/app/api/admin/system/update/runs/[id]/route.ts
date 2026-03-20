import { NextRequest, NextResponse } from "next/server";
import {
  authErrorResponse,
  createAdminClient,
  requireAdmin,
} from "@/lib/supabase/server";
import {
  getUpdateRunById,
  refreshUpdateRun,
} from "@/lib/system-update/service";
import { VercelApiError } from "@/lib/github/api";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const { id } = await context.params;

  try {
    const db = await createAdminClient();
    const current = await getUpdateRunById(db, id);
    if (!current) {
      return NextResponse.json({ error: "Update run not found" }, { status: 404 });
    }
    const run = await refreshUpdateRun(db, id);
    return NextResponse.json({ run: run ?? current });
  } catch (err) {
    const db = await createAdminClient();
    const current = await getUpdateRunById(db, id);
    if (current && ["deploy_pending", "rollback_running"].includes(current.status)) {
      const pollError = toRetriablePollError(err);
      if (pollError) {
        return NextResponse.json({
          run: {
            ...current,
            error_summary: pollError.userMessage,
            details_json: {
              ...current.details_json,
              vercel_check_error: pollError.technicalMessage,
            },
          },
          pollError,
        });
      }
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load update run" },
      { status: 500 },
    );
  }
}

function toRetriablePollError(err: unknown): {
  code: string;
  userMessage: string;
  technicalMessage: string;
} | null {
  if (err instanceof VercelApiError) {
    if (err.invalidToken || err.status === 401) {
      return {
        code: "vercel_bad_token",
        userMessage:
          "Vercel Token 目前无效或已过期。去 Dashboard > Coding 修正后，当前升级任务会自动继续检查部署状态。",
        technicalMessage: err.message,
      };
    }
    if (err.status === 403) {
      return {
        code: "vercel_access_denied",
        userMessage:
          "当前 Vercel Token 无权访问这个项目。修正 Token 所属账号或团队后，当前升级任务会自动继续检查。",
        technicalMessage: err.message,
      };
    }
    if (err.status === 404) {
      return {
        code: "vercel_project_not_found",
        userMessage:
          "当前 Vercel Project ID 不正确。去 Dashboard > Coding 修正后，当前升级任务会自动继续检查，无需重新开始。",
        technicalMessage: err.message,
      };
    }
    return {
      code: "vercel_check_failed",
      userMessage:
        "Vercel 部署状态暂时无法读取。请先检查 Vercel Token / Project ID，修正后当前升级任务会自动继续。",
      technicalMessage: err.message,
    };
  }

  if (
    err instanceof Error &&
    /VERCEL_TOKEN or VERCEL_PROJECT_ID is not configured/i.test(err.message)
  ) {
    return {
      code: "vercel_config_missing",
      userMessage:
        "Vercel Token 或 Project ID 还没有配置完整。补齐后，当前升级任务会自动继续检查部署状态。",
      technicalMessage: err.message,
    };
  }

  return null;
}
