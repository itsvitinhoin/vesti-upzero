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
const productCodeFilter = args.productCode ? String(args.productCode) : ""

const stats = {
  dryRun,
  vestiProductsFetched: 0,
  uniqueProducts: 0,
  upzeroProductsFound: 0,
  upzeroProductsMissing: 0,
  variantsChecked: 0,
  variantsMissing: 0,
  variantsAlreadyCanonical: 0,
  variantsWouldUpdate: 0,
  variantsUpdated: 0,
  colorTermsWouldUpsert: 0,
  colorTermsUpserted: 0,
  errors: [],
}

main().catch((error) => {
  console.error(`\nFalha fatal: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})

async function main() {
  assertConfig()

  console.log(dryRun ? "Modo dry-run: nada sera gravado." : "Modo write: variantes de cor serao atualizadas.")
  console.log(`Periodo Vesti: ${startDate} ate ${endDate}`)
  if (limit) console.log(`Limite: ${limit} produtos`)
  if (productCodeFilter) console.log(`Produto filtrado: ${productCodeFilter}`)

  const vestiProducts = await fetchVestiProducts()
  const filteredProducts = productCodeFilter
    ? vestiProducts.filter((product) => mapVestiProductForColorFix(product).code === productCodeFilter)
    : vestiProducts

  stats.uniqueProducts = filteredProducts.length

  for (const [index, rawProduct] of filteredProducts.entries()) {
    const product = mapVestiProductForColorFix(rawProduct)
    if (!product.code) continue

    process.stdout.write(`\r${index + 1}/${filteredProducts.length} ${product.code}...`)
    const upzeroProduct = await findUpzeroProductByCode(product.code)
    if (!upzeroProduct) {
      stats.upzeroProductsMissing += 1
      continue
    }

    stats.upzeroProductsFound += 1
    await fixProductColorVariants(product, upzeroProduct)
  }

  process.stdout.write("\n")
  console.log(JSON.stringify({ ok: stats.errors.length === 0, stats }, null, 2))
}

async function fixProductColorVariants(sourceProduct, upzeroProduct) {
  const variants = Array.isArray(upzeroProduct.variants) ? upzeroProduct.variants : []
  const bySku = new Map(variants.map((variant) => [String(variant.sku || ""), variant]))
  const byExternalId = new Map(
    variants.map((variant) => [String(variant.external_ref?.external_id || variant.external_id || ""), variant]),
  )

  for (const sourceVariant of sourceProduct.variants) {
    const targetVariant =
      byExternalId.get(sourceVariant.external_ref.external_id) ??
      bySku.get(sourceVariant.sku)

    stats.variantsChecked += 1
    if (!targetVariant) {
      stats.variantsMissing += 1
      continue
    }

    const variantId = String(targetVariant.id || targetVariant.variant_id || "")
    const sourceColor = colorAssignment(sourceVariant)
    const targetColor = colorAssignment(targetVariant)
    if (!variantId || !sourceColor) continue

    await upsertColorTerm(sourceColor.term)

    const targetCode = String(targetColor?.term?.code || "")
    const sourceCode = String(sourceColor.term.code || "")
    const targetName = String(targetColor?.term?.name || "")
    const sourceName = String(sourceColor.term.name || "")
    const alreadyCanonical = targetCode === sourceCode && normalizedToken(targetName) === normalizedToken(sourceName)

    if (alreadyCanonical) {
      stats.variantsAlreadyCanonical += 1
      continue
    }

    const nextAttributes = replaceColorAttribute(targetVariant.attributes, sourceColor)
    const payload = { attributes: nextAttributes }

    if (dryRun) {
      stats.variantsWouldUpdate += 1
      continue
    }

    const result = await upzeroFetch(`/external/v1/variants/${encodeURIComponent(variantId)}`, {
      method: "PATCH",
      body: payload,
    })

    if (result.ok) {
      stats.variantsUpdated += 1
    } else {
      stats.errors.push({
        step: "upzero.variants.patch_color",
        message: result.error,
        context: {
          productCode: sourceProduct.code,
          sku: sourceVariant.sku,
          variantId,
          from: targetColor?.term ?? null,
          to: sourceColor.term,
          response: result.data ?? result.rawText ?? null,
        },
      })
    }
  }
}

function replaceColorAttribute(attributes, sourceColor) {
  const next = Array.isArray(attributes) ? [...attributes] : []
  const index = next.findIndex((assignment) => {
    const code = String(assignment.attribute?.code || "").toLowerCase()
    const name = String(assignment.attribute?.name || "").toLowerCase()
    return code === "color" || name === "cor"
  })

  const canonicalColor = {
    attribute: { name: "Cor", code: "color" },
    term: { name: sourceColor.term.name, code: sourceColor.term.code },
  }

  if (index >= 0) next[index] = canonicalColor
  else next.unshift(canonicalColor)

  return next
}

async function upsertColorTerm(term) {
  const rgb = normalizeRgb(term.rgb ?? term.meta?.rgb)
  if (!term.code || !term.name) return

  if (dryRun) {
    stats.colorTermsWouldUpsert += 1
    return
  }

  const result = await upzeroFetch("/external/v1/attributes/by-code/color/terms", {
    method: "POST",
    body: {
      code: term.code,
      name: term.name,
      rgb: rgb ?? undefined,
      meta: {
        vesti_code: term.code,
        vesti_rgb: rgb,
      },
    },
  })

  if (result.ok) {
    stats.colorTermsUpserted += 1
  } else {
    stats.errors.push({
      step: "upzero.attributes.color_terms.upsert",
      message: result.error,
      context: { term, response: result.data ?? result.rawText ?? null },
    })
  }
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

async function findUpzeroProductByCode(code) {
  const byCode = await upzeroFetch(`/external/v1/products/by-code/${encodeURIComponent(code)}`)
  if (byCode.ok) return byCode.data

  if (byCode.status !== 404) {
    stats.errors.push({
      step: "upzero.products.find_by_code",
      message: byCode.error,
      context: { code, status: byCode.status, response: byCode.data ?? byCode.rawText ?? null },
    })
  }

  const listed = await upzeroFetch(`/external/v1/products?code=${encodeURIComponent(code)}&limit=10`)
  if (!listed.ok) return null
  return extractArray(listed.data).find((product) => String(product.code || "") === code) ?? null
}

function mapVestiProductForColorFix(product) {
  const colors = colorById(product)
  const sizes = sizeById(product)
  const productCode = stableCode(product.code || product.integration_id, product.id)

  return {
    code: productCode,
    variants: (product.stocks ?? []).map((stock) => {
      const color = colors.get(cleanString(stock.color_id))
      const size = sizes.get(cleanString(stock.size_id))
      const colorTerm = mapVestiColorTerm(mergeColorContext(color, {
        id: stock.color_id,
        name: stock.color_name,
        code: stock.color_code,
      }))
      const sizeTerm = mapVestiSizeTerm(size ?? { id: stock.size_id, name: stock.size_name })

      return {
        external_ref: { integration: "vesti", external_id: cleanString(stock.id || stock.sku) },
        sku: variantSku(productCode, stock),
        attributes: [
          {
            attribute: { name: "Cor", code: "color" },
            term: { name: colorTerm.name, code: colorTerm.code, rgb: colorTerm.rgb, meta: colorTerm.meta },
          },
          {
            attribute: { name: "Tamanho", code: "size" },
            term: { name: sizeTerm.name, code: sizeTerm.code },
          },
        ],
      }
    }),
  }
}

function colorAssignment(variant) {
  if (!Array.isArray(variant.attributes)) return null
  return variant.attributes.find((assignment) => {
    const code = String(assignment.attribute?.code || "").toLowerCase()
    const name = String(assignment.attribute?.name || "").toLowerCase()
    return code === "color" || name === "cor"
  }) ?? null
}

function colorById(product) {
  return new Map((product.colors ?? []).map((color) => [cleanString(color.id), color]))
}

function sizeById(product) {
  return new Map((product.sizes ?? []).map((size) => [cleanString(size.id), size]))
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

function mapVestiSizeTerm(size) {
  return {
    code: termCode(size.slug || size.name, size.id),
    name: cleanString(size.name || "Tamanho"),
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

function termCode(value, fallback) {
  return stableCode(value, fallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80)
}

function variantSku(productCode, stock) {
  return stableCode(stock.sku, `${productCode}-${stock.id ?? "sku"}`)
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
