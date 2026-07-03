import { type NextRequest, NextResponse } from "next/server"
import { DEFAULT_ENDPOINTS } from "@/lib/api-config"
import { proxyFetch, extractArray } from "@/lib/proxy"
import { getExternalApiConfig, withExternalApiConfigOverrides, type ExternalApiConfigOverrides } from "@/lib/server-api-config"
import {
  collectTermsFromProducts,
  normalizeRgb,
  VESTI_INTEGRATION,
  type UpzeroAttributeTermPayload,
} from "@/lib/mappers/catalog-migration"

type AnyRecord = Record<string, any>

interface ColorTermsSyncRequest {
  dryRun?: boolean
  realtime?: boolean
  prune?: boolean
  credentials?: ExternalApiConfigOverrides
  startDate?: string
  endDate?: string
  windowDays?: number
  perPage?: number
  maxProducts?: number
  maxColors?: number
}

interface ColorTermsSyncStats {
  dryRun: boolean
  prune: boolean
  windows: number
  vestiProductPages: number
  vestiProductsFetched: number
  uniqueProducts: number
  vestiColorsCanonical: number
  upzeroColorsFound: number
  upzeroColorsKept: number
  upzeroColorsWouldUpsert: number
  upzeroColorsUpserted: number
  upzeroColorsWouldReplace: number
  upzeroColorsReplaced: number
  upzeroColorsWouldDelete: number
  upzeroColorsDeleted: number
  warnings: Array<{ step: string; message: string; context?: unknown }>
  errors: Array<{ step: string; message: string; context?: unknown }>
}

interface ColorTermReport {
  code: string
  name: string
  rgb: string | null
  action: "would_upsert" | "upserted" | "would_replace" | "replaced" | "kept" | "blocked_in_use" | "would_delete" | "deleted" | "error"
  upzeroTermId?: string | null
  error?: string
}

interface ColorTermsProgress {
  type: "started" | "source_loaded" | "upserting" | "upserted" | "pruning" | "deleted" | "done" | "fatal_error"
  processed?: number
  total?: number
  term?: ColorTermReport
  stats?: ColorTermsSyncStats
  message?: string
}

type ProgressHandler = (event: ColorTermsProgress) => void | Promise<void>

