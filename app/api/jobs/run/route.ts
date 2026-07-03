import { type NextRequest, NextResponse } from "next/server"
import { JobsClient } from "@google-cloud/run"
import { createJob, type JobKind } from "@/lib/jobs/store"
import type { CatalogSyncRequest } from "@/lib/sync/catalog-sync"
import type { ColorTermsSyncRequest } from "@/lib/sync/color-terms-sync"

interface RunJobRequestBody {
  kind: JobKind
  payload: CatalogSyncRequest | ColorTermsSyncRequest
}

const JOB_NAME_ENV: Record<JobKind, string> = {
  catalog: "CLOUD_RUN_CATALOG_JOB_NAME",
  "color-terms": "CLOUD_RUN_COLOR_TERMS_JOB_NAME",
}

let jobsClient: JobsClient | null = null

function getJobsClient(): JobsClient {
  if (!jobsClient) jobsClient = new JobsClient()
  return jobsClient
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Partial<RunJobRequestBody>

  if (body.kind !== "catalog" && body.kind !== "color-terms") {
    return NextResponse.json({ ok: false, error: "Campo 'kind' invalido." }, { status: 400 })
  }
  if (!body.payload || typeof body.payload !== "object") {
    return NextResponse.json({ ok: false, error: "Campo 'payload' obrigatorio." }, { status: 400 })
  }

  const project = process.env.GOOGLE_CLOUD_PROJECT
  const region = process.env.CLOUD_RUN_JOB_REGION
  const jobName = process.env[JOB_NAME_ENV[body.kind]]

  if (!project || !region || !jobName) {
    return NextResponse.json(
      { ok: false, error: "Cloud Run Jobs nao configurado (GOOGLE_CLOUD_PROJECT / CLOUD_RUN_JOB_REGION / nome do job)." },
      { status: 500 },
    )
  }

  const jobId = await createJob(body.kind, body.payload)

  try {
    await getJobsClient().runJob({
      name: `projects/${project}/locations/${region}/jobs/${jobName}`,
      overrides: {
        containerOverrides: [
          {
            env: [
              { name: "JOB_ID", value: jobId },
              { name: "JOB_KIND", value: body.kind },
              { name: "JOB_PAYLOAD", value: JSON.stringify(body.payload) },
            ],
          },
        ],
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha ao disparar a execucao do Cloud Run Job."
    return NextResponse.json({ ok: false, jobId, error: message }, { status: 502 })
  }

  return NextResponse.json({ ok: true, jobId })
}
