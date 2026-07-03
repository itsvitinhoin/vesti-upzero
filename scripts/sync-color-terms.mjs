#!/usr/bin/env node

import fs from "node:fs"

const DEFAULT_START_DATE = "2016-01-01"
const MAX_WINDOW_DAYS = 30
const VESTI_RATE_DELAY_MS = 250

const args = parseArgs(process.argv.slice(2))
loadEnvFile(".env")
loadEnvFile(".env.local")

const dryRun = !args.write
const startDate = args.start ?? DEFAULT_START_DATE
const endDate = args.end ?? new Date().toISOString().slice(0, 10)
const windowDays = Number(args.windowDays ?? MAX_WINDOW_DAYS)
const perPage = Number(args.perPage ?? 100)
const limit = args.limit ? Number(args.limit) : undefined
const prune = args.noPrune !== true

const stats = {
  dryRun,
  prune,
  vestiProductsFetched: 0,
  uniqueProducts: 0,
  vestiColorsFound: 0,
  vestiColorsCanonical: 0,
  vestiGenericColorsIgnored: 0,
  upzeroColorsFound: 0,
  upzeroColorsKept: 0,
  upzeroColorsWouldUpsert: 0,
  upzeroColorsUpserted: 0,
  upzeroColorsWouldDelete: 0,
  upzeroColorsDeleted: 0,
  errors: [],
}

