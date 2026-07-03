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

function extractObject(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null
  for (const key of ["response", "data", "item", "result"]) {
    if (data[key] && typeof data[key] === "object" && !Array.isArray(data[key])) return data[key]
  }
  return data
}

function findColorAttribute(attributes) {
  return attributes.find((attribute) => {
    const code = String(attribute.code || "").toLowerCase()
    const name = String(attribute.name || "").toLowerCase()
    return code === "color" || name === "cor"
  })
}

async function listColorTerms(attributeId) {
  const result = await request(`/external/v1/attributes/${encodeURIComponent(attributeId)}/terms`)
  return result.ok ? extractArray(result.data) : []
}

const attributesResult = await request("/external/v1/attributes")
const attribute = attributesResult.ok ? findColorAttribute(extractArray(attributesResult.data)) : null
const attributeId = idOf(attribute)
if (!attributeId) {
  console.log(JSON.stringify({ ok: false, step: "color.find", status: attributesResult.status }, null, 2))
  process.exit(1)
}

const stamp = Date.now().toString(36)
const code = `codex-test-${stamp}`
const name = `Codex Teste ${stamp}`
const updatedName = `Codex Teste Atualizado ${stamp}`
const endpoint = `/external/v1/attributes/${encodeURIComponent(attributeId)}/terms`
const createdIds = new Set()

const createResult = await request(endpoint, {
  method: "POST",
  body: JSON.stringify({
    code,
    name,
    rgb: "#010203",
    meta: { codex_probe: stamp },
  }),
})

const createdObject = extractObject(createResult.data)
const createdObjectId = idOf(createdObject)
if (createdObjectId) createdIds.add(createdObjectId)

let afterCreate = await listColorTerms(attributeId)
for (const term of afterCreate.filter((term) => String(term.code) === code || term.meta?.codex_probe === stamp)) {
  const id = idOf(term)
  if (id) createdIds.add(id)
}

const postAgainResult = await request(endpoint, {
  method: "POST",
  body: JSON.stringify({
    code,
    name: updatedName,
    rgb: "#040506",
    meta: { codex_probe: stamp, updated: true },
  }),
})

const postAgainObject = extractObject(postAgainResult.data)
const postAgainObjectId = idOf(postAgainObject)
if (postAgainObjectId) createdIds.add(postAgainObjectId)

let afterPostAgain = await listColorTerms(attributeId)
const matchingAfterPostAgain = afterPostAgain.filter((term) => String(term.code) === code || term.meta?.codex_probe === stamp)
for (const term of matchingAfterPostAgain) {
  const id = idOf(term)
  if (id) createdIds.add(id)
}

const deleteResults = []
for (const id of createdIds) {
  const result = await request(`${endpoint}/${encodeURIComponent(id)}`, { method: "DELETE" })
  deleteResults.push({ id, ok: result.ok, status: result.status })
}

console.log(JSON.stringify({
  attributeId,
  create: { ok: createResult.ok, status: createResult.status, statusText: createResult.statusText },
  postAgain: { ok: postAgainResult.ok, status: postAgainResult.status, statusText: postAgainResult.statusText },
  responseIds: {
    create: createdObjectId || null,
    postAgain: postAgainObjectId || null,
  },
  responseKeys: {
    create: createResult.data && typeof createResult.data === "object" ? Object.keys(createResult.data).slice(0, 10) : [],
    postAgain: postAgainResult.data && typeof postAgainResult.data === "object" ? Object.keys(postAgainResult.data).slice(0, 10) : [],
  },
  listCounts: {
    afterCreate: afterCreate.length,
    afterPostAgain: afterPostAgain.length,
  },
  matchingTermsAfterPostAgain: matchingAfterPostAgain.map((term) => ({
    id: idOf(term),
    code: term.code,
    name: term.name,
    rgb: term.rgb || term.meta?.rgb || null,
  })),
  cleanup: deleteResults,
}, null, 2))
