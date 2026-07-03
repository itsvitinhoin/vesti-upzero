import { type NextRequest, NextResponse } from "next/server"
import { DEFAULT_ENDPOINTS } from "@/lib/api-config"
import { proxyFetch, extractArray } from "@/lib/proxy"
import { getExternalApiConfig, withExternalApiConfigOverrides, type ExternalApiConfigOverrides } from "@/lib/server-api-config"

type AnyRecord = Record<string, any>

interface BulkStatusRequest {
  activeCodes?: string[] | string
  dryRun?: boolean
  credentials?: ExternalApiConfigOverrides
}

interface StatusRow {
  id: string | null
  code: string
  name: string
  currentStatus: string
  targetStatus: "active" | "inactive"
  action: "unchanged" | "updated" | "would_update" | "missing_id" | "error"
  error?: string
}

function parseCodes(value: BulkStatusRequest["activeCodes"]) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/\s|,|;/)
  return Array.from(
    new Set(
      raw
        .map((code) => String(code || "").trim())
        .filter(Boolean),
    ),
  )
}

function upzeroProductId(product: AnyRecord): string | null {
  return String(product.id || product.product_id || product.data?.id || product.data?.product_id || "") || null
}

function upzeroProductCode(product: AnyRecord): string {
  return String(product.code || product.sku || product.external_id || "").trim()
}

async function loadUpzeroProducts() {
  const products: AnyRecord[] = []
  let cursor = ""

  for (let page = 0; page < 300; page += 1) {
    const endpoint =
      `${DEFAULT_ENDPOINTS.upzero.products}?limit=200` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "")
    const result = await proxyFetch({
      ...getExternalApiConfig("upzero"),
      endpoint,
      method: "GET",
    })

    if (!result.ok) {
      return { ok: false as const, result, products }
    }

    const items = extractArray(result.data)
    products.push(...items)

    const data = result.data as AnyRecord
    cursor = String(data?.next_cursor || data?.nextCursor || "")
    if (!cursor || items.length === 0) break
  }

  return { ok: true as const, products }
}

async function runBulkStatus(body: BulkStatusRequest) {
  const activeCodes = parseCodes(body.activeCodes)
  const activeCodeSet = new Set(activeCodes)
  const dryRun = body.dryRun !== false
  const loaded = await loadUpzeroProducts()

  if (!loaded.ok) {
    return {
      ok: false,
      dryRun,
      activeCodes: activeCodes.length,
      productsFound: loaded.products.length,
      rows: [],
      errors: [
        {
          step: "upzero.products.list",
          message: loaded.result.error || `Falha HTTP ${loaded.result.status}`,
          context: {
            status: loaded.result.status,
            response: loaded.result.data ?? loaded.result.rawText ?? null,
          },
        },
      ],
    }
  }

  const rows: StatusRow[] = []
  const matchedActiveCodes = new Set<string>()

  for (const product of loaded.products) {
    const id = upzeroProductId(product)
    const code = upzeroProductCode(product)
    if (!code) continue

    const targetStatus: "active" | "inactive" = activeCodeSet.has(code) ? "active" : "inactive"
    if (targetStatus === "active") matchedActiveCodes.add(code)

    const currentStatus = String(product.status || (product.active === false ? "inactive" : "active"))
    const name = String(product.name || "")

    if (currentStatus === targetStatus) {
      rows.push({
        id,
        code,
        name,
        currentStatus,
        targetStatus,
        action: "unchanged",
      })
      continue
    }

    if (!id) {
      rows.push({
        id,
        code,
        name,
        currentStatus,
        targetStatus,
        action: "missing_id",
        error: "Produto sem ID para atualizar.",
      })
      continue
    }

    if (dryRun) {
      rows.push({
        id,
        code,
        name,
        currentStatus,
        targetStatus,
        action: "would_update",
      })
      continue
    }

    const result = await proxyFetch({
      ...getExternalApiConfig("upzero"),
      endpoint: `/external/v1/products/${encodeURIComponent(id)}`,
      method: "PATCH",
      body: { status: targetStatus },
    })

    rows.push({
      id,
      code,
      name,
      currentStatus,
      targetStatus,
      action: result.ok ? "updated" : "error",
      error: result.ok ? undefined : result.error || `Falha HTTP ${result.status}`,
    })
  }

  const unmatchedActiveCodes = activeCodes.filter((code) => !matchedActiveCodes.has(code))
  const summary = {
    totalUpzeroProducts: loaded.products.length,
    activeCodes: activeCodes.length,
    matchedActiveCodes: matchedActiveCodes.size,
    unmatchedActiveCodes,
    alreadyCorrect: rows.filter((row) => row.action === "unchanged").length,
    wouldUpdate: rows.filter((row) => row.action === "would_update").length,
    updated: rows.filter((row) => row.action === "updated").length,
    missingId: rows.filter((row) => row.action === "missing_id").length,
    errors: rows.filter((row) => row.action === "error").length,
    targetActive: rows.filter((row) => row.targetStatus === "active").length,
    targetInactive: rows.filter((row) => row.targetStatus === "inactive").length,
  }

  return {
    ok: summary.errors === 0 && summary.missingId === 0,
    dryRun,
    summary,
    rows,
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as BulkStatusRequest
  const payload = await withExternalApiConfigOverrides(body.credentials, () => runBulkStatus(body))
  return NextResponse.json(payload)
}