main().catch((error) => {
  console.error(`\nFalha fatal: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})

async function main() {
  assertConfig()

  console.log(dryRun ? "Modo dry-run: nada sera gravado." : "Modo write: cores da UP Zero serao sincronizadas.")
  console.log(`Periodo Vesti: ${startDate} ate ${endDate}`)
  if (limit) console.log(`Limite: ${limit} produtos`)
  if (prune) console.log("Limpeza: cores extras da UP Zero serao removidas no modo write.")
  if (!prune) console.log("Limpeza: desativada por --no-prune.")

  if (!dryRun && prune && limit) {
    throw new Error("Remova --limit para deletar cores extras. Limpeza destrutiva exige catalogo completo da Vesti.")
  }

  const vestiProducts = await fetchVestiProducts()
  stats.uniqueProducts = vestiProducts.length

  const expectedColors = collectCanonicalColors(vestiProducts)
  stats.vestiColorsCanonical = expectedColors.size

  console.log(`Cores canonicas na Vesti: ${expectedColors.size}`)

  for (const color of expectedColors.values()) {
    await upsertColorTerm(color)
  }

  if (prune) {
    await pruneExtraColorTerms(expectedColors)
  }

  console.log(JSON.stringify({ ok: stats.errors.length === 0, stats }, null, 2))
}

function collectCanonicalColors(products) {
  const colors = new Map()

  for (const product of products) {
    const productColors = colorById(product)

    for (const stock of product.stocks ?? []) {
      if (!stock.color_id && !stock.color_name && !stock.color_code) continue

      stats.vestiColorsFound += 1
      const sourceColor = productColors.get(cleanString(stock.color_id))
      const term = mapVestiColorTerm(
        mergeColorContext(sourceColor, {
          id: stock.color_id,
          name: stock.color_name,
          code: stock.color_code,
        }),
      )

      const rgb = normalizeRgb(term.rgb ?? term.meta?.rgb)
      const isGeneric = ["cor", "color", "cores", "colors"].includes(normalizedToken(term.name))
      if (isGeneric && !rgb) {
        stats.vestiGenericColorsIgnored += 1
        continue
      }

      const key = normalizedToken(term.name)
      const existing = colors.get(key)
      if (!existing) {
        colors.set(key, term)
        continue
      }

      const existingRgb = normalizeRgb(existing.rgb ?? existing.meta?.rgb)
      if (!existingRgb && rgb) {
        colors.set(key, term)
      }
    }
  }

  return colors
}

async function upsertColorTerm(term) {
  const rgb = normalizeRgb(term.rgb ?? term.meta?.rgb)
  const payload = {
    code: term.code,
    name: term.name,
    rgb: rgb ?? undefined,
    meta: {
      ...term.meta,
      vesti_code: term.code,
      vesti_rgb: rgb,
    },
  }

  if (dryRun) {
    stats.upzeroColorsWouldUpsert += 1
    return
  }

  const result = await upzeroFetch("/external/v1/attributes/by-code/color/terms", {
    method: "POST",
    body: payload,
  })

  if (result.ok) {
    stats.upzeroColorsUpserted += 1
  } else {
    stats.errors.push({
      step: "upzero.color_terms.upsert",
      message: result.error,
      context: {
        term: payload,
        response: result.data ?? result.rawText ?? null,
      },
    })
  }
}

async function pruneExtraColorTerms(expectedColors) {
  const colorAttribute = await fetchColorAttribute()
  const attributeId = colorAttribute ? upzeroAttributeId(colorAttribute) : null
  if (!colorAttribute || !attributeId) {
    stats.errors.push({
      step: "upzero.color_attribute.find",
      message: "Atributo Cor/color nao encontrado na UP Zero.",
    })
    return
  }

  const terms = await fetchColorTerms(colorAttribute)
  stats.upzeroColorsFound = terms.length

  const expectedCodes = new Set(Array.from(expectedColors.values()).map((term) => normalizedToken(term.code)))
  const expectedNames = new Set(Array.from(expectedColors.values()).map((term) => normalizedToken(term.name)))

  for (const term of terms) {
    const termId = upzeroTermId(term)
    const termCode = normalizedToken(term.code)
    const termName = normalizedToken(term.name)
    const vestiCode = normalizedToken(term.meta?.vesti_code)
    const shouldKeep =
      expectedCodes.has(termCode) ||
      expectedCodes.has(vestiCode) ||
      expectedNames.has(termName)

    if (shouldKeep) {
      stats.upzeroColorsKept += 1
      continue
    }

    if (dryRun) {
      stats.upzeroColorsWouldDelete += 1
      continue
    }

    if (!termId) {
      stats.errors.push({
        step: "upzero.color_terms.delete_extra",
        message: "Termo de cor sem ID para remocao.",
        context: { term },
      })
      continue
    }

    const result = await upzeroFetch(`/external/v1/attributes/${encodeURIComponent(attributeId)}/terms/${encodeURIComponent(termId)}`, {
      method: "DELETE",
    })

    if (result.ok) {
      stats.upzeroColorsDeleted += 1
    } else {
      stats.errors.push({
        step: "upzero.color_terms.delete_extra",
        message: result.error,
        context: {
          termId,
          code: term.code,
          name: term.name,
          response: result.data ?? result.rawText ?? null,
        },
      })
    }
  }
}

async function fetchColorAttribute() {
  const result = await upzeroFetch("/external/v1/attributes")
  if (!result.ok) {
    stats.errors.push({
      step: "upzero.attributes.list",
      message: result.error,
      context: { response: result.data ?? result.rawText ?? null },
    })
    return null
  }

  return extractArray(result.data).find((attribute) => {
    const code = String(attribute.code || "").toLowerCase()
    const name = String(attribute.name || "").toLowerCase()
    return code === "color" || name === "cor"
  }) ?? null
}

async function fetchColorTerms(attribute) {
  const attributeId = upzeroAttributeId(attribute)
  if (attributeId) {
    const byId = await upzeroFetch(`/external/v1/attributes/${encodeURIComponent(attributeId)}/terms`)
    if (byId.ok) return extractArray(byId.data)
  }

  const byCode = await upzeroFetch("/external/v1/attributes/by-code/color/terms")
  return byCode.ok ? extractArray(byCode.data) : []
}

async function fetchVestiProducts() {
  const products = new Map()
  const start = parseDate(startDate)
  const end = parseDate(endDate)
  const boundedWindowDays = Math.min(Math.max(windowDays, 1), MAX_WINDOW_DAYS)

  for (let windowStart = start; windowStart <= end; windowStart = addDays(windowStart, boundedWindowDays)) {
    const windowEnd = addDays(windowStart, boundedWindowDays - 1) > end ? end : addDays(windowStart, boundedWindowDays - 1)

    for (let page = 1; page <= 200; page += 1) {
      const endpoint =
        `/v2/products/company/${encodeURIComponent(requiredEnv("VESTI_COMPANY_ID"))}` +
        `?start_date=${encodeQueryDate(formatDate(windowStart))}` +
        `&end_date=${encodeQueryDate(formatDate(windowEnd), true)}&perpage=${perPage}&page=${page}`

      const result = await vestiFetch(endpoint)
      if (!result.ok) {
        if (!isVestiUnexpectedApiResponse(result)) {
          stats.errors.push({
            step: "vesti.products",
            message: result.error,
            context: { status: result.status, response: result.data ?? result.rawText ?? null },
          })
        }
        break
      }

      const pageProducts = extractArray(result.data)
      stats.vestiProductsFetched += pageProducts.length

      for (const product of pageProducts) {
        const id = String(product.id || product.code || product.integration_id || "")
        if (id) products.set(id, product)
        if (limit && products.size >= limit) return Array.from(products.values())
      }

      if (!result.data?.links?.next || pageProducts.length === 0) break
      await delay(VESTI_RATE_DELAY_MS)
    }

    await delay(VESTI_RATE_DELAY_MS)
  }

  return Array.from(products.values())
}

function mapVestiColorTerm(color, sortOrder = 0) {
  const rgb = normalizeRgb(color.code ?? color.rgb ?? color.hex)
  const name = colorDisplayName(color) ?? cleanString(color.name || color.code || "Cor")

  return {
    code: termCode(name, color.integration_id || color.id),
    name,
    sort_order: sortOrder,
    rgb: rgb ?? undefined,
    meta: {
      vesti_id: nullableString(color.id),
      vesti_code: nullableString(color.integration_id || color.id),
      rgb,
    },
  }
}

function mergeColorContext(color, fallback) {
  const colorName = colorDisplayName(color ?? {})
  const fallbackName = colorDisplayName(fallback)
  const rgb = normalizeRgb(color?.code ?? color?.rgb ?? color?.hex ?? fallback.code ?? fallback.rgb ?? fallback.hex)

  return {
    ...(color ?? {}),
    ...fallback,
    id: color?.id ?? fallback.id,
    integration_id: color?.integration_id ?? fallback.integration_id,
    name: colorName ?? fallbackName ?? color?.name ?? fallback.name,
    code: rgb ?? color?.code ?? fallback.code,
    rgb: rgb ?? color?.rgb ?? fallback.rgb,
    hex: rgb ?? color?.hex ?? fallback.hex,
  }
}

function colorDisplayName(color) {
  return (
    meaningfulColorName(color.name) ??
    meaningfulColorName(color.title) ??
    meaningfulColorName(color.label) ??
    meaningfulColorName(color.color_name) ??
    meaningfulColorName(color.description) ??
    meaningfulColorName(color.code)
  )
}

function meaningfulColorName(value) {
  const text = nullableString(value)
  if (!text) return null
  const normalized = normalizedToken(text)
  if (!normalized || ["cor", "color", "cores", "colors"].includes(normalized)) return null
  return text
}

function colorById(product) {
  return new Map((product.colors ?? []).map((color) => [cleanString(color.id), color]))
}

function upzeroAttributeId(attribute) {
  return String(attribute.id || attribute.attribute_id || "") || null
}

function upzeroTermId(term) {
  return String(term.id || term.term_id || "") || null
}

function termCode(value, fallback) {
  return stableCode(value, fallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80)
}

function stableCode(value, fallback) {
  const code = nullableString(value)
  return code || cleanString(fallback)
}

function normalizeRgb(value) {
  const text = nullableString(value)
  if (!text) return null
  const withoutHash = text.replace(/^#/, "")
  if (/^[0-9A-Fa-f]{3}$/.test(withoutHash)) {
    return `#${withoutHash.split("").map((char) => `${char}${char}`).join("")}`.toUpperCase()
  }
  return /^[0-9A-Fa-f]{6}$/.test(withoutHash) ? `#${withoutHash}`.toUpperCase() : null
}

function normalizedToken(value) {
  return cleanString(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/(^-|-$)/g, "")
    .replace(/-\d{5,}$/g, "")
}

async function vestiFetch(endpoint) {
  return apiFetch(envUrl("VESTI_API_BASE_URL", endpoint), {
    headers: {
      [process.env.VESTI_API_TOKEN_HEADER_NAME || "apikey"]: requiredEnv("VESTI_API_TOKEN"),
      ...(process.env.VESTI_COMPANY_ID_HEADER_NAME
        ? { [process.env.VESTI_COMPANY_ID_HEADER_NAME]: requiredEnv("VESTI_COMPANY_ID") }
        : {}),
    },
  })
}

async function upzeroFetch(endpoint, init = {}) {
  return apiFetch(envUrl("UPZERO_API_BASE_URL", endpoint), {
    method: init.method ?? "GET",
    headers: {
      [process.env.UPZERO_API_TOKEN_HEADER_NAME || "X-API-KEY"]: requiredEnv("UPZERO_API_TOKEN"),
      "Content-Type": "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
}

async function apiFetch(url, init) {
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
    })
    const text = await response.text()
    const data = text ? safeJson(text) : null
    return {
      ok: response.ok,
      status: response.status,
      data,
      rawText: data === null ? text : undefined,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error:
        error instanceof Error
          ? [error.message, error.cause instanceof Error ? error.cause.message : ""].filter(Boolean).join(": ")
          : String(error),
    }
  }
}

function envUrl(envName, endpoint) {
  const base = requiredEnv(envName).replace(/\/+$/, "")
  return `${base}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`
}

function assertConfig() {
  for (const name of ["VESTI_API_BASE_URL", "VESTI_API_TOKEN", "VESTI_COMPANY_ID", "UPZERO_API_BASE_URL", "UPZERO_API_TOKEN"]) {
    requiredEnv(name)
  }
}

function requiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Variavel obrigatoria ausente: ${name}`)
  return value
}

function loadEnvFile(path) {
  if (!fs.existsSync(path)) return
  const lines = fs.readFileSync(path, "utf8").split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue
    const index = trimmed.indexOf("=")
    const key = trimmed.slice(0, index).trim()
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")
    if (!process.env[key]) process.env[key] = value
  }
}

function parseArgs(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index += 1) {
    const arg = values[index]
    if (arg === "--write") {
      parsed.write = true
      continue
    }
    if (arg === "--no-prune") {
      parsed.noPrune = true
      continue
    }
    if (!arg.startsWith("--")) continue
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase())
    parsed[key] = values[index + 1]
    index += 1
  }
  return parsed
}

function extractArray(data) {
  if (Array.isArray(data)) return data
  if (data && typeof data === "object") {
    for (const key of ["data", "items", "results", "products", "categories", "content"]) {
      if (Array.isArray(data[key])) return data[key]
    }
  }
  return []
}

function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function isVestiUnexpectedApiResponse(result) {
  if (result.status !== 400 || !result.data || typeof result.data !== "object") return false
  return String(result.data.result?.messages || result.data.result?.message || "").toLowerCase().includes("unexpected api response")
}

function cleanString(value) {
  return String(value ?? "").trim()
}

function nullableString(value) {
  const text = cleanString(value)
  return text ? text : null
}

function parseDate(value) {
  return new Date(`${value}T00:00:00-03:00`)
}

function formatDate(date) {
  return date.toISOString().slice(0, 10)
}

function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function encodeQueryDate(date, end = false) {
  return `${date}%20${end ? "23:59:59" : "00:00:00"}`
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
