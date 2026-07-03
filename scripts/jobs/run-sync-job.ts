import { withExternalApiConfigOverrides, type ExternalApiConfigOverrides } from "@/lib/server-api-config"
import { runCatalogSync, type CatalogSyncRequest, type CatalogSyncProgress } from "@/lib/sync/catalog-sync"
import { runColorTermsSync, type ColorTermsSyncRequest, type ColorTermsProgress } from "@/lib/sync/color-terms-sync"
import { markJobRunning, updateJobProgress, completeJob, failJob, type JobKind } from "@/lib/jobs/store"

const PROGRESS_WRITE_INTERVAL_MS = 1500
const TERMINAL_TYPES = new Set(["done", "fatal_error"])

function throttled<T extends { type: string }>(jobId: string) {
  let lastWriteAt = 0
  let pending: Promise<void> = Promise.resolve()

  return (event: T) => {
    const now = Date.now()
    const isTerminal = TERMINAL_TYPES.has(event.type)
    if (!isTerminal && now - lastWriteAt < PROGRESS_WRITE_INTERVAL_MS) return

    lastWriteAt = now
    pending = pending.then(() => updateJobProgress(jobId, event as unknown as CatalogSyncProgress | ColorTermsProgress))
  }
}

async function main() {
  const jobId = process.env.JOB_ID
  const jobKind = process.env.JOB_KIND as JobKind
  const rawPayload = process.env.JOB_PAYLOAD

  if (!jobId || !jobKind || !rawPayload) {
    console.error("JOB_ID, JOB_KIND e JOB_PAYLOAD sao obrigatorios.")
    process.exit(1)
  }

  const payload = JSON.parse(rawPayload) as
    | (CatalogSyncRequest & { credentials?: ExternalApiConfigOverrides })
    | (ColorTermsSyncRequest & { credentials?: ExternalApiConfigOverrides })

  await markJobRunning(jobId)
  const onProgress = throttled(jobId)

  try {
    const report = await withExternalApiConfigOverrides(payload.credentials, () =>
      jobKind === "catalog"
        ? runCatalogSync(payload as CatalogSyncRequest, onProgress)
        : runColorTermsSync(payload as ColorTermsSyncRequest, onProgress),
    )
    await completeJob(jobId, report)
    process.exit(0)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha inesperada durante a execucao do job."
    console.error(message)
    await failJob(jobId, message)
    process.exit(1)
  }
}

main()
