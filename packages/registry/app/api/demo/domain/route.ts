import { NextResponse } from "next/server";
import { ensureDomainSchema } from "@/lib/demo/provision.service";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { appId?: string; domainId?: string };
    const appId = String(body.appId ?? "").trim();
    const domainId = String(body.domainId ?? "").trim();
    if (!appId || !domainId) {
      return NextResponse.json({ ok: false, error: "appId and domainId are required." }, { status: 400 });
    }
    const data = await ensureDomainSchema({ appId, domainId });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
