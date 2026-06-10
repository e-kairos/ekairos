import { NextResponse } from "next/server";
import { runDemoSeed } from "@/lib/demo/provision.service";
import { resolveInstantCredentials } from "@/lib/demo/tenant.service";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      appId?: string;
      adminToken?: string;
      seedId?: string;
      reset?: boolean;
    };
    const appId = String(body.appId ?? "").trim();
    const seedId = String(body.seedId ?? "").trim();
    if (!appId || !seedId) {
      return NextResponse.json({ ok: false, error: "appId and seedId are required." }, { status: 400 });
    }
    const credentials = await resolveInstantCredentials({
      appId,
      adminToken: body.adminToken ?? null,
    });
    const data = await runDemoSeed({
      seedId,
      appId: credentials.appId,
      adminToken: credentials.adminToken,
      reset: Boolean(body.reset),
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
