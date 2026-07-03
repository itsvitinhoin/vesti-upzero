import fs from "node:fs"

function loadEnvFile(path) {
  const out = {}
  if (!fs.existsSync(path)) return out
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const index = trimmed.indexOf("=")
    if (index === -1) continue
    const key = trimmed.slice(0, index).trim()
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "")
    out[key] = value
  }
  return out
}

const env = { ...loadEnvFile(".env.local"), ...process.env }
const baseUrl = (env.UPZERO_API_BASE_URL || "").replace(/\/+$/, "")
const token = env.UPZERO_API_TOKEN || ""
const tokenHeader = env.UPZERO_API_TOKEN_HEADER_NAME || "X-API-KEY"

if (!baseUrl || !token) {
  console.error("UPZERO_API_BASE_URL ou UPZERO_API_TOKEN ausente.")
  process.exit(1)
}

async function request(endpoint, init = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...init,
    headers: {
      Accept: "application/json",
      [tokenHeader]: token,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { ok: response.ok, status: response.status, statusText: response.statusText, data }
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

function idOf(value) {
  return String(value?.id || value?.attribute_id || value?.term_id || "")
}

const attributesResult = await request("/external/v1/attributes")
if (!attributesResult.ok) {
  console.log(JSON.stringify({ step: "attributes.list", status: attributesResult.status, ok: false }, null, 2))
  process.exit(1)
}

const colorAttribute = extractArray(attributesResult.data).find((attribute) => {
  const code = String(attribute.code || "").toLowerCase()
  const name = String(attribute.name || "").toLowerCase()
  return code === "color" || name === "cor"
})

const attributeId = idOf(colorAttribute)
if (!attributeId) {
  console.log(JSON.stringify({ step: "color.find", ok: false, reason: "Atributo Cor/color nao encontrado." }, null, 2))
  process.exit(1)
}

const termsResult = await request(`/external/v1/attributes/${encodeURIComponent(attributeId)}/terms`)
if (!termsResult.ok) {
  console.log(JSON.stringify({ step: "terms.list", status: termsResult.status, ok: false, attributeId }, null, 2))
  process.exit(1)
}

const term = extractArray(termsResult.data).find((item) => idOf(item) && (item.code || item.name))
const termId = idOf(term)
if (!termId) {
  console.log(JSON.stringify({ step: "term.pick", ok: false, reason: "Nenhum termo existente com ID para testar." }, null, 2))
  process.exit(1)
}

const body = {
  code: String(term.code || term.name || "cor"),
  name: String(term.name || term.code || "Cor"),
  rgb: term.rgb || term.meta?.rgb || undefined,
  meta: term.meta || undefined,
}

const putResult = await request(
  `/external/v1/attributes/${encodeURIComponent(attributeId)}/terms/${encodeURIComponent(termId)}`,
  {
    method: "PUT",
    body: JSON.stringify(body),
  },
)

console.log(JSON.stringify({
  tested: "PUT /external/v1/attributes/{attributeId}/terms/{termId}",
  ok: putResult.ok,
  status: putResult.status,
  statusText: putResult.statusText,
  attributeId,
  termId,
  termCode: body.code,
  termName: body.name,
}, null, 2))
