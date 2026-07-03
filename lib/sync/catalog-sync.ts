import { DEFAULT_ENDPOINTS } from "@/lib/api-config"
import { proxyFetch, extractArray } from "@/lib/proxy"
import { getExternalApiConfig } from "@/lib/server-api-config"
import {
  collectTermsFromProducts,
  mapVestiCategoryForMigration,
  mapVestiImagesForMigration,
  mapVestiInventoryForMigration,
  mapVestiProductForMigration,
  mapVestiVideosForMigration,
  normalizeRgb,
  VESTI_INTEGRATION,
  type UpzeroCategoryPayload,
  type UpzeroProductPayload,
  type UpzeroVariantPayload,
} from "@/lib/mappers/catalog-migration"

type AnyRecord = Record<string, any>

export interface CatalogSyncRequest {
  dryRun?: boolean
  compareOnly?: boolean
  realtime?: boolean
  credentials?: import("@/lib/server-api-config").ExternalApiConfigOverrides
  productStatus?: "all" | "active" | "inactive"
  startDate?: string
  endDate?: string
  windowDays?: number
  perPage?: number
  maxProducts?: number
  includeImages?: boolean
  syncStock?: boolean
  replaceImages?: boolean
  deactivateExtraVariants?: boolean
  pruneExtraAttributeTerms?: boolean
  archiveExtraProducts?: boolean
  productCode?: string
  latestFirst?: boolean
}

export interface CatalogSyncStats {
  dryRun: boolean
  windows: number
  vestiProductPages: number
  vestiProductsFetched: number
  uniqueProducts: number
  vestiCategoriesFetched: number
  upzeroCategoriesCreated: number
  upzeroCategoriesUpdated: number
  upzeroCategoriesSkipped: number
  upzeroAttributesCreated: number
  upzeroTermsCreated: number
  upzeroTermsSkipped: number
  upzeroColorTermRgbUpdated: number
  upzeroProductsCreated: number
  upzeroProductsUpdated: number
  upzeroProductsSkipped: number
  upzeroVariantsCreated: number
  upzeroVariantsUpdated: number
  upzeroInventoryItems: number
  upzeroInventoryBatches: number
  upzeroImagesCreated: number
  upzeroImagesSkipped: number
  upzeroImagesDeleted: number
  upzeroImagesUploadedFromUrl: number
  upzeroImageDownloadErrors: number
  upzeroVideosCreated: number
  upzeroVideosSkipped: number
  upzeroVideosDeleted: number
  upzeroExtraVariantsInactivated: number
  upzeroExtraAttributeTermsDeleted: number
  upzeroExtraAttributeTermsSkipped: number
  upzeroExtraProductsArchived: number
  warnings: Array<{ step: string; message: string; context?: unknown }>
  errors: Array<{ step: string; message: string; context?: unknown }>
}

export interface ProcessedProductReport {
  code: string
  action: "dry_run" | "exists" | "missing" | "created" | "updated" | "updated_after_conflict" | "skipped" | "error"
  upzeroProductId: string | null
  vesti: {
    externalId: string
    name: string
    descriptionHtml: string
    status: string
    categoryIds: string[]
    variantCount: number
    activeVariantCount: number
    skus: string[]
    activeSkus: string[]
    activeVariantSignatures: string[]
    inventoryItems: number
    imageCount: number
  }
  upzero?: {
    id: string | null
    code: string
    name: string
    descriptionHtml: string
    status: string
    categoryIds: string[]
    productCategoryIds: string[]
    categoryNames: string[]
    productCategoryNames: string[]
    variantCount: number
    activeVariantCount: number
    skus: string[]
    activeSkus: string[]
    activeVariantSignatures: string[]
    imageCount: number
  }
  checks?: {
    nameMatches: boolean
    descriptionMatches: boolean
    statusMatches: boolean
    categoryCountMatches: boolean
    externalCategoryCountMatches: boolean
    adminCategoryCountMatches: boolean
    activeSkusMatch: boolean
    activeSkusNormalizedMatch: boolean
    activeVariantCountMatches: boolean
    activeVariantAttributesMatch: boolean
    imageCountMatches: boolean
    imageCountAtLeastVesti: boolean
    missingActiveSkus: string[]
    extraActiveSkus: string[]
    missingActiveNormalizedSkus: string[]
    extraActiveNormalizedSkus: string[]
    missingActiveVariantSignatures: string[]
    extraActiveVariantSignatures: string[]
  }
  error?: string
}

export interface ColorTermCheck {
  code: string
  name: string
  vestiRgb: string | null
  upzeroRgb: string | null
  matches: boolean
  issue?: "missing_in_upzero" | "missing_rgb_in_vesti" | "rgb_mismatch"
}

export interface CatalogSyncProgress {
  type: "catalog_started" | "source_loaded" | "products_started" | "product_started" | "product_done" | "product_error" | "done" | "fatal_error"
  processed?: number
  total?: number
  elapsedMs?: number
  estimatedRemainingMs?: number
  productCode?: string
  productName?: string
  product?: ProcessedProductReport
  stats?: CatalogSyncStats
  message?: string
}

export type CatalogSyncProgressHandler = (event: CatalogSyncProgress) => void | Promise<void>

const DEFAULT_START_DATE = "2016-01-01"
const MAX_WINDOW_DAYS = 30
const VESTI_RATE_DELAY_MS = 250
const MAX_IMAGE_UPLOAD_BYTES = 4_500_000
const IMAGE_UPLOAD_RETRY_DELAYS_MS = [1200, 3000]

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

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

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

function encodeQueryDate(date: string, end = false): string {
  return `${date}%20${end ? "23:59:59" : "00:00:00"}`
}

function productIdentity(product: AnyRecord): string {
  return String(product.id || product.code || product.integration_id || "")
}

function productDateMs(product: AnyRecord): number {
  const candidates = [
    product.updated_at,
    product.updatedAt,
    product.update_date,
    product.last_update,
    product.created_at,
    product.createdAt,
    product.created,
    product.inserted_at,
    product.registered_at,
    product.date,
  ]

  for (const candidate of candidates) {
    const date = new Date(String(candidate || ""))
    const time = date.getTime()
    if (Number.isFinite(time)) return time
  }

  return 0
}

function sortProductsByLatest(products: AnyRecord[]) {
  return [...products].sort((a, b) => productDateMs(b) - productDateMs(a))
}

function productMatchesStatus(product: AnyRecord, status: CatalogSyncRequest["productStatus"]) {
  if (!status || status === "all") return true
  const active = product.active !== false && product.status !== false
  return status === "active" ? active : !active
}

function externalCategoryId(category: AnyRecord): string {
  return String(
    category.external_ref?.external_id ||
      category.external_id ||
      category.data?.external_ref?.external_id ||
      category.data?.external_id ||
      category.category?.external_ref?.external_id ||
      category.category?.external_id ||
      "",
  )
}

function flattenCategories(categories: AnyRecord[]): AnyRecord[] {
  const out: AnyRecord[] = []
  const visit = (category: AnyRecord) => {
    out.push(category)
    for (const child of category.children ?? []) visit(child)
  }
  for (const category of categories) visit(category)
  return out
}

function upzeroProductId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null
  const obj = data as AnyRecord
  return String(obj.product_id || obj.id || obj.data?.product_id || obj.data?.id || "") || null
}

function unwrapApiObject(data: unknown): AnyRecord | null {
  if (!data || typeof data !== "object") return null
  const obj = data as AnyRecord
  if (obj.data && typeof obj.data === "object" && !Array.isArray(obj.data)) return obj.data as AnyRecord
  if (obj.category && typeof obj.category === "object" && !Array.isArray(obj.category)) return obj.category as AnyRecord
  if (obj.result && typeof obj.result === "object" && !Array.isArray(obj.result)) return obj.result as AnyRecord
  return obj
}

function upzeroCategoryId(category: AnyRecord | null | undefined): string | null {
  if (!category || typeof category !== "object") return null
  return String(
    category.id ||
      category.category_id ||
      category.data?.id ||
      category.data?.category_id ||
      category.category?.id ||
      category.category?.category_id ||
      "",
  ) || null
}

function upzeroVariantId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null
  const obj = data as AnyRecord
  return String(obj.variant_id || obj.id || obj.data?.variant_id || obj.data?.id || "") || null
}

function upzeroVariantExternalId(data: AnyRecord): string {
  return String(data.external_ref?.external_id || data.external_id || "")
}

function normalizedText(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ")
}

function sameStringSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const bSet = new Set(b)
  return a.every((item) => bSet.has(item))
}

function setDiff(a: string[], b: string[]) {
  const bSet = new Set(b)
  return a.filter((item) => !bSet.has(item))
}

function setDiffBy(a: string[], b: string[], normalize: (value: string) => string) {
  const bSet = new Set(b.map((item) => normalize(item)))
  return a.filter((item) => !bSet.has(normalize(item)))
}

function normalizedSku(value: unknown): string {
  return normalizedText(value).toLowerCase()
}

