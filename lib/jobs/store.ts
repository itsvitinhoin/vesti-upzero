import "server-only"

import { Firestore } from "@google-cloud/firestore"
import { randomUUID } from "node:crypto"
import type { CatalogSyncProgress, CatalogSyncRequest } from "@/lib/sync/catalog-sync"
import type { ColorTermsProgress, ColorTermsSyncRequest } from "@/lib/sync/color-terms-sync"

export type JobKind = "catalog" | "color-terms"
export type JobStatus = "queued" | "running" | "done" | "error"

const MAX_LIVE_PRODUCTS = 50

type StoredCatalogRequest = Omit<CatalogSyncRequest, "credentials">
type StoredColorTermsRequest = Omit<ColorTermsSyncRequest, "credentials">

export interface JobDoc {
  jobId: string
  kind: JobKind
  status: JobStatus
  createdAt: string
  updatedAt: string
  request: StoredCatalogRequest | StoredColorTermsRequest
  progress: CatalogSyncProgress | ColorTermsProgress | { type: "queued" }
  recentProducts?: unknown[]
  stats?: unknown
  report?: unknown
  errorMessage?: string
}

let firestore: Firestore | null = null

function getFirestore(): Firestore {
  if (!firestore) {
    firestore = new Firestore()
    firestore.settings({ ignoreUndefinedProperties: true })
  }
  return firestore
}

function jobsCollection() {
  return getFirestore().collection("jobs")
}

function stripCredentials<T extends { credentials?: unknown }>(payload: T): Omit<T, "credentials"> {
  const { credentials, ...rest } = payload
  return rest
}

export async function createJob(
  kind: JobKind,
  payload: CatalogSyncRequest | ColorTermsSyncRequest,
): Promise<string> {
  const jobId = randomUUID()
  const now = new Date().toISOString()

  const doc: JobDoc = {
    jobId,
    kind,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    request: stripCredentials(payload),
    progress: { type: "queued" },
  }

  await jobsCollection().doc(jobId).set(doc)
  return jobId
}

export async function markJobRunning(jobId: string): Promise<void> {
  await jobsCollection().doc(jobId).update({
    status: "running",
    updatedAt: new Date().toISOString(),
  })
}

export async function updateJobProgress(
  jobId: string,
  event: CatalogSyncProgress | ColorTermsProgress,
): Promise<void> {
  const update: Record<string, unknown> = {
    status: "running",
    progress: event,
    updatedAt: new Date().toISOString(),
  }
  if ("stats" in event && event.stats) update.stats = event.stats

  const product = "product" in event ? event.product : "term" in event ? event.term : null
  if (product) {
    const doc = await jobsCollection().doc(jobId).get()
    const existing = (doc.data() as JobDoc | undefined)?.recentProducts ?? []
    update.recentProducts = [...existing, product].slice(-MAX_LIVE_PRODUCTS)
  }

  await jobsCollection().doc(jobId).update(update)
}

export async function completeJob(jobId: string, report: unknown): Promise<void> {
  await jobsCollection().doc(jobId).update({
    status: "done",
    report,
    progress: { type: "done" },
    updatedAt: new Date().toISOString(),
  })
}

export async function failJob(jobId: string, message: string): Promise<void> {
  await jobsCollection().doc(jobId).update({
    status: "error",
    errorMessage: message,
    progress: { type: "fatal_error", message },
    updatedAt: new Date().toISOString(),
  })
}

export async function getJob(jobId: string): Promise<JobDoc | null> {
  const doc = await jobsCollection().doc(jobId).get()
  if (!doc.exists) return null
  return doc.data() as JobDoc
}
