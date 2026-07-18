import { NextResponse } from "next/server"

import { azureModelName } from "@/src/azure"
import { ensureWorkbenchContext } from "@/src/runtime.server"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const state = await ensureWorkbenchContext()
    return NextResponse.json({
      appId: state.appId,
      contextId: state.context.id,
      contextKey: state.context.key,
      model: azureModelName(),
      sandbox: state.sandboxProvider,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