function normalizedToken(value: unknown): string {
  return normalizedText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/(^-|-$)/g, "")
    .replace(/-\d{5,}$/g, "")
}

function normalizedCategoryKey(value: unknown): string {
  return normalizedToken(value)
}

function normalizedAttributeCode(assignment: AnyRecord): string {
  const raw = assignment.attribute?.code || assignment.attribute?.name
  const code = normalizedToken(raw)
  if (code === "cor") return "color"
  if (code === "tamanho") return "size"
  return code
}

function variantSignature(variant: AnyRecord): string {
  const sku = normalizedSku(variant.sku)
  const attrs = Array.isArray(variant.attributes)
    ? variant.attributes
        .map((assignment: AnyRecord) => {
          const attributeCode = normalizedAttributeCode(assignment)
          const termCode = normalizedToken(assignment.term?.name || assignment.term?.code)
          return `${attributeCode}:${termCode}`
        })
        .sort()
        .join("|")
    : ""
  return `${sku}::${attrs}`
}

function variantColorAssignment(variant: AnyRecord): AnyRecord | null {
  if (!Array.isArray(variant.attributes)) return null
  return (
    variant.attributes.find((assignment: AnyRecord) => {
      const code = String(assignment.attribute?.code || "").toLowerCase()
      const name = String(assignment.attribute?.name || "").toLowerCase()
      return code === "color" || name === "cor"
    }) ?? null
  )
}

function vestiSummary(
  rawProduct: AnyRecord,
  product: UpzeroProductPayload,
  inventoryItems: ReturnType<typeof mapVestiInventoryForMigration>,
  images: ReturnType<typeof mapVestiImagesForMigration>,
): ProcessedProductReport["vesti"] {
  const activeVariants = product.variants.filter((variant) => variant.active !== false)

  return {
    externalId: String(rawProduct.id || product.external_ref.external_id || ""),
    name: product.name,
    descriptionHtml: product.description_html ?? "",
    status: product.status,
    categoryIds: product.category_ids,
    variantCount: product.variants.length,
    activeVariantCount: activeVariants.length,
    skus: product.variants.map((variant) => variant.sku),
    activeSkus: activeVariants.map((variant) => variant.sku),
    activeVariantSignatures: activeVariants.map((variant) => variantSignature(variant)),
    inventoryItems: inventoryItems.length,
    imageCount: images.length,
  }
}

async function fetchUpzeroImages(productId: string) {
  const result = await proxyFetch({
    ...getExternalApiConfig("upzero"),
    endpoint: `/external/v1/products/${encodeURIComponent(productId)}/images`,
    method: "GET",
  })
  return result.ok ? extractArray(result.data) : []
}

async function fetchUpzeroProduct(productId: string) {
  const result = await proxyFetch({
    ...getExternalApiConfig("upzero"),
    endpoint: `/external/v1/products/${encodeURIComponent(productId)}`,
    method: "GET",
  })
  return result.ok ? (result.data as AnyRecord) : null
}

async function loadUpzeroProductsByCode(stats: CatalogSyncStats) {
  const byCode = new Map<string, AnyRecord>()
  let cursor = ""

  for (let page = 0; page < 200; page += 1) {
    const endpoint =
      `${DEFAULT_ENDPOINTS.upzero.products}?limit=200` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "")
    const result = await safeProxy("upzero.products.list", stats, {
      ...getExternalApiConfig("upzero"),
      endpoint,
      method: "GET",
    })
    if (!result.ok) break

    const items = extractArray(result.data)
    for (const product of items) {
      const code = String(product.code || "")
      if (code) byCode.set(code, product)
    }

    const data = result.data as AnyRecord
    cursor = String(data?.next_cursor || data?.nextCursor || "")
    if (!cursor || items.length === 0) break
  }

  return byCode
}

async function archiveExtraUpzeroProducts(
  expectedCodes: Set<string>,
  upzeroProductsByCode: Map<string, AnyRecord>,
  dryRun: boolean,
  stats: CatalogSyncStats,
) {
  for (const [code, product] of upzeroProductsByCode.entries()) {
    if (expectedCodes.has(code)) continue

    const productId = upzeroProductId(product)
    if (!productId) {
      stats.errors.push({
        step: "upzero.products.archive_extra",
        message: "Produto extra sem ID para arquivar.",
        context: { code, product },
      })
      continue
    }

    if (dryRun) {
      stats.upzeroProductsSkipped += 1
      continue
    }

    const result = await safeProxy("upzero.products.archive_extra", stats, {
      ...getExternalApiConfig("upzero"),
      endpoint: `/external/v1/products/${encodeURIComponent(productId)}`,
      method: "DELETE",
    }, { code, productId })
    if (result.ok) stats.upzeroExtraProductsArchived += 1
  }
}

function upzeroSummary(product: AnyRecord | null, images: AnyRecord[]): ProcessedProductReport["upzero"] | undefined {
  if (!product) return undefined
  const variants = Array.isArray(product.variants) ? product.variants : []
  const activeVariants = variants.filter((variant: AnyRecord) => variant.active !== false)

  return {
    id: upzeroProductId(product),
    code: String(product.code || ""),
    name: String(product.name || ""),
    descriptionHtml: String(product.description_html || ""),
    status: String(product.status || ""),
    categoryIds: Array.isArray(product.category_ids) ? product.category_ids.map(String) : [],
    productCategoryIds: Array.isArray(product.product_category_ids) ? product.product_category_ids.map(String) : [],
    categoryNames: Array.isArray(product.category_names) ? product.category_names.map(String) : [],
    productCategoryNames: Array.isArray(product.product_category_names) ? product.product_category_names.map(String) : [],
    variantCount: variants.length,
    activeVariantCount: activeVariants.length,
    skus: variants.map((variant: AnyRecord) => String(variant.sku || "")),
    activeSkus: activeVariants.map((variant: AnyRecord) => String(variant.sku || "")),
    activeVariantSignatures: activeVariants.map((variant: AnyRecord) => variantSignature(variant)),
    imageCount: images.length,
  }
}

function buildChecks(
  vesti: ProcessedProductReport["vesti"],
  upzero: ProcessedProductReport["upzero"] | undefined,
): ProcessedProductReport["checks"] | undefined {
  if (!upzero) return undefined
  const missingActiveSkus = setDiff(vesti.activeSkus, upzero.activeSkus)
  const extraActiveSkus = setDiff(upzero.activeSkus, vesti.activeSkus)
  const missingActiveNormalizedSkus = setDiffBy(vesti.activeSkus, upzero.activeSkus, normalizedSku)
  const extraActiveNormalizedSkus = setDiffBy(upzero.activeSkus, vesti.activeSkus, normalizedSku)
  const missingActiveVariantSignatures = setDiff(vesti.activeVariantSignatures, upzero.activeVariantSignatures)
  const extraActiveVariantSignatures = setDiff(upzero.activeVariantSignatures, vesti.activeVariantSignatures)

  return {
    nameMatches: vesti.name === upzero.name,
    descriptionMatches: normalizedText(vesti.descriptionHtml) === normalizedText(upzero.descriptionHtml),
    statusMatches: vesti.status === upzero.status,
    externalCategoryCountMatches: vesti.categoryIds.length === upzero.categoryIds.length,
    adminCategoryCountMatches: vesti.categoryIds.length === upzero.productCategoryIds.length,
    categoryCountMatches: vesti.categoryIds.length === upzero.productCategoryIds.length,
    activeSkusMatch: missingActiveSkus.length === 0 && extraActiveSkus.length === 0,
    activeSkusNormalizedMatch: missingActiveNormalizedSkus.length === 0 && extraActiveNormalizedSkus.length === 0,
    activeVariantCountMatches: vesti.activeVariantCount === upzero.activeVariantCount,
    activeVariantAttributesMatch: missingActiveVariantSignatures.length === 0 && extraActiveVariantSignatures.length === 0,
    imageCountMatches: vesti.imageCount === upzero.imageCount,
    imageCountAtLeastVesti: upzero.imageCount >= vesti.imageCount,
    missingActiveSkus,
    extraActiveSkus,
    missingActiveNormalizedSkus,
    extraActiveNormalizedSkus,
    missingActiveVariantSignatures,
    extraActiveVariantSignatures,
  }
}

