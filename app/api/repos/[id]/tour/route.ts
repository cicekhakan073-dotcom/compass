import { NextResponse } from "next/server";
import { planTour } from "@/agents/tour-director";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Opus 4.7 + ~7 step structured output ≈ 5-15 seconds on average.
export const maxDuration = 60;

interface TourRequestBody {
  focus?: string;
}

/**
 * POST /api/repos/[id]/tour
 *
 * One-shot tour planner. Returns the full 5-7 step plan as JSON; the client
 * walks through steps on user "Devam" clicks. This is deliberately *not* an
 * SSE stream — for a 60-second total session, a single 5-second plan call
 * gives a more reliable demo than mid-stream UI commands that can race.
 *
 * UI actions still flow "server → client", just bundled into one envelope.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const repoId = Number.parseInt(id, 10);
  if (!Number.isFinite(repoId)) {
    return NextResponse.json({ error: "Invalid repo id." }, { status: 400 });
  }

  let body: TourRequestBody = {};
  if (request.headers.get("content-type")?.includes("application/json")) {
    try {
      body = (await request.json()) as TourRequestBody;
    } catch {
      // Empty body is fine — full overview tour.
    }
  }

  try {
    const t0 = Date.now();
    const plan = await planTour(repoId, { focus: body.focus });
    return NextResponse.json({
      ok: true,
      latencyMs: Date.now() - t0,
      plan,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
