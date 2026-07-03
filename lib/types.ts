export interface ProxyResultClient {
  ok: boolean
  status: number
  statusText: string
  url: string
  durationMs: number
  responseHeaders: Record<string, string>
  data: unknown
  rawText?: string
  error?: string
  mappedPayload?: unknown
}

export interface LogEntry {
  id: string
  timestamp: string
  label: string
  method: string
  url: string
  status: number
  durationMs: number
  ok: boolean
  error?: string
  responseBody: unknown
  requestSummary: string
}

export interface IntegrationConfigStatus {
  vesti: {
    baseUrlConfigured: boolean
    tokenConfigured: boolean
    companyIdConfigured?: boolean
  }
  upzero: {
    baseUrlConfigured: boolean
    tokenConfigured: boolean
  }
}

export interface Endpoints {
  vestiTest: string
  vestiCategories: string
  vestiProducts: string
  upzeroTest: string
  upzeroCategories: string
  upzeroInternalCategories: string
  upzeroProducts: string
}
