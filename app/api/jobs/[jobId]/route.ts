import { NextResponse } from "next/server"
import { getJob } from "@/lib/jobs/store"

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const job = await getJob(jobId)

  if (!job) {
    return NextResponse.json({ ok: false, error: "Job nao encontrado." }, { status: 404 })
  }

  return NextResponse.json({ ok: true, job })
}