const DEFAULT_START_DATE = "2016-01-01"
const MAX_WINDOW_DAYS = 30
const VESTI_RATE_DELAY_MS = 250

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00-03:00`)
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function encodeQueryDate(date: string, end = false): string {
  return `${date}%20${end ? "23:59:59" : "00:00:00"}`
}

function productIdentity(product: AnyRecord): string {
  return String(product.id || product.code || product.integration_id || "")
}

function normalizedToken(value: unknown): string {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/(^-|-$)/g, "")
    .replace(/-\d{5,}$/g, "")
}

function upzeroAttributeId(attribute: AnyRecord): string | null {
  return String(attribute.id || attribute.attribute_id || "") || null
}

function upzeroTermId(term: AnyRecord): string | null {
  return String(term.id || term.term_id || "") || null
}

function isVestiUnexpectedApiResponse(result: Awaited<ReturnType<typeof proxyFetch>>) {
  if (result.status !== 400 || !result.data || typeof result.data !== "object") return false
  const data = result.data as AnyRecord
  return String(data.result?.messages || data.result?.message || "").toLowerCase().includes("unexpected api response")
}

async function safeProxy(
  step: string,
  stats: ColorTermsSyncStats,
  request: Parameters<typeof proxyFetch>[0],
  context?: Record<string, unknown>,
) {
  const result = await proxyFetch(request)
  if (!result.ok) {
    stats.errors.push({
      step,
      message: result.error || `Falha HTTP ${result.status}`,
      context: {
        ...context,
        status: result.status,
        url: result.url,
        response: result.data ?? result.rawText ?? null,
      },
    })
  }
  return result
}

async function fetchVestiProducts(
  req: Required<Pick<ColorTermsSyncRequest, "startDate" | "endDate" | "windowDays" | "perPage">> &
    Pick<ColorTermsSyncRequest, "maxProducts">,
  stats: ColorTermsSyncStats,
) {
  const products = new Map<string, AnyRecord>()
  const start = parseDate(req.startDate)
  const end = parseDate(req.endDate)
  const windowDays = Math.min(Math.max(req.windowDays, 1), MAX_WINDOW_DAYS)

  for (let windowStart = start; windowStart <= end; windowStart = addDays(windowStart, windowDays)) {
    const windowEnd = addDays(windowStart, windowDays - 1) > end ? end : addDays(windowStart, windowDays - 1)
    stats.windows += 1

    for (let page = 1; page <= 200; page += 1) {
      const endpoint =
        `${DEFAULT_ENDPOINTS.vesti.products}?start_date=${encodeQueryDate(formatDate(windowStart))}` +
        `&end_date=${encodeQueryDate(formatDate(windowEnd), true)}&perpage=${req.perPage}&page=${page}`

      const result = await proxyFetch({
        ...getExternalApiConfig("vesti"),
        endpoint,
        method: "GET",
      })

      if (!result.ok) {
        if (!isVestiUnexpectedApiResponse(result)) {
          stats.errors.push({
            step: "vesti.products",
            message: result.error || `Falha HTTP ${result.status}`,
            context: {
              status: result.status,
              url: result.url,
              response: result.data ?? result.rawText ?? null,
            },
          })
        }
        break
      }

      stats.vestiProductPages += 1
      const pageProducts = extractArray(result.data)
      stats.vestiProductsFetched += pageProducts.length

      for (const product of pageProducts) {
        const id = productIdentity(product)
        if (id) products.set(id, product)
        if (req.maxProducts && products.size >= req.maxProducts) {
          stats.uniqueProducts = products.size
          return Array.from(products.values())
        }
      }

      const data = result.data as AnyRecord
      if (!data?.links?.next || pageProducts.length === 0) break
      await delay(VESTI_RATE_DELAY_MS)
    }

    await delay(VESTI_RATE_DELAY_MS)
  }

  stats.uniqueProducts = products.size
  return Array.from(products.values())
}

async function fetchUpzeroColorAttribute(stats: ColorTermsSyncStats) {
  const result = await safeProxy("upzero.attributes.list", stats, {
    ...getExternalApiConfig("upzero"),
    endpoint: "/external/v1/attributes",
    method: "GET",
  })
  if (!result.ok) return null

  return extractArray(result.data).find((attribute: AnyRecord) => {
    const code = String(attribute.code || "").toLowerCase()
    const name = String(attribute.name || "").toLowerCase()
    return code === "color" || name === "cor"
  }) ?? null
}

async function ensureUpzeroColorAttribute(dryRun: boolean, stats: ColorTermsSyncStats) {
  const existing = await fetchUpzeroColorAttribute(stats)
  if (existing) return existing
  if (dryRun) return null

  const result = await safeProxy("upzero.attributes.color.create", stats, {
    ...getExternalApiConfig("upzero"),
    endpoint: "/external/v1/attributes",
    method: "POST",
    body: {
      external_ref: {
        integration: VESTI_INTEGRATION,
        external_id: "ATTR-color",
      },
      code: "color",
      name: "Cor",
      sort_order: 0,
    },
  })
  if (result.ok && result.data && typeof result.data === "object") return result.data as AnyRecord

  return fetchUpzeroColorAttribute(stats)
}

async function fetchUpzeroColorTerms(attribute: AnyRecord | null, stats: ColorTermsSyncStats) {
  const attributeId = attribute ? upzeroAttributeId(attribute) : null
  if (attributeId) {
    const result = await safeProxy("upzero.attributes.color_terms.list", stats, {
      ...getExternalApiConfig("upzero"),
      endpoint: `/external/v1/attributes/${encodeURIComponent(attributeId)}/terms`,
      method: "GET",
    })
    if (result.ok) return extractArray(result.data)
  }

  const result = await proxyFetch({
    ...getExternalApiConfig("upzero"),
    endpoint: "/external/v1/attributes/by-code/color/terms",
    method: "GET",
  })
  if (result.ok) return extractArray(result.data)

  if (result.status === 404) {
    stats.warnings.push({
      step: "upzero.attributes.color_terms.list_by_code",
      message: "A UP Zero nao possui listagem de termos por codigo. A pre-visualizacao seguira sem esse fallback.",
      context: {
        status: result.status,
        url: result.url,
      },
    })
    return []
  }

  stats.errors.push({
    step: "upzero.attributes.color_terms.list_by_code",
    message: result.error || `Falha HTTP ${result.status}`,
    context: {
      status: result.status,
      url: result.url,
      response: result.data ?? result.rawText ?? null,
    },
  })
  return []
}

function findExistingColorTerm(term: UpzeroAttributeTermPayload, existingTerms: AnyRecord[]) {
  return findMatchingColorTerms(term, existingTerms)[0] ?? null
}

function findMatchingColorTerms(term: UpzeroAttributeTermPayload, existingTerms: AnyRecord[]) {
  const expectedCode = String(term.code || "")
  const expectedName = String(term.name || "")
  const normalizedCode = normalizedToken(expectedCode)
  const normalizedName = normalizedToken(expectedName)
  const matches = existingTerms.filter((existing) => {
    const vestiCode = String(existing.meta?.vesti_code || "")
    return (
      vestiCode === expectedCode ||
      String(existing.code || "") === expectedCode ||
      normalizedToken(existing.code) === normalizedCode ||
      normalizedToken(existing.name) === normalizedName
    )
  })
  const seen = new Set<string>()

  return matches.filter((existing) => {
    const key = upzeroTermId(existing) || `${existing.code}-${existing.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function upsertColorTerm(
  term: UpzeroAttributeTermPayload,
  dryRun: boolean,
  stats: ColorTermsSyncStats,
  existingTerms: AnyRecord[] = [],
  attributeId?: string | null,
): Promise<ColorTermReport> {
  const rgb = normalizeRgb(term.rgb ?? term.meta?.rgb)
  const matchingTerms = findMatchingColorTerms(term, existingTerms)
  const existing = matchingTerms[0] ?? null
  const existingTermId = existing ? upzeroTermId(existing) : null
  const shouldReplace = Boolean(
    rgb && matchingTerms.some((matchingTerm) => {
      const existingRgb = normalizeRgb(matchingTerm?.rgb ?? matchingTerm?.meta?.rgb)
      return existingRgb && existingRgb !== rgb
    }),
  )
  const report: ColorTermReport = {
    code: term.code,
    name: term.name,
    rgb,
    action: dryRun ? (shouldReplace ? "would_replace" : "would_upsert") : (shouldReplace ? "replaced" : "upserted"),
    upzeroTermId: existingTermId,
  }

  if (dryRun) {
    if (shouldReplace) stats.upzeroColorsWouldReplace += 1
    else stats.upzeroColorsWouldUpsert += 1
    return report
  }

  const endpoint = attributeId
    ? `/external/v1/attributes/${encodeURIComponent(attributeId)}/terms`
    : "/external/v1/attributes/by-code/color/terms"
  const targetTerms = matchingTerms.length ? matchingTerms : [null]
  const results = []

  for (const targetTerm of targetTerms) {
    const body = {
      code: String(targetTerm?.code || term.code),
      name: term.name,
      rgb: rgb ?? undefined,
      meta: {
        ...(targetTerm?.meta ?? {}),
        ...term.meta,
        vesti_code: term.code,
        vesti_rgb: rgb,
      },
    }
    const result = await safeProxy("upzero.attributes.color_terms.upsert", stats, {
      ...getExternalApiConfig("upzero"),
      endpoint,
      method: "POST",
      body,
    }, { code: term.code, name: term.name, targetCode: body.code })
    results.push(result)
  }

  if (results.every((result) => result.ok)) {
    if (shouldReplace) stats.upzeroColorsReplaced += 1
    else stats.upzeroColorsUpserted += 1
    return report
  }

  const failedResult = results.find((result) => !result.ok)

  return {
    ...report,
    action: "error",
    error: failedResult?.error || `Falha HTTP ${failedResult?.status ?? 0}`,
  }
}

async function pruneExtraColorTerms(
  expectedTerms: UpzeroAttributeTermPayload[],
  dryRun: boolean,
  stats: ColorTermsSyncStats,
  onProgress?: ProgressHandler,
) {
  const attribute = await fetchUpzeroColorAttribute(stats)
  const attributeId = attribute ? upzeroAttributeId(attribute) : null
  if (!attribute || !attributeId) {
    stats.errors.push({
      step: "upzero.attributes.color.find",
      message: "Atributo Cor/color nao encontrado na UP Zero.",
    })
    return [] as ColorTermReport[]
  }

  const existingTerms = await fetchUpzeroColorTerms(attribute, stats)
  stats.upzeroColorsFound = existingTerms.length

  const expectedCodes = new Set(expectedTerms.map((term) => normalizedToken(term.code)))
  const expectedNames = new Set(expectedTerms.map((term) => normalizedToken(term.name)))
  const deletedReports: ColorTermReport[] = []

  let processed = 0
  const total = existingTerms.length
  await onProgress?.({ type: "pruning", processed, total, stats })

  for (const term of existingTerms) {
    processed += 1
    const termCode = normalizedToken(term.code)
    const termName = normalizedToken(term.name)
    const vestiCode = normalizedToken(term.meta?.vesti_code)
    const shouldKeep = expectedCodes.has(termCode) || expectedCodes.has(vestiCode) || expectedNames.has(termName)
    const reportBase = {
      code: String(term.code || ""),
      name: String(term.name || ""),
      rgb: normalizeRgb(term.rgb ?? term.meta?.rgb),
      upzeroTermId: upzeroTermId(term),
    }

    if (shouldKeep) {
      stats.upzeroColorsKept += 1
      continue
    }

    if (dryRun) {
      stats.upzeroColorsWouldDelete += 1
      const report = { ...reportBase, action: "would_delete" as const }
      deletedReports.push(report)
      await onProgress?.({ type: "deleted", processed, total, term: report, stats })
      continue
    }

    const termId = upzeroTermId(term)
    if (!termId) {
      const report = { ...reportBase, action: "error" as const, error: "Termo sem ID para remocao." }
      deletedReports.push(report)
      stats.errors.push({ step: "upzero.attributes.color_terms.delete", message: report.error, context: { term } })
      await onProgress?.({ type: "deleted", processed, total, term: report, stats })
      continue
    }

    const result = await proxyFetch({
      ...getExternalApiConfig("upzero"),
      endpoint: `/external/v1/attributes/${encodeURIComponent(attributeId)}/terms/${encodeURIComponent(termId)}`,
      method: "DELETE",
    })

    if (!result.ok && result.status === 409) {
      stats.upzeroColorsKept += 1
      const report: ColorTermReport = {
        ...reportBase,
        action: "blocked_in_use",
        error: "Cor ainda está em uso na UP Zero. Sincronize as variantes/produtos e rode a limpeza novamente.",
      }
      deletedReports.push(report)
      await onProgress?.({ type: "deleted", processed, total, term: report, stats })
      continue
    }

    const report: ColorTermReport = result.ok
      ? { ...reportBase, action: "deleted" }
      : { ...reportBase, action: "error", error: result.error || `Falha HTTP ${result.status}` }
    if (result.ok) stats.upzeroColorsDeleted += 1
    deletedReports.push(report)
    await onProgress?.({ type: "deleted", processed, total, term: report, stats })
  }

  return deletedReports
}

async function runColorTermsSync(body: ColorTermsSyncRequest, onProgress?: ProgressHandler) {
  const dryRun = body.dryRun !== false
  const prune = body.prune !== false
  const stats: ColorTermsSyncStats = {
    dryRun,
    prune,
    windows: 0,
    vestiProductPages: 0,
    vestiProductsFetched: 0,
    uniqueProducts: 0,
    vestiColorsCanonical: 0,
    upzeroColorsFound: 0,
    upzeroColorsKept: 0,
    upzeroColorsWouldUpsert: 0,
    upzeroColorsUpserted: 0,
    upzeroColorsWouldReplace: 0,
    upzeroColorsReplaced: 0,
    upzeroColorsWouldDelete: 0,
    upzeroColorsDeleted: 0,
    warnings: [],
    errors: [],
  }

  await onProgress?.({ type: "started", processed: 0, total: 0, stats })

  const syncRequest = {
    startDate: body.startDate || DEFAULT_START_DATE,
    endDate: body.endDate || new Date().toISOString().slice(0, 10),
    windowDays: body.windowDays || MAX_WINDOW_DAYS,
    perPage: body.perPage || 100,
    maxProducts: body.maxProducts,
  }

  const products = await fetchVestiProducts(syncRequest, stats)
  await onProgress?.({
    type: "source_loaded",
    processed: 0,
    total: products.length,
    stats,
    message: `${products.length} produtos carregados da Vesti.`,
  })

  const collectedColorTerms = collectTermsFromProducts(products).colors
  const colorTerms = body.maxColors && body.maxColors > 0
    ? collectedColorTerms.slice(0, body.maxColors)
    : collectedColorTerms
  stats.vestiColorsCanonical = colorTerms.length
  const reports: ColorTermReport[] = []
  const colorAttribute = await ensureUpzeroColorAttribute(dryRun, stats)
  const colorAttributeId = colorAttribute ? upzeroAttributeId(colorAttribute) : null
  const existingColorTerms = await fetchUpzeroColorTerms(colorAttribute, stats)
  stats.upzeroColorsFound = existingColorTerms.length

  let processed = 0
  await onProgress?.({ type: "upserting", processed, total: colorTerms.length, stats })
  for (const term of colorTerms) {
    const report = await upsertColorTerm(term, dryRun, stats, existingColorTerms, colorAttributeId)
    processed += 1
    reports.push(report)
    await onProgress?.({ type: "upserted", processed, total: colorTerms.length, term: report, stats })
  }

  if (prune && !body.maxProducts) {
    reports.push(...(await pruneExtraColorTerms(colorTerms, dryRun, stats, onProgress)))
  } else if (prune && body.maxProducts) {
    stats.warnings.push({
      step: "upzero.attributes.color_terms.prune",
      message: "Remocao de cores extras ignorada porque maxProducts limita o catalogo. Remova o limite para limpar cores extras.",
      context: { maxProducts: body.maxProducts },
    })
  }

  const payload = {
    ok: stats.errors.length === 0,
    stats,
    colorTerms: reports,
  }

  await onProgress?.({ type: "done", processed: reports.length, total: reports.length, stats })
  return payload
}

function streamColorTermsSync(body: ColorTermsSyncRequest) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      const send = (event: ColorTermsProgress | { type: "done"; report: unknown }) => {
        if (closed) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`))
      }, 15000)

      try {
        const report = await withExternalApiConfigOverrides(body.credentials, () =>
          runColorTermsSync(body, (event) => send(event)),
        )
        send({ type: "done", report })
      } catch (err) {
        send({
          type: "fatal_error",
          message: err instanceof Error ? err.message : "Falha inesperada ao sincronizar cores.",
        })
      } finally {
        closed = true
        clearInterval(heartbeat)
        controller.close()
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as ColorTermsSyncRequest
  if (body.realtime) return streamColorTermsSync(body)

  const payload = await withExternalApiConfigOverrides(body.credentials, () => runColorTermsSync(body))
  return NextResponse.json(payload)
}
