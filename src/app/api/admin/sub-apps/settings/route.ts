import { NextResponse } from "next/server";
import {
  authErrorResponse,
  requireAdmin,
} from "@/lib/supabase/server";
import {
  ROOM_SUB_APP_SLUG,
  generateAndStoreRoomSubAppConfig,
  getRoomSubAppConfigStatus,
  saveRoomSubAppConfig,
} from "@/lib/sub-app-settings";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch (error) {
    return authErrorResponse(error);
  }

  const { searchParams } = new URL(request.url);
  const subAppSlug = searchParams.get("sub_app_slug");

  if (subAppSlug !== ROOM_SUB_APP_SLUG) {
    return NextResponse.json({ error: "Unsupported sub-app" }, { status: 400 });
  }

  try {
    const status = await getRoomSubAppConfigStatus();
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load sub-app settings" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    await requireAdmin();
  } catch (error) {
    return authErrorResponse(error);
  }

  const body = (await request.json()) as {
    sub_app_slug?: string;
    settings?: Record<string, string>;
  };

  if (body.sub_app_slug !== ROOM_SUB_APP_SLUG) {
    return NextResponse.json({ error: "Unsupported sub-app" }, { status: 400 });
  }

  try {
    const status = await saveRoomSubAppConfig({
      ROOM_TOKEN_SECRET: body.settings?.ROOM_TOKEN_SECRET,
      ROOM_REALTIME_JWT_PRIVATE_KEY: body.settings?.ROOM_REALTIME_JWT_PRIVATE_KEY,
      ROOM_REALTIME_JWT_KID: body.settings?.ROOM_REALTIME_JWT_KID,
    });
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save sub-app settings" },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch (error) {
    return authErrorResponse(error);
  }

  const body = (await request.json()) as {
    action?: string;
    sub_app_slug?: string;
  };

  if (body.sub_app_slug !== ROOM_SUB_APP_SLUG) {
    return NextResponse.json({ error: "Unsupported sub-app" }, { status: 400 });
  }

  if (body.action !== "generate_room_security_bundle") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  try {
    const result = await generateAndStoreRoomSubAppConfig();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate sub-app settings" },
      { status: 500 },
    );
  }
}