function isProbablyVideoUrl(url: string) {
  return /\.(mp4|mov|m4v|webm)(?:[?#].*)?$/i.test(url)
}

async function downloadImageAsDataUrl(url: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "image/*",
      },
    })

    if (!response.ok) {
      throw new Error(`Falha ao baixar imagem: HTTP ${response.status}`)
    }

    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg"
    if (!contentType.startsWith("image/")) {
      throw new Error(`Resposta não é imagem: ${contentType}`)
    }

    const bytes = Buffer.from(await response.arrayBuffer())
    return {
      dataUrl: `data:${contentType};base64,${bytes.toString("base64")}`,
      bytes: bytes.length,
      contentType,
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function safeProxyWithRetry(
  step: string,
  stats: CatalogSyncStats,
  request: Parameters<typeof proxyFetch>[0],
  context?: Record<string, unknown>,
) {
  let lastResult: Awaited<ReturnType<typeof proxyFetch>> | null = null

  for (let attempt = 0; attempt <= IMAGE_UPLOAD_RETRY_DELAYS_MS.length; attempt += 1) {
    const result = await proxyFetch(request)
    lastResult = result
    const retryable = result.status === 0 || result.status === 500 || result.status === 503
    if (result.ok || !retryable || attempt === IMAGE_UPLOAD_RETRY_DELAYS_MS.length) break
    await delay(IMAGE_UPLOAD_RETRY_DELAYS_MS[attempt])
  }

  const result = lastResult as Awaited<ReturnType<typeof proxyFetch>>
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

async function proxyFetchWithRetry(request: Parameters<typeof proxyFetch>[0]) {
  let lastResult: Awaited<ReturnType<typeof proxyFetch>> | null = null

  for (let attempt = 0; attempt <= IMAGE_UPLOAD_RETRY_DELAYS_MS.length; attempt += 1) {
    const result = await proxyFetch(request)
    lastResult = result
    const retryable = result.status === 0 || result.status === 500 || result.status === 503
    if (result.ok || !retryable || attempt === IMAGE_UPLOAD_RETRY_DELAYS_MS.length) break
    await delay(IMAGE_UPLOAD_RETRY_DELAYS_MS[attempt])
  }

  return lastResult as Awaited<ReturnType<typeof proxyFetch>>
}

async function safeProxy(
  step: string,
  stats: CatalogSyncStats,
  request: Parameters<typeof proxyFetch>[0],
  context?: Record<string, unknown>,
) {
  const result = await proxyFetch(request)
  if (!result.ok) {
    addProxyError(stats, step, result, context)
  }
  return result
}

function addProxyError(
  stats: CatalogSyncStats,
  step: string,
  result: Awaited<ReturnType<typeof proxyFetch>>,
  context?: Record<string, unknown>,
) {
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

function shouldRetryWithoutEcommerceCategories(result: Awaited<ReturnType<typeof proxyFetch>>) {
  if (![400, 422].includes(result.status)) return false
  const text = JSON.stringify(result.data ?? result.rawText ?? "").toLowerCase()
  return text.includes("product_category") || text.includes("categoria")
}

function productForApi(product: UpzeroProductPayload, includeInternalCategories = true) {
  const {
    category_names,
    product_category_names,
    ...documentedProduct
  } = product
  if (includeInternalCategories) return documentedProduct

  const {
    product_category_ids,
    ...externalOnlyProduct
  } = documentedProduct
  return externalOnlyProduct
}

async function sendUpzeroProductRequest(
  step: string,
  stats: CatalogSyncStats,
  endpoint: string,
  method: "POST" | "PATCH",
  product: UpzeroProductPayload,
  context?: Record<string, unknown>,
) {
  let result = await proxyFetch({
    ...getExternalApiConfig("upzero"),
    endpoint,
    method,
    body: productForApi(product, true),
  })

  if (!result.ok && shouldRetryWithoutEcommerceCategories(result)) {
    stats.warnings.push({
      step,
      message: "A UP Zero recusou product_category_ids; reenviando somente com category_ids externos.",
      context: {
        ...context,
        status: result.status,
        response: result.data ?? result.rawText ?? null,
      },
    })
    result = await proxyFetch({
      ...getExternalApiConfig("upzero"),
      endpoint,
      method,
      body: productForApi(product, false),
    })
  }

  if (!result.ok && result.status !== 409) addProxyError(stats, step, result, context)
  return result
}

async function fetchVestiCategories(stats: CatalogSyncStats): Promise<AnyRecord[]> {
  const result = await safeProxy("vesti.categories", stats, {
    ...getExternalApiConfig("vesti"),
    endpoint: DEFAULT_ENDPOINTS.vesti.categories,
    method: "GET",
  })

  if (!result.ok) return []

  const categories = extractArray(result.data)
  stats.vestiCategoriesFetched = categories.length
  return categories
}

function isVestiUnexpectedApiResponse(result: Awaited<ReturnType<typeof proxyFetch>>) {
  if (result.status !== 400 || !result.data || typeof result.data !== "object") return false
  const data = result.data as AnyRecord
  return String(data.result?.messages || data.result?.message || "").toLowerCase().includes("unexpected api response")
}

async function fetchVestiProducts(
  req: Required<Pick<CatalogSyncRequest, "startDate" | "endDate" | "windowDays" | "perPage">> &
    Pick<CatalogSyncRequest, "maxProducts" | "latestFirst">,
  stats: CatalogSyncStats,
) {
  const products = new Map<string, AnyRecord>()
  const start = parseDate(req.startDate)
  const end = parseDate(req.endDate)
  const windowDays = Math.min(Math.max(req.windowDays, 1), MAX_WINDOW_DAYS)
  const windows: Array<{ start: Date; end: Date }> = []

  for (let windowStart = start; windowStart <= end; windowStart = addDays(windowStart, windowDays)) {
    const windowEnd = addDays(windowStart, windowDays - 1) > end ? end : addDays(windowStart, windowDays - 1)
    windows.push({ start: windowStart, end: windowEnd })
  }

  const orderedWindows = req.latestFirst ? windows.reverse() : windows

  for (const window of orderedWindows) {
    const windowStart = window.start
    const windowEnd = window.end
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
          return req.latestFirst ? sortProductsByLatest(Array.from(products.values())).slice(0, req.maxProducts) : Array.from(products.values())
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

async function loadUpzeroCategories(stats: CatalogSyncStats) {
  const result = await safeProxy("upzero.categories.list", stats, {
    ...getExternalApiConfig("upzero"),
    endpoint: DEFAULT_ENDPOINTS.upzero.categories,
    method: "GET",
  })

  if (!result.ok) return new Map<string, AnyRecord>()

  const byExternalId = new Map<string, AnyRecord>()
  for (const category of flattenCategories(extractArray(result.data))) {
    const id = externalCategoryId(category)
    const integration = String(category.external_ref?.integration || category.data?.external_ref?.integration || "")
    if ((!integration || integration === VESTI_INTEGRATION) && id) {
      const normalizedCategory = unwrapApiObject(category) ?? category
      byExternalId.set(id, normalizedCategory)
    }
  }
  return byExternalId
}

async function loadUpzeroCategoryIndex(
  stats: CatalogSyncStats,
  endpoint = DEFAULT_ENDPOINTS.upzero.categories,
  stepPrefix = "upzero.categories",
) {
  const result = await safeProxy(`${stepPrefix}.list`, stats, {
    ...getExternalApiConfig("upzero"),
    endpoint,
    method: "GET",
  })

  const byExternalId = new Map<string, AnyRecord>()
  const byVisibleName = new Map<string, AnyRecord>()
  const all: AnyRecord[] = []
  if (!result.ok) return { byExternalId, byVisibleName, all }

  for (const category of flattenCategories(extractArray(result.data))) {
    const normalizedCategory = unwrapApiObject(category) ?? category
    all.push(normalizedCategory)

    const id = externalCategoryId(normalizedCategory)
    const integration = String(normalizedCategory.external_ref?.integration || normalizedCategory.data?.external_ref?.integration || "")
    if ((!integration || integration === VESTI_INTEGRATION) && id) {
      byExternalId.set(id, normalizedCategory)
    }

    if (!normalizedCategory.external_ref && normalizedCategory.name) {
      byVisibleName.set(normalizedCategoryKey(normalizedCategory.name), normalizedCategory)
    }
  }

  return { byExternalId, byVisibleName, all }
}

async function syncCategories(
  categories: UpzeroCategoryPayload[],
  dryRun: boolean,
  stats: CatalogSyncStats,
  endpoint = DEFAULT_ENDPOINTS.upzero.categories,
  stepPrefix = "upzero.categories",
) {
  const existing = dryRun
    ? { byExternalId: new Map<string, AnyRecord>(), byVisibleName: new Map<string, AnyRecord>(), all: [] as AnyRecord[] }
    : await loadUpzeroCategoryIndex(stats, endpoint, stepPrefix)
  const localExisting = new Map(existing.byExternalId)
  const localVisibleByName = new Map(existing.byVisibleName)

  for (const category of categories.sort((a, b) => Number(Boolean(a.parent_external_id)) - Number(Boolean(b.parent_external_id)))) {
    const externalId = category.external_ref.external_id
    if (!externalId || !category.name) {
      stats.upzeroCategoriesSkipped += 1
      continue
    }

    const categoryNameKey = normalizedCategoryKey(category.name)
    const found = localExisting.get(externalId) ?? localVisibleByName.get(categoryNameKey)
    const parent = category.parent_external_id ? localExisting.get(category.parent_external_id) : null
    const parentId = upzeroCategoryId(parent)
    const payload = {
      name: category.name,
      status: category.status,
      parent_id: parentId ? Number(parentId) : null,
      external_ref: category.external_ref,
    }

    if (dryRun) {
      stats.upzeroCategoriesSkipped += 1
      continue
    }

    const foundId = upzeroCategoryId(found)
    if (foundId) {
      const result = await safeProxy(`${stepPrefix}.update`, stats, {
        ...getExternalApiConfig("upzero"),
        endpoint: `${endpoint}/${foundId}`,
        method: "PUT",
        body: payload,
      })
      if (result.ok) {
        stats.upzeroCategoriesUpdated += 1
        const updatedCategory = unwrapApiObject(result.data) ?? found
        localExisting.set(externalId, {
          ...updatedCategory,
          id: upzeroCategoryId(updatedCategory) ?? foundId,
        })
        localVisibleByName.set(categoryNameKey, localExisting.get(externalId) as AnyRecord)
      }
    } else {
      const result = await safeProxy(`${stepPrefix}.create`, stats, {
        ...getExternalApiConfig("upzero"),
        endpoint,
        method: "POST",
        body: payload,
      })
      if (result.ok) {
        stats.upzeroCategoriesCreated += 1
        const createdCategory = unwrapApiObject(result.data)
        localExisting.set(externalId, {
          ...(createdCategory ?? {}),
          id: upzeroCategoryId(createdCategory) ?? undefined,
        })
        localVisibleByName.set(categoryNameKey, localExisting.get(externalId) as AnyRecord)
      }
    }
  }

  const verifiedExisting = dryRun ? null : await loadUpzeroCategoryIndex(stats, endpoint, stepPrefix)
  const source = new Map(localExisting)
  if (verifiedExisting) {
    for (const category of categories) {
      const visible = verifiedExisting.byVisibleName.get(normalizedCategoryKey(category.name))
      if (visible) source.set(category.external_ref.external_id, visible)
    }
  }
  const idsByExternalId = new Map<string, string>()
  for (const [externalId, category] of source) {
    const categoryId = upzeroCategoryId(category)
    if (categoryId) idsByExternalId.set(externalId, categoryId)
  }
  return idsByExternalId
}

async function syncAttributesAndTerms(products: AnyRecord[], dryRun: boolean, stats: CatalogSyncStats) {
  const terms = collectTermsFromProducts(products)
  if (dryRun) {
    stats.upzeroTermsSkipped = terms.colors.length + terms.sizes.length
    return
  }

  for (const attribute of [
    { code: "color", name: "Cor", sort_order: 0 },
    { code: "size", name: "Tamanho", sort_order: 1 },
  ]) {
    const result = await safeProxy("upzero.attributes.create", stats, {
      ...getExternalApiConfig("upzero"),
      endpoint: "/external/v1/attributes",
      method: "POST",
      body: {
        external_ref: {
          integration: VESTI_INTEGRATION,
          external_id: `ATTR-${attribute.code}`,
        },
        ...attribute,
      },
    })

    if (result.ok) stats.upzeroAttributesCreated += 1
  }

  for (const [attributeCode, attributeTerms] of [
    ["color", terms.colors],
    ["size", terms.sizes],
  ] as const) {
    const attributes = await fetchUpzeroAttributes(stats)
    const attribute = attributes.find((item: AnyRecord) =>
      isAttribute(item, attributeCode, attributeCode === "color" ? "cor" : "tamanho"),
    )
    const attributeId = attribute ? upzeroAttributeId(attribute) : null

    for (const term of attributeTerms) {
      const endpoint = attributeId
        ? `/external/v1/attributes/${encodeURIComponent(attributeId)}/terms`
        : `/external/v1/attributes/by-code/${encodeURIComponent(attributeCode)}/terms`
      const result = await safeProxy("upzero.attributes.terms.create", stats, {
        ...getExternalApiConfig("upzero"),
        endpoint,
        method: "POST",
        body: term,
      })
      if (result.ok) stats.upzeroTermsCreated += 1
    }
  }
}

async function fetchUpzeroAttributes(stats: CatalogSyncStats) {
  const result = await safeProxy("upzero.attributes.list", stats, {
    ...getExternalApiConfig("upzero"),
    endpoint: "/external/v1/attributes",
    method: "GET",
  })
  return result.ok ? extractArray(result.data) : []
}

function upzeroAttributeId(attribute: AnyRecord): string | null {
  return String(attribute.id || attribute.attribute_id || "") || null
}

function upzeroTermId(term: AnyRecord): string | null {
  return String(term.id || term.term_id || "") || null
}

function isAttribute(attribute: AnyRecord, code: string, fallbackName: string) {
  const attributeCode = String(attribute.code || "").toLowerCase()
  const attributeName = String(attribute.name || "").toLowerCase()
  return attributeCode === code || attributeName === fallbackName.toLowerCase()
}

async function fetchUpzeroAttributeTerms(attribute: AnyRecord, attributeCode: "color" | "size", stats: CatalogSyncStats) {
  const attributeId = upzeroAttributeId(attribute)
  if (attributeId) {
    const result = await safeProxy(`upzero.attributes.${attributeCode}.terms.list`, stats, {
      ...getExternalApiConfig("upzero"),
      endpoint: `/external/v1/attributes/${encodeURIComponent(attributeId)}/terms`,
      method: "GET",
    })
    if (result.ok) return extractArray(result.data)
  }

  const result = await safeProxy(`upzero.attributes.${attributeCode}.terms.list_by_code`, stats, {
    ...getExternalApiConfig("upzero"),
    endpoint: `/external/v1/attributes/by-code/${encodeURIComponent(attributeCode)}/terms`,
    method: "GET",
  })
  return result.ok ? extractArray(result.data) : []
}

async function pruneExtraAttributeTerms(products: AnyRecord[], dryRun: boolean, stats: CatalogSyncStats) {
  const expected = collectTermsFromProducts(products)
  const attributes = await fetchUpzeroAttributes(stats)

  for (const [attributeCode, fallbackName, expectedTerms] of [
    ["color", "cor", expected.colors],
    ["size", "tamanho", expected.sizes],
  ] as const) {
    const attribute = attributes.find((item: AnyRecord) => isAttribute(item, attributeCode, fallbackName))
    const attributeId = attribute ? upzeroAttributeId(attribute) : null
    if (!attribute || !attributeId) continue

    const expectedCodes = new Set(expectedTerms.map((term) => normalizedToken(term.code)))
    const expectedNames = new Set(expectedTerms.map((term) => normalizedToken(term.name)))
    const terms = await fetchUpzeroAttributeTerms(attribute, attributeCode, stats)

    for (const term of terms) {
      const termId = upzeroTermId(term)
      const termCode = normalizedToken(term.code)
      const termName = normalizedToken(term.name)
      const shouldKeep = expectedCodes.has(termCode) || expectedNames.has(termName)

      if (shouldKeep) {
        stats.upzeroExtraAttributeTermsSkipped += 1
        continue
      }

      if (dryRun) {
        stats.upzeroExtraAttributeTermsSkipped += 1
        continue
      }

      if (!termId) {
        stats.errors.push({
          step: "upzero.attributes.terms.delete_extra",
          message: "Termo sem ID para remoção.",
          context: { attributeCode, term },
        })
        continue
      }

      const result = await proxyFetch({
        ...getExternalApiConfig("upzero"),
        endpoint: `/external/v1/attributes/${encodeURIComponent(attributeId)}/terms/${encodeURIComponent(termId)}`,
        method: "DELETE",
      })
      if (result.ok) {
        stats.upzeroExtraAttributeTermsDeleted += 1
      } else if (result.status === 409) {
        stats.upzeroExtraAttributeTermsSkipped += 1
        stats.warnings.push({
          step: "upzero.attributes.terms.delete_extra",
          message: "Termo extra mantido porque a UP Zero recusou a remocao, provavelmente por estar em uso.",
          context: { attributeCode, attributeId, termId, termCode: term.code, termName: term.name },
        })
      } else {
        stats.errors.push({
          step: "upzero.attributes.terms.delete_extra",
          message: result.error || `Falha HTTP ${result.status}`,
          context: {
            attributeCode,
            attributeId,
            termId,
            termCode: term.code,
            termName: term.name,
            status: result.status,
            url: result.url,
            response: result.data ?? result.rawText ?? null,
          },
        })
      }
    }
  }
}

async function fetchUpzeroColorTerms(stats: CatalogSyncStats) {
  const attributes = await fetchUpzeroAttributes(stats)
  const colorAttribute = attributes.find((attribute: AnyRecord) => {
    const code = String(attribute.code || "").toLowerCase()
    const name = String(attribute.name || "").toLowerCase()
    return code === "color" || name === "cor"
  })

  if (Array.isArray(colorAttribute?.terms)) return colorAttribute.terms

  const attributeId = colorAttribute ? upzeroAttributeId(colorAttribute) : null
  if (!attributeId) return []

  const result = await safeProxy("upzero.attributes.color_terms.list", stats, {
    ...getExternalApiConfig("upzero"),
    endpoint: `/external/v1/attributes/${encodeURIComponent(attributeId)}/terms`,
    method: "GET",
  }, { attributeId })
  return result.ok ? extractArray(result.data) : []
}

function findUpzeroColorTerm(expected: AnyRecord, upzeroTerms: AnyRecord[]) {
  return findUpzeroColorTerms(expected, upzeroTerms)[0] ?? null
}

function findUpzeroColorTerms(expected: AnyRecord, upzeroTerms: AnyRecord[]) {
  const expectedCode = String(expected.code || "")
  const expectedName = String(expected.name || "")
  const expectedNormalizedCode = normalizedToken(expectedCode)
  const expectedNormalizedName = normalizedToken(expectedName)
  const expectedRgb = normalizeRgb(expected.rgb ?? expected.meta?.rgb)
  const matches = upzeroTerms.filter((term: AnyRecord) => (
    String(term.meta?.vesti_code || "") === expectedCode ||
    String(term.code || "") === expectedCode ||
    normalizedToken(term.code) === expectedNormalizedCode ||
    normalizedToken(term.name) === expectedNormalizedName
  ))
  const sorted = expectedRgb
    ? [...matches].sort((a, b) => {
        const aMatchesRgb = normalizeRgb(a.rgb ?? a.meta?.rgb) === expectedRgb ? 0 : 1
        const bMatchesRgb = normalizeRgb(b.rgb ?? b.meta?.rgb) === expectedRgb ? 0 : 1
        return aMatchesRgb - bMatchesRgb
      })
    : matches
  const seen = new Set<string>()

  return sorted.filter((term: AnyRecord) => {
    const key = upzeroTermId(term) || `${term.code}-${term.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function buildColorTermChecks(products: AnyRecord[], dryRun: boolean, stats: CatalogSyncStats) {
  const expectedTerms = collectTermsFromProducts(products).colors
  const upzeroTerms = await fetchUpzeroColorTerms(stats)
  const terms: ColorTermCheck[] = expectedTerms.map((term) => {
    const found = findUpzeroColorTerm(term, upzeroTerms)
    const vestiRgb = normalizeRgb(term.rgb ?? term.meta?.rgb)
    const upzeroRgb = normalizeRgb(found?.rgb ?? found?.meta?.rgb)

    if (!vestiRgb) {
      return { code: term.code, name: term.name, vestiRgb, upzeroRgb, matches: upzeroRgb === null, issue: "missing_rgb_in_vesti" }
    }
    if (!found) {
      return { code: term.code, name: term.name, vestiRgb, upzeroRgb: null, matches: false, issue: "missing_in_upzero" }
    }
    if (vestiRgb !== upzeroRgb) {
      return { code: term.code, name: term.name, vestiRgb, upzeroRgb, matches: false, issue: "rgb_mismatch" }
    }
    return { code: term.code, name: term.name, vestiRgb, upzeroRgb, matches: true }
  })

  return {
    checked: terms.length,
    matches: terms.filter((term) => term.matches).length,
    mismatches: terms.filter((term) => !term.matches && term.issue !== "missing_rgb_in_vesti").length,
    missingRgbInVesti: terms.filter((term) => term.issue === "missing_rgb_in_vesti").length,
    terms,
  }
}

async function findUpzeroProductByCode(code: string, stats: CatalogSyncStats) {
  const result = await proxyFetch({
    ...getExternalApiConfig("upzero"),
    endpoint: `/external/v1/products/by-code/${encodeURIComponent(code)}`,
    method: "GET",
  })

  if (result.ok) return result.data as AnyRecord

  if (result.status === 404) {
    const listResult = await proxyFetch({
      ...getExternalApiConfig("upzero"),
      endpoint: `${DEFAULT_ENDPOINTS.upzero.products}?code=${encodeURIComponent(code)}&limit=10`,
      method: "GET",
    })
    if (listResult.ok) {
      return extractArray(listResult.data).find((product: AnyRecord) => String(product.code || "") === code) ?? null
    }
    if (listResult.status !== 404) {
      stats.errors.push({
        step: "upzero.products.find",
        message: listResult.error || `Falha HTTP ${listResult.status}`,
        context: { status: listResult.status, code, response: listResult.data ?? listResult.rawText ?? null },
      })
    }
    return null
  }

  if (result.status !== 404) {
    stats.errors.push({
      step: "upzero.products.find",
      message: result.error || `Falha HTTP ${result.status}`,
      context: { status: result.status, code, response: result.data ?? result.rawText ?? null },
    })
  }
  return null
}

async function loadUpzeroVariants(productId: string, stats: CatalogSyncStats) {
  const result = await safeProxy("upzero.variants.list", stats, {
    ...getExternalApiConfig("upzero"),
    endpoint: `/external/v1/variants?product_id=${encodeURIComponent(productId)}&limit=200`,
    method: "GET",
  }, { productId })

  const bySku = new Map<string, AnyRecord>()
  const byExternalId = new Map<string, AnyRecord>()
  const all: AnyRecord[] = []
  if (!result.ok) return { bySku, byExternalId, all }

  for (const variant of extractArray(result.data)) {
    all.push(variant)
    const sku = String(variant.sku || "")
    const externalId = upzeroVariantExternalId(variant)
    if (sku) bySku.set(sku, variant)
    if (externalId) byExternalId.set(externalId, variant)
  }

  return { bySku, byExternalId, all }
}

async function productForUpdate(product: UpzeroProductPayload, productId: string, stats: CatalogSyncStats): Promise<UpzeroProductPayload> {
  const existingVariants = await loadUpzeroVariants(productId, stats)
  const variants: UpzeroVariantPayload[] = product.variants.map((variant) => {
    const found =
      existingVariants.byExternalId.get(variant.external_ref.external_id) ??
      existingVariants.bySku.get(variant.sku)
    const id = found ? upzeroVariantId(found) : null
    return id ? { ...variant, id } : variant
  })

  return { ...product, variants }
}

async function findUpzeroProductByVariant(product: UpzeroProductPayload) {
  for (const variant of product.variants) {
    const variantResult = await proxyFetch({
      ...getExternalApiConfig("upzero"),
      endpoint:
        `/external/v1/variants?integration=${encodeURIComponent(VESTI_INTEGRATION)}` +
        `&external_id=${encodeURIComponent(variant.external_ref.external_id)}&limit=10`,
      method: "GET",
    })

    let foundVariant = variantResult.ok ? extractArray(variantResult.data)[0] : null
    if (!foundVariant && variant.sku) {
      const skuResult = await proxyFetch({
        ...getExternalApiConfig("upzero"),
        endpoint: `/external/v1/variants?sku=${encodeURIComponent(variant.sku)}&limit=10`,
        method: "GET",
      })
      foundVariant = skuResult.ok ? extractArray(skuResult.data)[0] : null
    }

    const productId = foundVariant?.product_id ? String(foundVariant.product_id) : ""
    if (!productId) continue

    const productResult = await proxyFetch({
      ...getExternalApiConfig("upzero"),
      endpoint: `/external/v1/products/${encodeURIComponent(productId)}`,
      method: "GET",
    })

    if (productResult.ok) return productResult.data as AnyRecord
  }

  return null
}

async function deactivateExtraVariants(
  productId: string,
  product: UpzeroProductPayload,
  stats: CatalogSyncStats,
) {
  const expectedSkus = new Set(product.variants.map((variant) => variant.sku).filter(Boolean))
  const expectedExternalIds = new Set(product.variants.map((variant) => variant.external_ref.external_id).filter(Boolean))
  const existing = await loadUpzeroVariants(productId, stats)

  for (const variant of existing.all) {
    const variantId = upzeroVariantId(variant)
    const sku = String(variant.sku || "")
    const externalId = upzeroVariantExternalId(variant)
    const belongsToVestiSet =
      (sku && expectedSkus.has(sku)) ||
      (externalId && expectedExternalIds.has(externalId))

    if (!variantId || belongsToVestiSet) continue

    const result = await safeProxy("upzero.variants.deactivate_extra", stats, {
      ...getExternalApiConfig("upzero"),
      endpoint: `/external/v1/variants/${encodeURIComponent(variantId)}`,
      method: "DELETE",
    }, { productId, variantId, sku, externalId })
    if (result.ok) stats.upzeroExtraVariantsInactivated += 1
  }
}

async function syncVariants(productId: string, product: UpzeroProductPayload, stats: CatalogSyncStats) {
  const existing = await loadUpzeroVariants(productId, stats)

  for (const variant of product.variants) {
    const found =
      existing.byExternalId.get(variant.external_ref.external_id) ??
      existing.bySku.get(variant.sku)
    const variantId = found ? upzeroVariantId(found) : null

    if (variantId) {
      const result = await safeProxy("upzero.variants.update", stats, {
        ...getExternalApiConfig("upzero"),
        endpoint: `/external/v1/variants/${encodeURIComponent(variantId)}`,
        method: "PATCH",
        body: variant,
      }, { productId, variantId, sku: variant.sku })
      if (result.ok) stats.upzeroVariantsUpdated += 1
      continue
    }

    const result = await safeProxy("upzero.variants.create_missing", stats, {
      ...getExternalApiConfig("upzero"),
      endpoint: "/external/v1/variants",
      method: "POST",
      body: {
        product_id: productId,
        ...variant,
      },
    }, { productId, sku: variant.sku, externalId: variant.external_ref.external_id })
    if (result.ok) stats.upzeroVariantsCreated += 1
  }
}

async function syncVariantColorTermRgb(
  rawProduct: AnyRecord,
  product: UpzeroProductPayload,
  upzeroProduct: AnyRecord | null,
  stats: CatalogSyncStats,
) {
  if (!upzeroProduct || !Array.isArray(upzeroProduct.variants)) return

  const sourceBySku = new Map(product.variants.map((variant) => [variant.sku, variant]))
  const sourceColorTerms = new Map(
    collectTermsFromProducts([rawProduct]).colors.map((term) => [term.code, term]),
  )
  const attributes = await fetchUpzeroAttributes(stats)
  const colorAttribute = attributes.find((attribute: AnyRecord) => isAttribute(attribute, "color", "cor"))
  const colorAttributeId = colorAttribute ? upzeroAttributeId(colorAttribute) : null
  if (!colorAttributeId) return
  const upzeroColorTerms = await fetchUpzeroColorTerms(stats)

  for (const upzeroVariant of upzeroProduct.variants) {
    if (upzeroVariant.active === false) continue

    const sku = String(upzeroVariant.sku || "")
    const sourceVariant = sourceBySku.get(sku)
    if (!sourceVariant) continue

    const sourceColor = variantColorAssignment(sourceVariant)
    const upzeroColor = variantColorAssignment(upzeroVariant)
    const sourceColorCode = String(sourceColor?.term?.code || "")
    const upzeroColorCode = String(upzeroColor?.term?.code || "")
    if (!sourceColorCode || !upzeroColorCode) continue

    const sourceTerm = sourceColorTerms.get(sourceColorCode)
    const rgb = normalizeRgb(sourceTerm?.rgb ?? sourceTerm?.meta?.rgb)
    if (!rgb) continue
    const matchingTerms = sourceTerm ? findUpzeroColorTerms(sourceTerm, upzeroColorTerms) : []
    const targetCodes = matchingTerms.length
      ? Array.from(new Set(matchingTerms.map((term: AnyRecord) => String(term.code || "")).filter(Boolean)))
      : [upzeroColorCode]

    for (const targetCode of targetCodes) {
      const result = await safeProxy("upzero.attributes.color_terms.rgb_upsert", stats, {
        ...getExternalApiConfig("upzero"),
        endpoint: `/external/v1/attributes/${encodeURIComponent(colorAttributeId)}/terms`,
        method: "POST",
        body: {
          code: targetCode,
          name: String(upzeroColor?.term?.name || sourceColor?.term?.name || sourceTerm?.name || targetCode),
          rgb,
          meta: {
            vesti_code: sourceColorCode,
            vesti_rgb: rgb,
          },
        },
      }, { sku, sourceColorCode, upzeroColorCode, targetCode })
      if (result.ok) stats.upzeroColorTermRgbUpdated += 1
    }
  }
}

async function syncInventory(items: ReturnType<typeof mapVestiInventoryForMigration>, dryRun: boolean, stats: CatalogSyncStats) {
  if (dryRun) {
    stats.upzeroInventoryItems += items.length
    return
  }

  for (const batch of chunk(items, 100)) {
    const result = await safeProxy("upzero.inventory.batch", stats, {
      ...getExternalApiConfig("upzero"),
      endpoint: "/external/v1/inventory/adjust/batch",
      method: "POST",
      body: { items: batch },
    })
    if (result.ok) {
      stats.upzeroInventoryBatches += 1
      stats.upzeroInventoryItems += batch.length
    }
  }
}

async function syncImages(
  productId: string,
  images: ReturnType<typeof mapVestiImagesForMigration>,
  dryRun: boolean,
  stats: CatalogSyncStats,
  replaceImages = false,
) {
  if (dryRun) {
    stats.upzeroImagesSkipped += images.length
    return
  }

  const existingResult = await proxyFetch({
    ...getExternalApiConfig("upzero"),
    endpoint: `/external/v1/products/${encodeURIComponent(productId)}/images`,
    method: "GET",
  })
  const existingImages = existingResult.ok ? extractArray(existingResult.data) : []
  const existingUrls = new Set(
    existingImages
      .flatMap((image: AnyRecord) => [
        image.image_url,
        image.url,
        image.src,
        image.source,
        image.source_url,
        image.original_url,
        image.external_url,
        image.data?.image_url,
        image.data?.url,
      ])
      .map((url) => String(url || "").trim())
      .filter(Boolean),
  )

  if (replaceImages) {
    for (const image of existingImages) {
      const imageId = String(image.id || image.image_id || "")
      if (!imageId) continue
      const result = await safeProxy("upzero.products.images.delete_existing", stats, {
        ...getExternalApiConfig("upzero"),
        endpoint: `/external/v1/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(imageId)}`,
        method: "DELETE",
      }, { productId, imageId })
      if (result.ok) stats.upzeroImagesDeleted += 1
    }
    existingUrls.clear()
  }

  const imageCandidateUrls = (image: (typeof images)[number]) =>
    Array.from(
      new Set(
        [image.url, ...(image.fallback_urls || [])]
          .map((url) => String(url || "").trim())
          .filter(Boolean),
      ),
    )

  const imagesToCreate = replaceImages
    ? images
    : images.filter((image) => !imageCandidateUrls(image).some((url) => existingUrls.has(url)))
  if (!replaceImages) stats.upzeroImagesSkipped += images.length - imagesToCreate.length

  for (const image of imagesToCreate) {
    const candidateUrls = imageCandidateUrls(image)

    if (candidateUrls.some((url) => existingUrls.has(url))) {
      stats.upzeroImagesSkipped += 1
      continue
    }

    const downloadableUrls = candidateUrls.filter((url) => !isProbablyVideoUrl(url))
    if (downloadableUrls.length === 0) {
      stats.upzeroImagesSkipped += 1
      stats.warnings.push({
        step: "vesti.images.skip_media",
        message: "Midia ignorada porque nao e imagem suportada para upload.",
        context: { productId, urls: candidateUrls },
      })
      continue
    }

    let uploaded = false
    let uploadedFromUrl = ""
    let lastDownloadError: unknown = null
    let lastUploadResult: Awaited<ReturnType<typeof proxyFetch>> | null = null
    const oversizedUrls: Array<{ url: string; bytes: number }> = []

    for (const url of downloadableUrls) {
      let downloadedImage: Awaited<ReturnType<typeof downloadImageAsDataUrl>>
      try {
        downloadedImage = await downloadImageAsDataUrl(url)
      } catch (err) {
        lastDownloadError = err
        continue
      }

      if (downloadedImage.bytes > MAX_IMAGE_UPLOAD_BYTES) {
        oversizedUrls.push({ url, bytes: downloadedImage.bytes })
        continue
      }

      const result = await proxyFetchWithRetry({
        ...getExternalApiConfig("upzero"),
        endpoint: `/external/v1/products/${encodeURIComponent(productId)}/images`,
        method: "POST",
        body: {
          base64: downloadedImage.dataUrl,
          attributes: image.attributes,
          display_order: image.display_order,
          is_primary: image.is_primary,
        },
      })
      lastUploadResult = result

      if (result.ok) {
        uploaded = true
        uploadedFromUrl = url
        stats.upzeroImagesCreated += 1
        stats.upzeroImagesUploadedFromUrl += 1
        existingUrls.add(uploadedFromUrl)
        for (const candidateUrl of candidateUrls) existingUrls.add(candidateUrl)
        break
      }

      if (result.status === 413) continue
      break
    }

    if (uploaded) continue

    stats.upzeroImagesSkipped += 1

    if (lastUploadResult) {
      addProxyError(stats, "upzero.products.images.create", lastUploadResult, {
        productId,
        url: lastUploadResult.status === 413 ? "fallbacks_esgotados" : uploadedFromUrl || image.url,
        originalUrl: image.url,
        attemptedUrls: downloadableUrls,
        oversizedUrls,
      })
      continue
    }

    if (oversizedUrls.length) {
      stats.warnings.push({
        step: "upzero.products.images.skip_large",
        message: "Imagem ignorada porque todas as versões excedem o tamanho seguro para upload via API.",
        context: {
          productId,
          originalUrl: image.url,
          attemptedUrls: downloadableUrls,
          oversizedUrls,
          maxBytes: MAX_IMAGE_UPLOAD_BYTES,
        },
      })
      continue
    }

    stats.upzeroImageDownloadErrors += 1
    const message = lastDownloadError instanceof Error ? lastDownloadError.message : "Falha ao baixar imagem da Vesti."
    const isUnsupportedMedia = message.includes("Resposta não é imagem")
    stats[isUnsupportedMedia ? "warnings" : "errors"].push({
      step: "vesti.images.download",
      message,
      context: {
        productId,
        urls: downloadableUrls,
      },
    })
  }
}

async function syncVideos(
  productId: string,
  videos: ReturnType<typeof mapVestiVideosForMigration>,
  dryRun: boolean,
  stats: CatalogSyncStats,
  replaceVideos = false,
) {
  if (dryRun) {
    stats.upzeroVideosSkipped += videos.length
    return
  }

  const existingResult = await proxyFetch({
    ...getExternalApiConfig("upzero"),
    endpoint: `/external/v1/products/${encodeURIComponent(productId)}/videos`,
    method: "GET",
  })
  const existingVideos = existingResult.ok ? extractArray(existingResult.data) : []
  const existingUrls = new Set(
    existingVideos
      .map((video: AnyRecord) => String(video.url || "").trim())
      .filter(Boolean),
  )

  if (replaceVideos) {
    for (const video of existingVideos) {
      const videoId = String(video.id || video.video_id || "")
      if (!videoId) continue
      const result = await safeProxy("upzero.products.videos.delete_existing", stats, {
        ...getExternalApiConfig("upzero"),
        endpoint: `/external/v1/products/${encodeURIComponent(productId)}/videos/${encodeURIComponent(videoId)}`,
        method: "DELETE",
      }, { productId, videoId })
      if (result.ok) stats.upzeroVideosDeleted += 1
    }
    existingUrls.clear()
  }

  const videosToCreate = replaceVideos
    ? videos
    : videos.filter((video) => !existingUrls.has(video.url))
  if (!replaceVideos) stats.upzeroVideosSkipped += videos.length - videosToCreate.length

  for (const video of videosToCreate) {
    const result = await safeProxyWithRetry("upzero.products.videos.create", stats, {
      ...getExternalApiConfig("upzero"),
      endpoint: `/external/v1/products/${encodeURIComponent(productId)}/videos`,
      method: "POST",
      body: {
        url: video.url,
        name: video.name,
        attributes: video.attributes,
      },
    }, { productId, url: video.url })
    if (result.ok) {
      stats.upzeroVideosCreated += 1
      existingUrls.add(video.url)
    }
  }
}

async function syncProducts(
  products: AnyRecord[],
  options: Pick<CatalogSyncRequest, "dryRun" | "compareOnly" | "includeImages" | "syncStock" | "replaceImages" | "deactivateExtraVariants">,
  stats: CatalogSyncStats,
  categoryIdsByExternalId: Map<string, string>,
  internalCategoryIdsByExternalId: Map<string, string>,
  categoryNamesByExternalId: Map<string, string>,
  upzeroProductsByCode?: Map<string, AnyRecord>,
  onProgress?: CatalogSyncProgressHandler,
) {
  const processedProducts: ProcessedProductReport[] = []
  const startedAt = Date.now()
  const total = products.length

  const progressTiming = (processed: number) => {
    const elapsedMs = Date.now() - startedAt
    const averageMs = processed > 0 ? elapsedMs / processed : 0
    return {
      elapsedMs,
      estimatedRemainingMs: averageMs > 0 ? Math.max(0, Math.round((total - processed) * averageMs)) : undefined,
    }
  }

  const emit = async (event: CatalogSyncProgress) => {
    if (onProgress) await onProgress(event)
  }

  const pushReport = async (report: ProcessedProductReport) => {
    processedProducts.push(report)
    const processed = processedProducts.length
    await emit({
      type: report.action === "error" ? "product_error" : "product_done",
      processed,
      total,
      ...progressTiming(processed),
      productCode: report.code,
      productName: report.vesti.name,
      product: report,
      stats,
    })
  }

  for (const rawProduct of products) {
    const sourceProduct = mapVestiProductForMigration(rawProduct)
    const inventoryItems = mapVestiInventoryForMigration(rawProduct)
    const images = mapVestiImagesForMigration(rawProduct)
    const videos = mapVestiVideosForMigration(rawProduct)
    const product = {
      ...sourceProduct,
      category_ids: [...sourceProduct.category_ids],
    }
    const baseReport = {
      code: product.code,
      upzeroProductId: null,
      vesti: vestiSummary(rawProduct, sourceProduct, inventoryItems, images),
    }

    await emit({
      type: "product_started",
      processed: processedProducts.length,
      total,
      ...progressTiming(processedProducts.length),
      productCode: product.code,
      productName: product.name,
      stats,
    })

    if (!options.dryRun) {
      const sourceCategoryIds = [...product.category_ids]
      const mappedCategoryIds = sourceCategoryIds
        .map((categoryId) => categoryIdsByExternalId.get(categoryId))
        .filter(Boolean) as string[]
      const mappedInternalCategoryIds = sourceCategoryIds
        .map((categoryId) => internalCategoryIdsByExternalId.get(categoryId))
        .filter(Boolean) as string[]
      const mappedCategoryNames = sourceCategoryIds
        .map((categoryId) => categoryNamesByExternalId.get(categoryId))
        .filter(Boolean) as string[]
      product.category_ids = mappedCategoryIds
      product.category_names = mappedCategoryNames
      product.product_category_ids = mappedInternalCategoryIds
      product.product_category_names = mappedCategoryNames

      const missingCategoryIds = sourceCategoryIds.filter((categoryId) => !categoryIdsByExternalId.get(categoryId))
      if (missingCategoryIds.length) {
        stats.warnings.push({
          step: "upzero.categories.map",
          message: "Produto tem categorias da Vesti sem ID confirmado na UP Zero.",
          context: { code: product.code, missingCategoryIds },
        })
      }
      const missingInternalCategoryIds = sourceCategoryIds.filter((categoryId) => !internalCategoryIdsByExternalId.get(categoryId))
      if (missingInternalCategoryIds.length) {
        stats.warnings.push({
          step: "upzero.internal_categories.map",
          message: "Produto tem categorias da Vesti sem ID interno/comercial confirmado na UP Zero.",
          context: { code: product.code, missingCategoryIds: missingInternalCategoryIds },
        })
      }
    }

    if (!product.code || !product.name) {
      stats.upzeroProductsSkipped += 1
      await pushReport({
        ...baseReport,
        action: "skipped",
        error: "Produto sem código ou nome.",
      })
      continue
    }

    if (options.compareOnly) {
      stats.upzeroProductsSkipped += 1
      if (options.syncStock !== false) stats.upzeroInventoryItems += inventoryItems.length
      if (options.includeImages) stats.upzeroImagesSkipped += images.length

      const indexedProduct = upzeroProductsByCode?.get(product.code) ?? null
      const indexedProductId = indexedProduct ? upzeroProductId(indexedProduct) : null
      const fullUpzeroProduct = indexedProductId ? await fetchUpzeroProduct(indexedProductId) : indexedProduct
      const fullUpzeroImages = indexedProductId ? await fetchUpzeroImages(indexedProductId) : []
      const finalUpzeroSummary = upzeroSummary(fullUpzeroProduct, fullUpzeroImages)

      await pushReport({
        ...baseReport,
        action: finalUpzeroSummary ? "exists" : "missing",
        upzeroProductId: indexedProductId,
        upzero: finalUpzeroSummary,
        checks: buildChecks(baseReport.vesti, finalUpzeroSummary),
      })
      continue
    }

    if (options.dryRun) {
      stats.upzeroProductsSkipped += 1
      if (options.syncStock !== false) stats.upzeroInventoryItems += inventoryItems.length
      if (options.includeImages) stats.upzeroImagesSkipped += images.length
      await pushReport({
        ...baseReport,
        action: "dry_run",
      })
      continue
    }

    const existing = await findUpzeroProductByCode(product.code, stats)
    let result
    let productId: string | null = null
    let action: ProcessedProductReport["action"] = "error"

    if (existing) {
      productId = upzeroProductId(existing)
      const updatePayload = productId ? await productForUpdate(product, productId, stats) : product
      result = await sendUpzeroProductRequest(
        "upzero.products.update",
        stats,
        `/external/v1/products/${encodeURIComponent(productId || "")}`,
        "PATCH",
        updatePayload,
        { code: product.code, productId },
      )
      if (result.ok) {
        action = "updated"
        stats.upzeroProductsUpdated += 1
      }
    } else {
      result = await sendUpzeroProductRequest(
        "upzero.products.create",
        stats,
        DEFAULT_ENDPOINTS.upzero.products,
        "POST",
        product,
        { code: product.code },
      )
      if (result.ok) {
        action = "created"
        stats.upzeroProductsCreated += 1
        productId = upzeroProductId(result.data)
      } else if (result.status === 409) {
        const conflictExisting = await findUpzeroProductByVariant(product)
        productId = conflictExisting ? upzeroProductId(conflictExisting) : null
        if (productId) {
          const updatePayload = await productForUpdate(product, productId, stats)
          result = await sendUpzeroProductRequest(
            "upzero.products.update_after_conflict",
            stats,
            `/external/v1/products/${encodeURIComponent(productId)}`,
            "PATCH",
            updatePayload,
            { code: product.code, productId },
          )
          if (result.ok) {
            action = "updated_after_conflict"
            stats.upzeroProductsUpdated += 1
          }
        } else {
          addProxyError(stats, "upzero.products.create", result, { code: product.code })
        }
      }
    }

    if (!result?.ok) {
      await pushReport({
        ...baseReport,
        action: "error",
        upzeroProductId: productId,
        error: result?.error || `Falha HTTP ${result?.status ?? 0}`,
      })
      continue
    }

    if (productId) {
      await syncVariants(productId, product, stats)
      await syncVariantColorTermRgb(rawProduct, product, await fetchUpzeroProduct(productId), stats)
    }

    if (options.syncStock !== false) {
      await syncInventory(inventoryItems, false, stats)
    }

    if (options.deactivateExtraVariants && productId) {
      await deactivateExtraVariants(productId, product, stats)
    }

    if (options.includeImages && productId) {
      await syncImages(productId, images, false, stats, options.replaceImages === true)
      await syncVideos(productId, videos, false, stats, options.replaceImages === true)
    }

    const finalUpzeroProduct = productId ? await fetchUpzeroProduct(productId) : null
    const finalUpzeroImages = productId ? await fetchUpzeroImages(productId) : []
    const finalUpzeroSummary = upzeroSummary(finalUpzeroProduct, finalUpzeroImages)
    await pushReport({
      ...baseReport,
      action,
      upzeroProductId: productId,
      upzero: finalUpzeroSummary,
      checks: buildChecks(baseReport.vesti, finalUpzeroSummary),
    })
  }

  return processedProducts
}

export async function runCatalogSync(body: CatalogSyncRequest, onProgress?: CatalogSyncProgressHandler) {
  const dryRun = body.compareOnly ? true : body.dryRun !== false

  const stats: CatalogSyncStats = {
    dryRun,
    windows: 0,
    vestiProductPages: 0,
    vestiProductsFetched: 0,
    uniqueProducts: 0,
    vestiCategoriesFetched: 0,
    upzeroCategoriesCreated: 0,
    upzeroCategoriesUpdated: 0,
    upzeroCategoriesSkipped: 0,
    upzeroAttributesCreated: 0,
    upzeroTermsCreated: 0,
    upzeroTermsSkipped: 0,
    upzeroColorTermRgbUpdated: 0,
    upzeroProductsCreated: 0,
    upzeroProductsUpdated: 0,
    upzeroProductsSkipped: 0,
    upzeroVariantsCreated: 0,
    upzeroVariantsUpdated: 0,
    upzeroInventoryItems: 0,
    upzeroInventoryBatches: 0,
    upzeroImagesCreated: 0,
    upzeroImagesSkipped: 0,
    upzeroImagesDeleted: 0,
    upzeroImagesUploadedFromUrl: 0,
    upzeroImageDownloadErrors: 0,
    upzeroVideosCreated: 0,
    upzeroVideosSkipped: 0,
    upzeroVideosDeleted: 0,
    upzeroExtraVariantsInactivated: 0,
    upzeroExtraAttributeTermsDeleted: 0,
    upzeroExtraAttributeTermsSkipped: 0,
    upzeroExtraProductsArchived: 0,
    warnings: [],
    errors: [],
  }

  const syncRequest = {
    startDate: body.startDate || DEFAULT_START_DATE,
    endDate: body.endDate || todayIsoDate(),
    windowDays: body.windowDays || MAX_WINDOW_DAYS,
    perPage: body.perPage || 100,
    maxProducts: body.maxProducts,
    latestFirst: body.latestFirst === true,
  }

  await onProgress?.({
    type: "catalog_started",
    processed: 0,
    total: 0,
    elapsedMs: 0,
    stats,
  })

  const [vestiCategories, fetchedVestiProducts] = await Promise.all([
    fetchVestiCategories(stats),
    fetchVestiProducts(syncRequest, stats),
  ])
  const requestedProductCode = String(body.productCode || "").trim()
  const statusFilter = body.productStatus || "all"
  const statusFilteredProducts = fetchedVestiProducts.filter((product) => productMatchesStatus(product, statusFilter))
  const selectedVestiProducts = requestedProductCode
    ? statusFilteredProducts.filter((product) => String(product.code || product.integration_id || "") === requestedProductCode)
    : body.latestFirst
      ? sortProductsByLatest(statusFilteredProducts)
      : statusFilteredProducts
  const vestiProducts = body.latestFirst && body.maxProducts && !requestedProductCode
    ? selectedVestiProducts.slice(0, body.maxProducts)
    : selectedVestiProducts
  stats.uniqueProducts = vestiProducts.length

  await onProgress?.({
    type: "source_loaded",
    processed: 0,
    total: vestiProducts.length,
    elapsedMs: 0,
    stats,
    message: `${vestiProducts.length} produtos carregados da Vesti.`,
  })

  const mappedCategories = new Map<string, UpzeroCategoryPayload>()
  for (const category of vestiCategories) {
    const mapped = mapVestiCategoryForMigration(category)
    mappedCategories.set(mapped.external_ref.external_id, mapped)
  }

  for (const product of vestiProducts) {
    for (const category of product.categories ?? []) {
      const mapped = mapVestiCategoryForMigration(category)
      mappedCategories.set(mapped.external_ref.external_id, mapped)
    }
  }

  const categoryNamesByExternalId = new Map(
    Array.from(mappedCategories.values()).map((category) => [category.external_ref.external_id, category.name]),
  )
  await syncAttributesAndTerms(vestiProducts, dryRun, stats)
  const categoryIdsByExternalId = await syncCategories(Array.from(mappedCategories.values()), dryRun, stats)
  const internalCategoryIdsByExternalId = await syncCategories(
    Array.from(mappedCategories.values()),
    dryRun,
    stats,
    DEFAULT_ENDPOINTS.upzero.internalCategories,
    "upzero.internal_categories",
  )
  const shouldLoadUpzeroProductIndex = body.compareOnly || body.archiveExtraProducts
  const upzeroProductsByCode = shouldLoadUpzeroProductIndex ? await loadUpzeroProductsByCode(stats) : undefined
  await onProgress?.({
    type: "products_started",
    processed: 0,
    total: vestiProducts.length,
    elapsedMs: 0,
    stats,
  })
  const processedProducts = await syncProducts(vestiProducts, {
    dryRun,
    compareOnly: body.compareOnly === true,
    includeImages: body.includeImages === true,
    syncStock: body.syncStock !== false,
    replaceImages: body.replaceImages === true,
    deactivateExtraVariants: body.deactivateExtraVariants === true,
  }, stats, categoryIdsByExternalId, internalCategoryIdsByExternalId, categoryNamesByExternalId, upzeroProductsByCode, onProgress)

  const canRunGlobalDestructiveCleanup = !body.maxProducts
  if ((body.archiveExtraProducts || body.pruneExtraAttributeTerms) && !canRunGlobalDestructiveCleanup) {
    stats.warnings.push({
      step: "sync.mirror_cleanup",
      message: "Limpeza destrutiva global ignorada porque maxProducts limita o catálogo. Remova o limite para espelhar a Vesti inteira.",
      context: {
        maxProducts: body.maxProducts,
        archiveExtraProducts: body.archiveExtraProducts,
        pruneExtraAttributeTerms: body.pruneExtraAttributeTerms,
      },
    })
  }

  if (body.archiveExtraProducts && upzeroProductsByCode && canRunGlobalDestructiveCleanup) {
    const expectedProductCodes = new Set(
      vestiProducts
        .map((product) => mapVestiProductForMigration(product).code)
        .filter(Boolean),
    )
    await archiveExtraUpzeroProducts(expectedProductCodes, upzeroProductsByCode, dryRun, stats)
  }

  if (body.pruneExtraAttributeTerms && canRunGlobalDestructiveCleanup) {
    await pruneExtraAttributeTerms(vestiProducts, dryRun, stats)
  }

  const colorTermChecks = await buildColorTermChecks(vestiProducts, dryRun, stats)

  const firstProductWithImages = vestiProducts.find((product) => mapVestiImagesForMigration(product).length > 0)

  const report = {
    ok: stats.errors.length === 0,
    filters: {
      productStatus: statusFilter,
      startDate: syncRequest.startDate,
      endDate: syncRequest.endDate,
      maxProducts: body.maxProducts ?? null,
      latestFirst: body.latestFirst === true,
    },
    stats,
    colorTermChecks,
    processedProducts,
    sample: {
      product: vestiProducts[0] ? mapVestiProductForMigration(vestiProducts[0]) : null,
      inventoryItems: vestiProducts[0] ? mapVestiInventoryForMigration(vestiProducts[0]).slice(0, 3) : [],
      images: vestiProducts[0] ? mapVestiImagesForMigration(vestiProducts[0]).slice(0, 3) : [],
      productWithImages: firstProductWithImages
        ? {
            product: mapVestiProductForMigration(firstProductWithImages),
            images: mapVestiImagesForMigration(firstProductWithImages).slice(0, 5),
          }
        : null,
    },
  }

  await onProgress?.({
    type: "done",
    processed: processedProducts.length,
    total: processedProducts.length,
    elapsedMs: 0,
    estimatedRemainingMs: 0,
    stats,
  })

  return report
}
