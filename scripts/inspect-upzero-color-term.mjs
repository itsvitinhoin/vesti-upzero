import fs from "node:fs"

function loadEnvFile(path) {
  const out = {}
  if (!fs.existsSync(path)) return out
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const index = trimmed.indexOf("=")
    if (index === -1) continue
    out[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "")
  }
  return out
}

const env = { ...loadEnvFile(".env.local"), ...process.env }
const baseUrl = (env.UPZERO_API_BASE_URL || "").replace(/\/+$/, "")
const token = env.UPZERO_API_TOKEN || ""
const tokenHeader = env.UPZERO_API_TOKEN_HEADER_NAME || "X-API-KEY"
const query = process.argv[2] || "salmao-neon"

async function request(endpoint) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    headers: {
      Accept: "application/json",
      [tokenHeader]: token,
    },
  })
  const text = await response.text()
  try {
    return { ok: response.ok, status: response.status, data: text ? JSON.parse(text) : null }
  } catch {
    return { ok: response.ok, status: response.status, data: text }
  }
}

function extractArray(data) {
  if (Array.isArray(data)) return data
  if (data && typeof data === "object") {
    for (const key of ["response", "data", "items", "results", "content"]) {
      if (Array.isArray(data[key])) return data[key]
    }
  }
  return []
}

function normalizedToken(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/(^-|-$)/g, "")
}

const attributesResult = await request("/external/v1/attributes")
const color = extractArray(attributesResult.data).find((attribute) => {
  const code = String(attribute.code || "").toLowerCase()
  const name = String(attribute.name || "").toLowerCase()
  return code === "color" || name === "cor"
})

const attributeId = String(color?.id || color?.attribute_id || "")
const termsResult = await request(`/external/v1/attributes/${encodeURIComponent(attributeId)}/terms`)
const terms = extractArray(termsResult.data)
const needle = normalizedToken(query)
const matches = terms
  .filter((term) => {
    const candidates = [term.code, term.name, term.meta?.vesti_code, term.meta?.rgb, term.rgb]
    return candidates.some((candidate) => normalizedToken(candidate).includes(needle))
  })
  .map((term) => ({
    id: term.id || term.term_id,
    code: term.code,
    name: term.name,
    rgb: term.rgb || term.meta?.rgb || null,
    meta: term.meta || null,
  }))

console.log(JSON.stringify({
  attributeId,
  totalTerms: terms.length,
  query,
  matches,
}, null, 2))
