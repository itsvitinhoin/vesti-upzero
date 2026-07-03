// Helper compartilhado pelas rotas internas para chamar as APIs externas.
// Centraliza montagem de headers, tratamento de erro, timing e parsing seguro.

export interface ProxyRequest {
  baseUrl?: string
  endpoint?: string
  endpointParams?: Record<string, string>
  token?: string
  secretValues?: string[]
  extraHeaders?: Record<string, string> | string
  method?: string
  body?: unknown
  // Esquema de autenticação: "bearer" (padrão) ou "header" (token direto)
  authScheme?: "bearer" | "header"
  authHeaderName?: string
}

export interface ProxyResult {
  ok: boolean
  status: number
  statusText: string
  url: string
  durationMs: number
  responseHeaders: Record<string, string>
  data: unknown
  rawText?: string
  error?: string
}

const SENSITIVE_HEADER_RE = /^(authorization|cookie|set-cookie|x-api-key|api-key)$/i
const SENSITIVE_KEY_RE = /(authorization|cookie|token|api[-_]?key|secret|password)/i
const SENSITIVE_QUERY_RE = /^(access_token|auth|authorization|token|api_key|apikey|key|secret|password)$/i

function sanitizeText(value: string, secrets: string[]): string {
  let sanitized = value

  for (const secret of secrets) {
    if (secret) sanitized = sanitized.split(secret).join("[redacted]")
  }

  return sanitized
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(access_token|api_key|apikey|token|secret|password)=([^&\s]+)/gi, "$1=[redacted]")
}

function sanitizeValue(value: unknown, secrets: string[], key = ""): unknown {
  if (SENSITIVE_KEY_RE.test(key)) return "[redacted]"

  if (typeof value === "string") return sanitizeText(value, secrets)

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, secrets))
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(value)) {
      out[childKey] = sanitizeValue(childValue, secrets, childKey)
    }
    return out
  }

  return value
}

function sanitizeHeaders(headers: Record<string, string>, secrets: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SENSITIVE_HEADER_RE.test(key) ? "[redacted]" : sanitizeText(value, secrets)
  }
  return out
}

function sanitizeUrl(url: string, secrets: string[]): string {
  if (!url) return url

  try {
    const parsed = new URL(url)
    parsed.searchParams.forEach((_, key) => {
      if (SENSITIVE_QUERY_RE.test(key)) parsed.searchParams.set(key, "[redacted]")
    })
    return sanitizeText(parsed.toString(), secrets)
  } catch {
    return sanitizeText(url, secrets)
  }
}

function parseExtraHeaders(extra?: Record<string, string> | string): Record<string, string> {
  if (!extra) return {}
  if (typeof extra === "string") {
    const trimmed = extra.trim()
    if (!trimmed) return {}
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === "object") return parsed as Record<string, string>
    } catch {
      throw new Error("Headers extras inválidos: precisa ser um JSON válido.")
    }
  } else if (typeof extra === "object") {
    return extra
  }
  return {}
}

function applyEndpointParams(endpoint: string, params?: Record<string, string>): string {
  if (!params) return endpoint

  return Object.entries(params).reduce((path, [key, value]) => {
    return path
      .replaceAll(`{${key}}`, encodeURIComponent(value))
      .replaceAll(`:${key}`, encodeURIComponent(value))
  }, endpoint)
}

function buildUrl(baseUrl: string, endpoint: string, params?: Record<string, string>): string {
  const base = baseUrl.replace(/\/+$/, "")
  const resolvedEndpoint = applyEndpointParams(endpoint, params)
  if (!resolvedEndpoint || resolvedEndpoint === "/") return base + "/"
  const path = resolvedEndpoint.startsWith("/") ? resolvedEndpoint : `/${resolvedEndpoint}`
  return base + path
}

export async function proxyFetch(req: ProxyRequest): Promise<ProxyResult> {
  const start = Date.now()

  if (!req.baseUrl) {
    return {
      ok: false,
      status: 0,
      statusText: "",
      url: "",
      durationMs: 0,
      responseHeaders: {},
      data: null,
      error: "Base URL não informada.",
    }
  }

  let url = ""
  try {
    url = buildUrl(req.baseUrl, req.endpoint ?? "/", req.endpointParams)

    const headers: Record<string, string> = {
      Accept: "application/json",
    }

    if (req.body !== undefined && req.method && req.method !== "GET") {
      headers["Content-Type"] = "application/json"
    }

    if (req.token) {
      const scheme = req.authScheme ?? "bearer"
      if (scheme === "bearer") {
        headers["Authorization"] = `Bearer ${req.token}`
      } else {
        headers[req.authHeaderName || "Authorization"] = req.token
      }
    }

    Object.assign(headers, parseExtraHeaders(req.extraHeaders))

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20000)

    let response: Response
    try {
      response = await fetch(url, {
        method: req.method ?? "GET",
        headers,
        body:
          req.body !== undefined && req.method && req.method !== "GET"
            ? JSON.stringify(req.body)
            : undefined,
        signal: controller.signal,
        cache: "no-store",
      })
    } finally {
      clearTimeout(timeout)
    }

    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value
    })

    const secrets = [req.token, ...(req.secretValues ?? [])].filter(Boolean) as string[]
    const rawText = await response.text()
    let data: unknown = null
    let parseError: string | undefined

    if (rawText) {
      try {
        data = JSON.parse(rawText)
      } catch {
        data = null
        parseError = "Resposta não é um JSON válido."
      }
    }

    const durationMs = Date.now() - start

    let error: string | undefined
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        error = "Erro de autenticação: verifique o token/API key."
      } else if (response.status === 404) {
        error = "Endpoint não encontrado (404): verifique a URL e o endpoint."
      } else if (response.status === 429) {
        error = "Limite de requisições atingido (429): aguarde antes de tentar novamente."
      } else if (response.status >= 500) {
        error = `Erro no servidor externo (${response.status}).`
      } else {
        error = `Requisição falhou com status ${response.status}.`
      }
    } else if (parseError) {
      error = parseError
    }

    return {
      ok: response.ok && !parseError,
      status: response.status,
      statusText: response.statusText,
      url: sanitizeUrl(url, secrets),
      durationMs,
      responseHeaders: sanitizeHeaders(responseHeaders, secrets),
      data: sanitizeValue(data, secrets),
      rawText: data === null ? sanitizeText(rawText, secrets).slice(0, 5000) : undefined,
      error,
    }
  } catch (err) {
    const durationMs = Date.now() - start
    const message = err instanceof Error ? err.message : "Erro desconhecido."
    let friendly = message
    if (message.includes("aborted") || message.includes("abort")) {
      friendly = "Tempo limite excedido (timeout) ao chamar a API externa."
    } else if (message.toLowerCase().includes("fetch")) {
      friendly = `Falha na conexão com a API externa. Verifique a URL. (${message})`
    }
    return {
      ok: false,
      status: 0,
      statusText: "",
      url: sanitizeUrl(url, [req.token, ...(req.secretValues ?? [])].filter(Boolean) as string[]),
      durationMs,
      responseHeaders: {},
      data: null,
      error: friendly,
    }
  }
}

// Extrai um array de itens de respostas com formatos variados.
export function extractArray(data: unknown): any[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>
    for (const key of ["response", "data", "items", "results", "products", "categories", "content"]) {
      if (Array.isArray(obj[key])) return obj[key] as any[]
    }
  }
  return []
}
