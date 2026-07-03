"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { PreviewTable } from "@/components/preview-table"
import { LogPanel } from "@/components/log-panel"
import { JsonViewer } from "@/components/json-viewer"
import { DEFAULT_ENDPOINTS } from "@/lib/api-config"
import type { Endpoints, LogEntry, ProxyResultClient } from "@/lib/types"
import {
  Plug,
  FolderTree,
  Package,
  Eye,
  Loader2,
  ShieldCheck,
  DatabaseZap,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  XCircle,
} from "lucide-react"

const initialEndpoints: Endpoints = {
  vestiTest: DEFAULT_ENDPOINTS.vesti.test,
  vestiCategories: DEFAULT_ENDPOINTS.vesti.categories,
  vestiProducts: DEFAULT_ENDPOINTS.vesti.products,
  upzeroTest: DEFAULT_ENDPOINTS.upzero.test,
  upzeroCategories: DEFAULT_ENDPOINTS.upzero.categories,
  upzeroInternalCategories: DEFAULT_ENDPOINTS.upzero.internalCategories,
  upzeroProducts: DEFAULT_ENDPOINTS.upzero.products,
}

const TEST_CATEGORY = {
  name: "Categoria de Teste",
  slug: "categoria-de-teste",
  external_id: "test-cat-001",
  parent_external_id: null,
}

const TEST_PRODUCT = {
  name: "Produto de Teste",
  description: "Produto de teste enviado pelo Import Tester.",
  sku: "TEST-SKU-001",
  price: 99.9,
  promotional_price: 79.9,
  category_external_id: "test-cat-001",
  images: [],
  variants: [],
  stock: 10,
  status: "active",
  external_id: "test-prod-001",
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function ImportTester() {
  const [endpoints, setEndpoints] = useState<Endpoints>(initialEndpoints)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [categories, setCategories] = useState<any[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [viewer, setViewer] = useState<{ title: string; data: unknown } | null>(null)
  const [migration, setMigration] = useState({
    startDate: "2016-01-01",
    endDate: new Date().toISOString().slice(0, 10),
    maxProducts: "25",
    productStatus: "all" as "all" | "active" | "inactive",
    includeImages: false,
    syncStock: true,
    replaceImages: false,
    deactivateExtraVariants: false,
    pruneExtraAttributeTerms: false,
    archiveExtraProducts: false,
    mirrorMode: false,
    latestFirst: true,
  })
  const [credentials, setCredentials] = useState({
    vestiApiBaseUrl: "https://integracao.meuvesti.com/api",
    vestiApiTokenHeaderName: "apikey",
    vestiCompanyId: "",
    vestiApiToken: "",
    upzeroApiBaseUrl: "https://api.upzero.com.br",
    upzeroApiToken: "",
  })
  const [credentialError, setCredentialError] = useState("")
  const [migrationResult, setMigrationResult] = useState<unknown>(null)
  const [colorTermsResult, setColorTermsResult] = useState<unknown>(null)
  const [activeStatusCodes, setActiveStatusCodes] = useState("")
  const [statusSyncResult, setStatusSyncResult] = useState<unknown>(null)

  const missingCredentials = [
    ["Vesti Base URL", credentials.vestiApiBaseUrl],
    ["Vesti Company ID", credentials.vestiCompanyId],
    ["Vesti API Key", credentials.vestiApiToken],
    ["UP Zero Base URL", credentials.upzeroApiBaseUrl],
    ["UP Zero X-API-KEY", credentials.upzeroApiToken],
  ]
    .filter(([, value]) => !String(value).trim())
    .map(([label]) => label)

  const credentialsReady = missingCredentials.length === 0

  function updateEndpoint<K extends keyof Endpoints>(key: K, value: Endpoints[K]) {
    setEndpoints((e) => ({ ...e, [key]: value }))
  }

  function updateCredential<K extends keyof typeof credentials>(key: K, value: (typeof credentials)[K]) {
    setCredentialError("")
    setCredentials((current) => ({ ...current, [key]: value }))
  }

  function requestCredentials() {
    return {
      requireExplicitCredentials: true,
      vestiApiBaseUrl: credentials.vestiApiBaseUrl.trim(),
      vestiApiTokenHeaderName: credentials.vestiApiTokenHeaderName.trim() || "apikey",
      vestiCompanyId: credentials.vestiCompanyId.trim(),
      vestiApiToken: credentials.vestiApiToken.trim(),
      upzeroApiBaseUrl: credentials.upzeroApiBaseUrl.trim(),
      upzeroApiToken: credentials.upzeroApiToken.trim(),
    }
  }

  function ensureCredentials() {
    if (credentialsReady) return true

    setCredentialError(`Preencha antes de rodar: ${missingCredentials.join(", ")}.`)
    return false
  }

  function addLog(
    label: string,
    method: string,
    requestSummary: string,
    result: ProxyResultClient,
  ) {
    const entry: LogEntry = {
      id: uid(),
      timestamp: new Date().toLocaleTimeString("pt-BR"),
      label,
      method,
      url: result.url,
      status: result.status,
      durationMs: result.durationMs,
      ok: result.ok,
      error: result.error,
      responseBody: result.data ?? result.rawText ?? null,
      requestSummary,
    }
    setLogs((l) => [entry, ...l])
  }

  async function call(
    path: string,
    label: string,
    method: string,
    payload: Record<string, unknown>,
    requestSummary: string,
  ): Promise<ProxyResultClient | null> {
    setBusy(label)
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const parsed = await res.json().catch(() => ({
        ok: false,
        status: res.status,
        statusText: res.statusText,
        url: path,
        durationMs: 0,
        responseHeaders: {},
        data: null,
        error: "Resposta inválida da rota interna.",
      }))
      const result: ProxyResultClient =
        typeof parsed.status === "number"
          ? parsed
          : {
              ok: Boolean(parsed.ok),
              status: res.status,
              statusText: res.statusText,
              url: path,
              durationMs: 0,
              responseHeaders: {},
              data: parsed,
              error: parsed.ok === false ? "A rota interna retornou falha." : undefined,
            }
      addLog(label, method, requestSummary, result)
      return result
    } catch (err) {
      addLog(label, method, requestSummary, {
        ok: false,
        status: 0,
        statusText: "",
        url: "",
        durationMs: 0,
        responseHeaders: {},
        data: null,
        error: err instanceof Error ? err.message : "Erro ao chamar rota interna.",
      })
      return null
    } finally {
      setBusy(null)
    }
  }

  // --- Ações ---
  async function testVesti() {
    if (!ensureCredentials()) return
    await call(
      "/api/vesti/test",
      "Testar conexão Vesti",
      "GET",
      { endpoint: endpoints.vestiTest, credentials: requestCredentials() },
      `GET ${endpoints.vestiTest}`,
    )
  }

  async function testUpzero() {
    if (!ensureCredentials()) return
    await call(
      "/api/upzero/test",
      "Testar conexão UP Zero",
      "GET",
      { endpoint: endpoints.upzeroTest, credentials: requestCredentials() },
      `GET ${endpoints.upzeroTest}`,
    )
  }

  async function fetchCategories() {
    if (!ensureCredentials()) return
    const r = await call(
      "/api/vesti/categories",
      "Buscar categorias da Vesti",
      "GET",
      { endpoint: endpoints.vestiCategories, credentials: requestCredentials() },
      `GET ${endpoints.vestiCategories}`,
    )
    if (r?.ok) setCategories(extractArray(r.data))
  }

  async function fetchProducts() {
    if (!ensureCredentials()) return
    const r = await call(
      "/api/vesti/products",
      "Buscar produtos da Vesti",
      "GET",
      { endpoint: endpoints.vestiProducts, credentials: requestCredentials() },
      `GET ${endpoints.vestiProducts}`,
    )
    if (r?.ok) setProducts(extractArray(r.data))
  }

  function viewFirstProduct() {
    if (products.length === 0) {
      setViewer({ title: "Primeiro produto", data: "Nenhum produto carregado. Busque produtos primeiro." })
    } else {
      setViewer({ title: "Primeiro produto retornado (bruto)", data: products[0] })
    }
  }

  function viewFirstCategory() {
    if (categories.length === 0) {
      setViewer({ title: "Primeira categoria", data: "Nenhuma categoria carregada. Busque categorias primeiro." })
    } else {
      setViewer({ title: "Primeira categoria retornada (bruta)", data: categories[0] })
    }
  }

  async function sendTestCategory() {
    if (!ensureCredentials()) return
    await call(
      "/api/upzero/create-category",
      "Enviar categoria de teste",
      "POST",
      { endpoint: endpoints.upzeroCategories, payload: TEST_CATEGORY, credentials: requestCredentials() },
      `POST ${endpoints.upzeroCategories}`,
    )
  }

  async function sendTestProduct() {
    if (!ensureCredentials()) return
    await call(
      "/api/upzero/create-product",
      "Enviar produto de teste",
      "POST",
      { endpoint: endpoints.upzeroProducts, payload: TEST_PRODUCT, credentials: requestCredentials() },
      `POST ${endpoints.upzeroProducts}`,
    )
  }

  async function sendProduct(raw: any) {
    if (!ensureCredentials()) return
    const id = (raw?.external_id ?? raw?.id ?? raw?.code ?? "selected").toString()
    setSendingId(id)
    try {
      await call(
        "/api/sync/product",
        "Sincronizar produto",
        "POST",
        { product: raw, upzero: { endpoint: endpoints.upzeroProducts }, credentials: requestCredentials() },
        `POST ${endpoints.upzeroProducts}`,
      )
    } finally {
      setSendingId(null)
    }
  }

  async function sendCategory(raw: any) {
    if (!ensureCredentials()) return
    const id = (raw?.external_id ?? raw?.id ?? raw?.code ?? "selected").toString()
    setSendingId(id)
    try {
      const { mapVestiCategoryToUpzero } = await import("@/lib/mappers/vesti-to-upzero")
      await call(
        "/api/upzero/create-category",
        "Enviar categoria selecionada",
        "POST",
        {
          endpoint: endpoints.upzeroCategories,
          payload: mapVestiCategoryToUpzero(raw),
          credentials: requestCredentials(),
        },
        `POST ${endpoints.upzeroCategories}`,
      )
    } finally {
      setSendingId(null)
    }
  }

  async function compareCatalog() {
    if (busy) return
    if (!ensureCredentials()) return
    const maxProducts = migration.maxProducts.trim()
      ? Number(migration.maxProducts)
      : undefined

    await streamCatalog(
      "Comparar catálogo",
      {
        dryRun: true,
        compareOnly: true,
        realtime: true,
        startDate: migration.startDate,
        endDate: migration.endDate,
        maxProducts,
        productStatus: migration.productStatus,
        includeImages: migration.mirrorMode || migration.includeImages,
        syncStock: migration.syncStock,
        replaceImages: migration.mirrorMode || migration.replaceImages,
        deactivateExtraVariants: migration.mirrorMode || migration.deactivateExtraVariants,
        pruneExtraAttributeTerms: migration.mirrorMode || migration.pruneExtraAttributeTerms,
        archiveExtraProducts: migration.mirrorMode || migration.archiveExtraProducts,
        latestFirst: migration.latestFirst,
        credentials: requestCredentials(),
      },
      "POST /api/sync/catalog · comparação",
    )
  }

  async function sendCatalog() {
    if (busy) return
    if (!ensureCredentials()) return
    const maxProducts = migration.maxProducts.trim()
      ? Number(migration.maxProducts)
      : undefined

    await streamCatalog(
      "Enviar produtos",
      {
        dryRun: false,
        compareOnly: false,
        realtime: true,
        startDate: migration.startDate,
        endDate: migration.endDate,
        maxProducts,
        productStatus: migration.productStatus,
        includeImages: migration.mirrorMode || migration.includeImages,
        syncStock: migration.syncStock,
        replaceImages: migration.mirrorMode || migration.replaceImages,
        deactivateExtraVariants: migration.mirrorMode || migration.deactivateExtraVariants,
        pruneExtraAttributeTerms: migration.mirrorMode || migration.pruneExtraAttributeTerms,
        archiveExtraProducts: migration.mirrorMode || migration.archiveExtraProducts,
        latestFirst: migration.latestFirst,
        credentials: requestCredentials(),
      },
      "POST /api/sync/catalog · envio",
    )
  }

  async function previewColorTerms() {
    if (busy) return
    if (!ensureCredentials()) return
    const maxProducts = migration.maxProducts.trim()
      ? Number(migration.maxProducts)
      : undefined

    await streamColorTerms(
      "Prévia de cores",
      {
        dryRun: true,
        realtime: true,
        prune: true,
        startDate: migration.startDate,
        endDate: migration.endDate,
        maxProducts,
        credentials: requestCredentials(),
      },
      "POST /api/sync/color-terms · prévia",
    )
  }

  async function syncColorTerms() {
    if (busy) return
    if (!ensureCredentials()) return
    const maxProducts = migration.maxProducts.trim()
      ? Number(migration.maxProducts)
      : undefined

    await streamColorTerms(
      "Sincronizar cores",
      {
        dryRun: false,
        realtime: true,
        prune: true,
        startDate: migration.startDate,
        endDate: migration.endDate,
        maxProducts,
        credentials: requestCredentials(),
      },
      "POST /api/sync/color-terms · gravação",
    )
  }

  async function previewProductStatuses() {
    if (!ensureCredentials()) return
    const result = await call(
      "/api/upzero/bulk-status",
      "Prévia status produtos",
      "POST",
      {
        dryRun: true,
        activeCodes: activeStatusCodes,
        credentials: requestCredentials(),
      },
      "POST /api/upzero/bulk-status · prévia",
    )
    if (result?.data) setStatusSyncResult(result.data)
  }

  async function applyProductStatuses() {
    if (!ensureCredentials()) return
    const result = await call(
      "/api/upzero/bulk-status",
      "Aplicar status produtos",
      "PATCH",
      {
        dryRun: false,
        activeCodes: activeStatusCodes,
        credentials: requestCredentials(),
      },
      "PATCH /api/upzero/bulk-status · aplicar",
    )
    if (result?.data) setStatusSyncResult(result.data)
  }

  async function streamColorTerms(
    label: string,
    payload: Record<string, unknown>,
    requestSummary: string,
  ) {
    setBusy(label)
    const startedAt = performance.now()
    let finalReport: unknown = null

    setColorTermsResult({
      ok: true,
      streaming: true,
      stats: {},
      colorTerms: [],
      progress: {
        type: "started",
        processed: 0,
        total: 0,
      },
    })

    try {
      const res = await fetch("/api/sync/color-terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "")
        throw new Error(text || `A rota interna retornou HTTP ${res.status}.`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split("\n\n")
        buffer = events.pop() ?? ""

        for (const eventText of events) {
          const dataLine = eventText
            .split("\n")
            .find((line) => line.startsWith("data:"))
          if (!dataLine) continue

          const event = JSON.parse(dataLine.slice(5).trim())
          if (event.type === "done" && "report" in event) {
            finalReport = {
              ...event.report,
              streaming: false,
              progress: {
                type: "done",
                processed: event.report?.colorTerms?.length ?? 0,
                total: event.report?.colorTerms?.length ?? 0,
              },
            }
            setColorTermsResult(finalReport)
          } else if (event.type === "fatal_error") {
            throw new Error(event.message || "Falha inesperada ao sincronizar cores.")
          } else {
            setColorTermsResult((current: unknown) => mergeColorTermsProgress(current, event))
          }
        }
      }

      addLog(label, "POST", requestSummary, {
        ok: true,
        status: res.status,
        statusText: res.statusText,
        url: "/api/sync/color-terms",
        durationMs: Math.round(performance.now() - startedAt),
        responseHeaders: {},
        data: finalReport,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao chamar rota interna."
      setColorTermsResult((current: unknown) => ({
        ...(current && typeof current === "object" ? (current as Record<string, unknown>) : {}),
        ok: false,
        streaming: false,
        progress: {
          type: "fatal_error",
          message,
        },
      }))
      addLog(label, "POST", requestSummary, {
        ok: false,
        status: 0,
        statusText: "",
        url: "/api/sync/color-terms",
        durationMs: Math.round(performance.now() - startedAt),
        responseHeaders: {},
        data: null,
        error: message,
      })
    } finally {
      setBusy(null)
    }
  }

  async function streamCatalog(
    label: string,
    payload: Record<string, unknown>,
    requestSummary: string,
  ) {
    setBusy(label)
    const startedAt = performance.now()
    let finalReport: unknown = null

    setMigrationResult({
      ok: true,
      streaming: true,
      stats: {},
      processedProducts: [],
      progress: {
        type: "catalog_started",
        processed: 0,
        total: 0,
        elapsedMs: 0,
      },
    })

    try {
      const res = await fetch("/api/sync/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "")
        throw new Error(text || `A rota interna retornou HTTP ${res.status}.`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split("\n\n")
        buffer = events.pop() ?? ""

        for (const eventText of events) {
          const dataLine = eventText
            .split("\n")
            .find((line) => line.startsWith("data:"))
          if (!dataLine) continue

          const event = JSON.parse(dataLine.slice(5).trim())
          if (event.type === "done" && "report" in event) {
            finalReport = {
              ...event.report,
              streaming: false,
              progress: {
                type: "done",
                processed: event.report?.processedProducts?.length ?? 0,
                total: event.report?.processedProducts?.length ?? 0,
                estimatedRemainingMs: 0,
              },
            }
            setMigrationResult(finalReport)
          } else if (event.type === "fatal_error") {
            throw new Error(event.message || "Falha inesperada durante a sincronização.")
          } else {
            setMigrationResult((current: unknown) => mergeMigrationProgress(current, event))
          }
        }
      }

      addLog(label, "POST", requestSummary, {
        ok: true,
        status: res.status,
        statusText: res.statusText,
        url: "/api/sync/catalog",
        durationMs: Math.round(performance.now() - startedAt),
        responseHeaders: {},
        data: finalReport,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao chamar rota interna."
      setMigrationResult((current: unknown) => ({
        ...(current && typeof current === "object" ? (current as Record<string, unknown>) : {}),
        ok: false,
        streaming: false,
        progress: {
          type: "fatal_error",
          message,
        },
      }))
      addLog(label, "POST", requestSummary, {
        ok: false,
        status: 0,
        statusText: "",
        url: "/api/sync/catalog",
        durationMs: Math.round(performance.now() - startedAt),
        responseHeaders: {},
        data: null,
        error: message,
      })
    } finally {
      setBusy(null)
    }
  }

  async function copyMigrationJson() {
    if (!migrationResult) return
    await navigator.clipboard.writeText(JSON.stringify(migrationResult, null, 2))
  }

  function downloadMigrationJson() {
    if (!migrationResult) return
    const blob = new Blob([JSON.stringify(migrationResult, null, 2)], {
      type: "application/json",
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `vesti-upzero-migracao-${new Date().toISOString().slice(0, 19)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const loading = (label: string) => busy === label

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
      {/* Coluna principal */}
      <div className="flex flex-col gap-6">
        {/* Configuração backend */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-primary" />
              Configuração segura
            </CardTitle>
            <CardDescription>
              As chaves digitadas aqui são usadas só na chamada atual e não são salvas em storage,
              cookies ou arquivos. Sem preencher esses campos, nenhuma ação usa credenciais antigas do .env.local.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {credentialError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive md:col-span-2">
                {credentialError}
              </div>
            ) : null}
            <div className="rounded-md border border-border p-4">
              <h3 className="text-sm font-semibold text-muted-foreground">Vesti (origem)</h3>
              <ConfigStatusRow
                label="VESTI_API_BASE_URL"
                configured={Boolean(credentials.vestiApiBaseUrl.trim())}
              />
              <ConfigStatusRow
                label="VESTI_API_TOKEN"
                configured={Boolean(credentials.vestiApiToken.trim())}
              />
              <ConfigStatusRow
                label="VESTI_COMPANY_ID"
                configured={Boolean(credentials.vestiCompanyId.trim())}
              />
            </div>

            <div className="rounded-md border border-border p-4">
              <h3 className="text-sm font-semibold text-muted-foreground">UP Zero (destino)</h3>
              <ConfigStatusRow
                label="UPZERO_API_BASE_URL"
                configured={Boolean(credentials.upzeroApiBaseUrl.trim())}
              />
              <ConfigStatusRow
                label="UPZERO_API_TOKEN"
                configured={Boolean(credentials.upzeroApiToken.trim())}
              />
            </div>

            <div className="grid gap-4 md:col-span-2 md:grid-cols-2">
              <div className="grid gap-3 rounded-md border border-border p-4">
                <h3 className="text-sm font-semibold text-muted-foreground">Chaves temporárias Vesti</h3>
                <CredentialField
                  label="Base URL"
                  value={credentials.vestiApiBaseUrl}
                  onChange={(value) => updateCredential("vestiApiBaseUrl", value)}
                />
                <CredentialField
                  label="Header da API Key"
                  value={credentials.vestiApiTokenHeaderName}
                  onChange={(value) => updateCredential("vestiApiTokenHeaderName", value)}
                />
                <CredentialField
                  label="Company ID"
                  value={credentials.vestiCompanyId}
                  onChange={(value) => updateCredential("vestiCompanyId", value)}
                />
                <CredentialField
                  label="API Key"
                  value={credentials.vestiApiToken}
                  secret
                  onChange={(value) => updateCredential("vestiApiToken", value)}
                />
              </div>

              <div className="grid gap-3 rounded-md border border-border p-4">
                <h3 className="text-sm font-semibold text-muted-foreground">Chave temporária UP Zero</h3>
                <CredentialField
                  label="Base URL"
                  value={credentials.upzeroApiBaseUrl}
                  onChange={(value) => updateCredential("upzeroApiBaseUrl", value)}
                />
                <CredentialField
                  label="X-API-KEY"
                  value={credentials.upzeroApiToken}
                  secret
                  onChange={(value) => updateCredential("upzeroApiToken", value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Endpoints editáveis */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Endpoints</CardTitle>
            <CardDescription>
              Ajuste os caminhos sem alterar o código. São anexados à Base URL correspondente.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <EndpointField label="Vesti · teste" value={endpoints.vestiTest} onChange={(v) => updateEndpoint("vestiTest", v)} />
            <EndpointField label="Vesti · categorias" value={endpoints.vestiCategories} onChange={(v) => updateEndpoint("vestiCategories", v)} />
            <EndpointField label="Vesti · produtos" value={endpoints.vestiProducts} onChange={(v) => updateEndpoint("vestiProducts", v)} />
            <EndpointField label="UP Zero · teste" value={endpoints.upzeroTest} onChange={(v) => updateEndpoint("upzeroTest", v)} />
            <EndpointField label="UP Zero · categorias" value={endpoints.upzeroCategories} onChange={(v) => updateEndpoint("upzeroCategories", v)} />
            <EndpointField label="UP Zero · categorias internas" value={endpoints.upzeroInternalCategories} onChange={(v) => updateEndpoint("upzeroInternalCategories", v)} />
            <EndpointField label="UP Zero · produtos" value={endpoints.upzeroProducts} onChange={(v) => updateEndpoint("upzeroProducts", v)} />
          </CardContent>
        </Card>

        {/* Migração completa */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <DatabaseZap className="size-5 text-primary" />
              Migração de catálogo
            </CardTitle>
            <CardDescription>
              Busca a Vesti em janelas de 30 dias e prepara categorias, atributos, variantes,
              estoque e produtos para a UP Zero.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="grid gap-1.5">
                <Label htmlFor="migrationStart">Data inicial</Label>
                <Input
                  id="migrationStart"
                  type="date"
                  value={migration.startDate}
                  onChange={(e) => setMigration((m) => ({ ...m, startDate: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="migrationEnd">Data final</Label>
                <Input
                  id="migrationEnd"
                  type="date"
                  value={migration.endDate}
                  onChange={(e) => setMigration((m) => ({ ...m, endDate: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="migrationLimit">Limite de produtos</Label>
                <Input
                  id="migrationLimit"
                  type="number"
                  min="1"
                  placeholder="vazio = todos"
                  value={migration.maxProducts}
                  onChange={(e) => setMigration((m) => ({ ...m, maxProducts: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="migrationStatus">Status Vesti</Label>
                <select
                  id="migrationStatus"
                  value={migration.productStatus}
                  onChange={(e) =>
                    setMigration((m) => ({
                      ...m,
                      productStatus: e.target.value as "all" | "active" | "inactive",
                    }))
                  }
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="all">Todos</option>
                  <option value="active">Somente ativos</option>
                  <option value="inactive">Somente inativos</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                <input
                  type="checkbox"
                  checked={migration.mirrorMode}
                  onChange={(e) =>
                    setMigration((m) => ({
                      ...m,
                      mirrorMode: e.target.checked,
                      includeImages: e.target.checked ? true : m.includeImages,
                      replaceImages: e.target.checked ? true : m.replaceImages,
                      deactivateExtraVariants: e.target.checked ? true : m.deactivateExtraVariants,
                      pruneExtraAttributeTerms: e.target.checked ? true : m.pruneExtraAttributeTerms,
                      archiveExtraProducts: e.target.checked ? true : m.archiveExtraProducts,
                    }))
                  }
                />
                Modo espelho da Vesti
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={migration.latestFirst}
                  onChange={(e) => setMigration((m) => ({ ...m, latestFirst: e.target.checked }))}
                />
                Mais recentes primeiro
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={migration.syncStock}
                  onChange={(e) => setMigration((m) => ({ ...m, syncStock: e.target.checked }))}
                />
                Sincronizar estoque
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={migration.includeImages}
                  onChange={(e) => setMigration((m) => ({ ...m, includeImages: e.target.checked }))}
                />
                Enviar imagens
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={migration.replaceImages}
                  onChange={(e) => setMigration((m) => ({ ...m, replaceImages: e.target.checked }))}
                />
                Substituir imagens existentes
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={migration.deactivateExtraVariants}
                  onChange={(e) => setMigration((m) => ({ ...m, deactivateExtraVariants: e.target.checked }))}
                />
                Inativar variações extras
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={migration.pruneExtraAttributeTerms}
                  onChange={(e) => setMigration((m) => ({ ...m, pruneExtraAttributeTerms: e.target.checked }))}
                />
                Remover cores/tamanhos extras
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={migration.archiveExtraProducts}
                  onChange={(e) => setMigration((m) => ({ ...m, archiveExtraProducts: e.target.checked }))}
                />
                Arquivar produtos extras
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <ActionButton
                onClick={previewColorTerms}
                loading={loading("Prévia de cores")}
                variant="outline"
                icon={<Eye className="size-4" />}
              >
                Prévia Cores
              </ActionButton>
              <ActionButton
                onClick={syncColorTerms}
                loading={loading("Sincronizar cores")}
                variant="secondary"
                icon={<DatabaseZap className="size-4" />}
              >
                Sincronizar Cores
              </ActionButton>
              <ActionButton
                onClick={compareCatalog}
                loading={loading("Comparar catálogo")}
                variant="default"
                icon={<DatabaseZap className="size-4" />}
              >
                Sync / comparar
              </ActionButton>
              <ActionButton
                onClick={sendCatalog}
                loading={loading("Enviar produtos")}
                variant="secondary"
                icon={<Package className="size-4" />}
              >
                Enviar Produtos
              </ActionButton>
              {migrationResult ? (
                <JsonViewer
                  title="Resultado da migração"
                  data={migrationResult}
                  triggerLabel="Ver relatório"
                  variant="outline"
                />
              ) : null}
              {colorTermsResult ? (
                <JsonViewer
                  title="Resultado das cores"
                  data={colorTermsResult}
                  triggerLabel="Ver cores"
                  variant="outline"
                />
              ) : null}
              {migrationResult ? (
                <>
                  <Button type="button" variant="outline" onClick={copyMigrationJson} className="gap-2">
                    <Copy className="size-4" />
                    Copiar JSON
                  </Button>
                  <Button type="button" variant="outline" onClick={downloadMigrationJson} className="gap-2">
                    <Download className="size-4" />
                    Baixar JSON
                  </Button>
                </>
              ) : null}
            </div>

            {migration.maxProducts.trim() ? (
              <div className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-3 text-sm text-yellow-700">
                Limpezas destrutivas, como remover cores extras, tamanhos extras ou arquivar produtos, só rodam quando o limite de produtos está vazio.
              </div>
            ) : null}

            <ColorTermsReport data={colorTermsResult} running={loading("Prévia de cores") || loading("Sincronizar cores")} />
            <MigrationReport data={migrationResult} running={loading("Comparar catálogo") || loading("Enviar produtos")} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status por lista</CardTitle>
            <CardDescription>
              Cole os códigos que devem ficar ativos na UP Zero. Produtos fora da lista serão marcados como inativos.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="activeStatusCodes">Códigos ativos</Label>
              <textarea
                id="activeStatusCodes"
                value={activeStatusCodes}
                onChange={(e) => setActiveStatusCodes(e.target.value)}
                placeholder="Um código por linha, ou separados por vírgula/espaço"
                className="min-h-[180px] rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ActionButton
                onClick={previewProductStatuses}
                loading={loading("Prévia status produtos")}
                variant="outline"
                icon={<Eye className="size-4" />}
              >
                Prévia Status
              </ActionButton>
              <ActionButton
                onClick={applyProductStatuses}
                loading={loading("Aplicar status produtos")}
                variant="secondary"
                icon={<DatabaseZap className="size-4" />}
              >
                Aplicar Status
              </ActionButton>
              {statusSyncResult ? (
                <JsonViewer
                  title="Resultado do status por lista"
                  data={statusSyncResult}
                  triggerLabel="Ver status"
                  variant="outline"
                />
              ) : null}
            </div>
            <BulkStatusReport data={statusSyncResult} />
          </CardContent>
        </Card>

        {/* Ações */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ações</CardTitle>
            <CardDescription>Teste conexões, busque dados e envie itens de teste.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Conexão
              </p>
              <div className="flex flex-wrap gap-2">
                <ActionButton onClick={testVesti} loading={loading("Testar conexão Vesti")} icon={<Plug className="size-4" />}>
                  Testar conexão Vesti
                </ActionButton>
                <ActionButton onClick={testUpzero} loading={loading("Testar conexão UP Zero")} icon={<Plug className="size-4" />}>
                  Testar conexão UP Zero
                </ActionButton>
              </div>
            </div>

            <Separator />

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Buscar na Vesti
              </p>
              <div className="flex flex-wrap gap-2">
                <ActionButton onClick={fetchCategories} loading={loading("Buscar categorias da Vesti")} icon={<FolderTree className="size-4" />}>
                  Buscar categorias
                </ActionButton>
                <ActionButton onClick={fetchProducts} loading={loading("Buscar produtos da Vesti")} icon={<Package className="size-4" />}>
                  Buscar produtos
                </ActionButton>
                <ActionButton onClick={viewFirstProduct} variant="outline" icon={<Eye className="size-4" />}>
                  Ver 1º produto
                </ActionButton>
                <ActionButton onClick={viewFirstCategory} variant="outline" icon={<Eye className="size-4" />}>
                  Ver 1ª categoria
                </ActionButton>
              </div>
            </div>

            <Separator />

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Enviar para UP Zero
              </p>
              <div className="flex flex-wrap gap-2">
                <ActionButton onClick={sendTestCategory} loading={loading("Enviar categoria de teste")} variant="secondary" icon={<FolderTree className="size-4" />}>
                  Enviar categoria de teste
                </ActionButton>
                <ActionButton onClick={sendTestProduct} loading={loading("Enviar produto de teste")} variant="secondary" icon={<Package className="size-4" />}>
                  Enviar produto de teste
                </ActionButton>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Preview */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Preview & sincronização</CardTitle>
            <CardDescription>
              Dados mapeados para o formato da UP Zero. Campos ausentes aparecem como{" "}
              <span className="font-mono">null</span>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="products">
              <TabsList>
                <TabsTrigger value="products">
                  Produtos <Badge variant="secondary" className="ml-1.5">{products.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="categories">
                  Categorias <Badge variant="secondary" className="ml-1.5">{categories.length}</Badge>
                </TabsTrigger>
              </TabsList>
              <TabsContent value="products" className="mt-4">
                <PreviewTable kind="product" items={products} sendingId={sendingId} onSend={sendProduct} />
              </TabsContent>
              <TabsContent value="categories" className="mt-4">
                <PreviewTable kind="category" items={categories} sendingId={sendingId} onSend={sendCategory} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      {/* Coluna de logs */}
      <div className="lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)]">
        <Card className="flex h-full max-h-[80vh] flex-col overflow-hidden p-0 lg:max-h-none">
          <LogPanel logs={logs} onClear={() => setLogs([])} />
        </Card>
      </div>

      {/* Visualizador de "primeiro item" */}
      <Dialog open={viewer !== null} onOpenChange={(open) => !open && setViewer(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{viewer?.title}</DialogTitle>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-4 font-mono text-xs leading-relaxed">
            {viewer
              ? typeof viewer.data === "string"
                ? viewer.data
                : JSON.stringify(viewer.data, null, 2)
              : ""}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function extractArray(data: unknown): any[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>
    for (const key of ["data", "items", "results", "products", "categories", "content"]) {
      if (Array.isArray(obj[key])) return obj[key] as any[]
    }
  }
  return []
}

function mergeMigrationProgress(current: unknown, event: any) {
  const currentReport =
    current && typeof current === "object"
      ? (current as Record<string, any>)
      : { ok: true, stats: {}, processedProducts: [] }
  const products = Array.isArray(currentReport.processedProducts)
    ? [...currentReport.processedProducts]
    : []

  if (event.product) {
    const code = String(event.product.code ?? "")
    const index = products.findIndex((product) => String(product.code ?? "") === code)
    if (index >= 0) products[index] = event.product
    else products.push(event.product)
  }

  return {
    ...currentReport,
    ok: currentReport.ok !== false,
    streaming: event.type !== "done" && event.type !== "fatal_error",
    stats: event.stats ?? currentReport.stats ?? {},
    processedProducts: products,
    progress: event,
  }
}

function mergeColorTermsProgress(current: unknown, event: any) {
  const currentReport =
    current && typeof current === "object"
      ? (current as Record<string, any>)
      : { ok: true, stats: {}, colorTerms: [] }
  const terms = Array.isArray(currentReport.colorTerms) ? [...currentReport.colorTerms] : []

  if (event.term) {
    const key = `${event.term.action}:${event.term.code}:${event.term.upzeroTermId ?? ""}`
    const index = terms.findIndex((term) => `${term.action}:${term.code}:${term.upzeroTermId ?? ""}` === key)
    if (index >= 0) terms[index] = event.term
    else terms.push(event.term)
  }

  return {
    ...currentReport,
    ok: currentReport.ok !== false,
    streaming: event.type !== "done" && event.type !== "fatal_error",
    stats: event.stats ?? currentReport.stats ?? {},
    colorTerms: terms,
    progress: event,
  }
}

function BulkStatusReport({ data }: { data: unknown }) {
  if (!data || typeof data !== "object") return null
  const report = data as any
  const summary = report.summary ?? {}
  const unmatched = Array.isArray(summary.unmatchedActiveCodes) ? summary.unmatchedActiveCodes : []
  const rows = Array.isArray(report.rows) ? report.rows : []
  const changedRows = rows.filter((row: any) => row.action === "updated" || row.action === "would_update")

  return (
    <div className="grid gap-4 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Resultado do status por lista</h3>
          <p className="text-xs text-muted-foreground">
            {report.dryRun ? "Prévia sem alteração na UP Zero." : "Alteração aplicada na UP Zero."}
          </p>
        </div>
        <Badge variant={report.ok ? "default" : "destructive"}>
          {report.ok ? "OK" : "Verificar"}
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Produtos UP Zero" value={String(summary.totalUpzeroProducts ?? 0)} />
        <Metric label="Ativos alvo" value={String(summary.targetActive ?? 0)} tone="ok" />
        <Metric label="Inativos alvo" value={String(summary.targetInactive ?? 0)} />
        <Metric
          label={report.dryRun ? "Alterariam" : "Atualizados"}
          value={String(report.dryRun ? summary.wouldUpdate ?? 0 : summary.updated ?? 0)}
          tone="warn"
        />
      </div>

      {unmatched.length ? (
        <div className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-3 text-sm">
          <div className="font-medium text-yellow-700">Códigos da lista não encontrados na UP Zero</div>
          <div className="mt-1 max-h-24 overflow-auto font-mono text-xs text-muted-foreground">
            {unmatched.join(", ")}
          </div>
        </div>
      ) : null}

      {changedRows.length ? (
        <div className="max-h-72 overflow-auto rounded-md border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="sticky top-0 border-b border-border bg-background text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Código</th>
                <th className="px-3 py-2 font-medium">Produto</th>
                <th className="px-3 py-2 font-medium">Atual</th>
                <th className="px-3 py-2 font-medium">Alvo</th>
                <th className="px-3 py-2 font-medium">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {changedRows.slice(0, 80).map((row: any, index: number) => (
                <tr key={`${row.code}-${index}`}>
                  <td className="px-3 py-2 font-mono text-xs">{row.code}</td>
                  <td className="px-3 py-2">{row.name || "-"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{row.currentStatus}</td>
                  <td className="px-3 py-2 font-mono text-xs">{row.targetStatus}</td>
                  <td className="px-3 py-2">
                    <Badge variant={row.action === "error" ? "destructive" : "secondary"}>{row.action}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

function ColorTermsReport({ data, running }: { data: unknown; running: boolean }) {
  const report = data && typeof data === "object" ? (data as any) : null
  if (!report) return null

  const stats = report.stats ?? {}
  const terms = Array.isArray(report.colorTerms) ? report.colorTerms : []
  const progress = report.progress ?? {}
  const total = Number(progress.total ?? terms.length ?? 0)
  const processed = Number(progress.processed ?? terms.length ?? 0)
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0
  const failed = terms.filter((term: any) => term.action === "error").length
  const errors = Array.isArray(stats.errors) ? stats.errors : []
  const warnings = Array.isArray(stats.warnings) ? stats.warnings : []
  const visibleTerms = [
    ...terms.filter((term: any) => term.action === "error"),
    ...terms.filter((term: any) => term.action !== "error").slice(-80),
  ].slice(0, 100)

  return (
    <div className="grid gap-4 rounded-md border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            {running || report.streaming ? <Loader2 className="size-4 animate-spin text-primary" /> : <CheckCircle2 className="size-4 text-primary" />}
            Sincronização de cores
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {colorProgressTitle(progress.type)}
          </p>
        </div>
        <Badge variant={failed ? "destructive" : "secondary"}>{processed}/{total || "?"}</Badge>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-background">
        <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${percent}%` }} />
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Cores Vesti" value={String(stats.vestiColorsCanonical ?? 0)} />
        <Metric label="Criar/atualizar" value={String((stats.upzeroColorsWouldUpsert ?? 0) + (stats.upzeroColorsUpserted ?? 0) + (stats.upzeroColorsWouldReplace ?? 0) + (stats.upzeroColorsReplaced ?? 0))} />
        <Metric label="Remover extras" value={String((stats.upzeroColorsWouldDelete ?? 0) + (stats.upzeroColorsDeleted ?? 0))} />
        <Metric label="Erros" value={String(failed || errors.length || 0)} tone={failed || errors.length ? "error" : "ok"} />
      </div>

      {errors.length ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <div className="font-medium text-destructive">Pendências encontradas</div>
          <div className="mt-2 grid gap-2">
            {errors.slice(0, 5).map((error: any, index: number) => (
              <div key={`${error.step ?? "erro"}-${index}`} className="text-xs text-muted-foreground">
                <span className="font-mono text-foreground">{error.step ?? "erro"}</span>
                {" · "}
                {error.message ?? "Falha sem mensagem."}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {warnings.length ? (
        <div className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-3 text-sm">
          <div className="font-medium text-yellow-700">Avisos</div>
          <div className="mt-2 grid gap-2">
            {warnings.slice(0, 5).map((warning: any, index: number) => (
              <div key={`${warning.step ?? "aviso"}-${index}`} className="text-xs text-muted-foreground">
                <span className="font-mono text-foreground">{warning.step ?? "aviso"}</span>
                {" · "}
                {warning.message ?? "Aviso sem mensagem."}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {terms.length ? (
        <div className="max-h-[260px] overflow-auto rounded-md border border-border">
          <table className="w-full min-w-[840px] text-sm">
            <thead className="sticky top-0 border-b border-border bg-background text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Cor</th>
                <th className="px-3 py-2 font-medium">Código</th>
                <th className="px-3 py-2 font-medium">RGB</th>
                <th className="px-3 py-2 font-medium">Ação</th>
                <th className="px-3 py-2 font-medium">Detalhe</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleTerms.map((term: any, index: number) => (
                <tr key={`${term.action}-${term.code}-${term.upzeroTermId ?? index}`}>
                  <td className="px-3 py-2">{term.name || "-"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{term.code || "-"}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {term.rgb ? <span className="size-4 rounded-full border border-border" style={{ backgroundColor: term.rgb }} /> : null}
                      <span className="font-mono text-xs">{term.rgb || "-"}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={term.action === "error" ? "destructive" : term.action === "blocked_in_use" || term.action?.includes("delete") ? "outline" : "secondary"}>
                      {colorActionLabel(term.action)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    <span className="line-clamp-2">{term.error || "-"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

function MigrationReport({ data, running }: { data: unknown; running: boolean }) {
  const report = data && typeof data === "object" ? (data as any) : null
  const products = Array.isArray(report?.processedProducts) ? report.processedProducts : []
  const stats = report?.stats ?? {}
  const apiErrors = Array.isArray(stats.errors) ? stats.errors : []
  const color = report?.colorTermChecks ?? null
  const progress = report?.progress ?? null
  const failed = products.filter((product: any) => rowState(product) === "error")
  const warnings = products.filter((product: any) => rowState(product) === "warning")
  const breakdown = failureBreakdown(products)
  const ok = Boolean(report?.ok) && failed.length === 0

  if (!report) {
    return running ? (
      <div className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        Sincronização em andamento. O relatório visual aparecerá aqui ao finalizar.
      </div>
    ) : null
  }

  return (
    <div className="grid gap-4">
      {progress ? <MigrationProgressPanel progress={progress} products={products} running={running || report?.streaming} /> : null}

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Resultado" value={ok ? "OK" : "Falha"} tone={ok ? "ok" : "error"} />
        <Metric label="Produtos" value={String(stats.uniqueProducts ?? products.length ?? 0)} />
        <Metric label="Atualizados/criados" value={`${stats.upzeroProductsUpdated ?? 0}/${stats.upzeroProductsCreated ?? 0}`} />
        <Metric label="Erros/avisos" value={`${failed.length}/${warnings.length}`} tone={failed.length ? "error" : warnings.length ? "warn" : "ok"} />
        <Metric label="Variações" value={`${stats.upzeroVariantsCreated ?? 0}/${stats.upzeroVariantsUpdated ?? 0}`} />
        <Metric label="Estoque" value={`${stats.upzeroInventoryItems ?? 0} itens`} />
        <Metric label="Imagens novas" value={`${stats.upzeroImagesCreated ?? 0} upload`} />
        <Metric label="Vídeos novos" value={`${stats.upzeroVideosCreated ?? 0} links`} />
        <Metric label="RGB cores" value={`${stats.upzeroColorTermRgbUpdated ?? 0} updates`} />
        <Metric label="Termos removidos" value={String(stats.upzeroExtraAttributeTermsDeleted ?? 0)} />
        <Metric label="Produtos arquivados" value={String(stats.upzeroExtraProductsArchived ?? 0)} />
      </div>

      {color ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/20 p-3 text-sm">
          <span className="font-medium">Bolinhas de cor</span>
          <StatusPill ok={(color.mismatches ?? 0) === 0} label={`${color.matches ?? 0}/${color.checked ?? 0} conferidas`} />
          {(color.mismatches ?? 0) > 0 ? (
            <Badge variant="destructive">{color.mismatches} divergências</Badge>
          ) : null}
          {(color.missingRgbInVesti ?? 0) > 0 ? (
            <Badge variant="outline">{color.missingRgbInVesti} sem RGB na Vesti</Badge>
          ) : null}
        </div>
      ) : null}

      {breakdown.length ? (
        <div className="rounded-md border border-border bg-muted/20 p-3">
          <div className="mb-2 text-sm font-medium">Diagnóstico das divergências</div>
          <div className="flex flex-wrap gap-2">
            {breakdown.map((item) => (
              <Badge key={item.label} variant={item.tone === "error" ? "destructive" : "outline"}>
                {item.label}: {item.count}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      {apiErrors.length ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <div className="font-medium text-destructive">Erros reais de API</div>
          <div className="mt-2 grid gap-2">
            {apiErrors.slice(0, 8).map((error: any, index: number) => (
              <div key={`${error.step ?? "erro"}-${index}`} className="text-xs text-muted-foreground">
                <span className="font-mono text-foreground">{error.step ?? "erro"}</span>
                {" · "}
                {error.message ?? "Falha sem mensagem."}
                {error.context ? (
                  <pre className="mt-1 max-h-24 overflow-auto rounded border border-border bg-background p-2 text-[11px]">
                    {JSON.stringify(error.context, null, 2)}
                  </pre>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {failed.length ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <div className="font-medium text-destructive">Produtos com falha</div>
          <div className="mt-2 grid gap-2">
            {failed.slice(0, 12).map((product: any, index: number) => (
              <div key={`${product.code ?? "produto"}-${index}`} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-foreground">{product.vesti?.name ?? "Produto sem nome"}</span>
                <span className="font-mono text-muted-foreground">{product.code ?? "-"}</span>
                {product.upzeroProductId ? <span className="text-muted-foreground">UP {product.upzeroProductId}</span> : null}
                <span className="text-muted-foreground">{product.error || issueSummary(product.checks)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {products.length ? (
        <div className="overflow-hidden rounded-md border border-border">
          <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-3 py-2">
            <div>
              <h3 className="text-sm font-semibold">Produtos processados</h3>
              <p className="text-xs text-muted-foreground">
                Comparativo Vesti / UP Zero por produto.
              </p>
            </div>
            <Badge variant={failed.length ? "destructive" : warnings.length ? "outline" : "default"}>
              {products.length} produtos
            </Badge>
          </div>
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full min-w-[1120px] text-sm">
              <thead className="sticky top-0 z-10 border-b border-border bg-background text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Produto</th>
                  <th className="px-3 py-2 font-medium">Ação</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Estoque Vesti/UP</th>
                  <th className="px-3 py-2 font-medium">Variantes Vesti/UP</th>
                  <th className="px-3 py-2 font-medium">Categorias Vesti/API/Admin</th>
                  <th className="px-3 py-2 font-medium">Fotos Vesti/UP</th>
                  <th className="px-3 py-2 font-medium">Cor/Tamanho</th>
                  <th className="px-3 py-2 font-medium">Detalhe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {products.map((product: any, index: number) => (
                  <MigrationProductRow key={`${product.code ?? "produto"}-${index}`} product={product} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function MigrationProgressPanel({
  progress,
  products,
  running,
}: {
  progress: any
  products: any[]
  running: boolean
}) {
  const total = Number(progress?.total ?? 0)
  const processed = Number(progress?.processed ?? products.length ?? 0)
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0
  const currentName = progress?.productName || progress?.productCode || "Preparando catálogo"
  const done = progress?.type === "done"
  const failed = products.filter((product) => rowState(product) === "error").length
  const finishedOk = products.filter((product) => rowState(product) === "ok").length
  const warnings = products.filter((product) => rowState(product) === "warning").length

  return (
    <div className="rounded-md border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            {running && !done ? <Loader2 className="size-4 animate-spin text-primary" /> : <CheckCircle2 className="size-4 text-primary" />}
            {done ? "Sincronização finalizada" : progressTitle(progress?.type)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Produto atual: <span className="font-mono">{currentName}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{processed}/{total || "?"} produtos</Badge>
          <Badge variant={failed ? "destructive" : "default"}>{failed} falhas</Badge>
          <Badge variant="outline">{warnings} avisos</Badge>
          <Badge variant="outline">{finishedOk} OK</Badge>
        </div>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-background">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <span>{percent}% concluído</span>
        <span>Tempo decorrido: {formatDuration(progress?.elapsedMs)}</span>
        <span>Previsão restante: {formatDuration(progress?.estimatedRemainingMs)}</span>
      </div>
    </div>
  )
}

function MigrationProductRow({ product }: { product: any }) {
  const state = rowState(product)
  const checks = product.checks ?? {}
  const vesti = product.vesti ?? {}
  const upzero = product.upzero ?? {}
  const detail = product.error || issueSummary(checks)
  const upzeroExternalCategoryCount = Array.isArray(upzero.categoryIds) ? upzero.categoryIds.length : 0
  const upzeroAdminCategoryCount = Array.isArray(upzero.productCategoryIds) ? upzero.productCategoryIds.length : 0

  return (
    <tr className={state === "error" ? "bg-destructive/5" : state === "warning" ? "bg-muted/30" : "hover:bg-muted/20"}>
      <td className="px-3 py-2">
        <div className="font-medium">{vesti.name || "Produto sem nome"}</div>
        <div className="font-mono text-xs text-muted-foreground">{product.code || "-"}</div>
        {product.upzeroProductId ? (
          <div className="font-mono text-xs text-muted-foreground">UP {product.upzeroProductId}</div>
        ) : null}
      </td>
      <td className="px-3 py-2">
        <Badge variant={actionVariant(product.action)}>{actionLabel(product.action)}</Badge>
      </td>
      <td className="px-3 py-2">
        <Pair left={vesti.status} right={upzero.status} ok={checks.statusMatches !== false} />
      </td>
      <td className="px-3 py-2">
        <Pair left={vesti.inventoryItems ?? 0} right={upzero.variantCount ?? 0} ok />
      </td>
      <td className="px-3 py-2">
        <Pair
          left={vesti.activeVariantCount ?? vesti.variantCount ?? 0}
          right={upzero.activeVariantCount ?? upzero.variantCount ?? 0}
          ok={checks.activeVariantCountMatches !== false}
        />
      </td>
      <td className="px-3 py-2">
        <Pair
          left={Array.isArray(vesti.categoryIds) ? vesti.categoryIds.length : 0}
          right={`${upzeroExternalCategoryCount}/${upzeroAdminCategoryCount}`}
          ok={checks.categoryCountMatches !== false}
        />
      </td>
      <td className="px-3 py-2">
        <Pair
          left={vesti.imageCount ?? 0}
          right={upzero.imageCount ?? 0}
          ok={checks.imageCountAtLeastVesti !== false}
        />
      </td>
      <td className="px-3 py-2">
        <StatusPill
          ok={!hasRealAttributeMismatch(checks)}
          label={hasRealAttributeMismatch(checks) ? "Aviso" : "OK"}
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          {stateIcon(state)}
          <span className="max-w-[260px] truncate text-xs text-muted-foreground" title={detail}>
            {detail}
          </span>
          <JsonViewer
            title={`Produto ${product.code ?? ""}`}
            data={product}
            triggerLabel="JSON"
            variant="ghost"
          />
        </div>
      </td>
    </tr>
  )
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string
  value: string
  tone?: "neutral" | "ok" | "warn" | "error"
}) {
  const toneClass =
    tone === "ok"
      ? "border-primary/30 bg-primary/5"
      : tone === "warn"
        ? "border-yellow-500/40 bg-yellow-500/5"
        : tone === "error"
          ? "border-destructive/40 bg-destructive/5"
          : "border-border bg-muted/20"

  return (
    <div className={`rounded-md border p-3 ${toneClass}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  )
}

function Pair({ left, right, ok }: { left: unknown; right: unknown; ok: boolean }) {
  return (
    <div className="flex items-center gap-2 font-mono text-xs">
      <span>{String(left ?? "-")}</span>
      <span className="text-muted-foreground">/</span>
      <span>{String(right ?? "-")}</span>
      {ok ? <CheckCircle2 className="size-3.5 text-primary" /> : <AlertTriangle className="size-3.5 text-destructive" />}
    </div>
  )
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge variant={ok ? "default" : "destructive"} className="gap-1">
      {ok ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" />}
      {label}
    </Badge>
  )
}

function rowState(product: any): "ok" | "warning" | "error" {
  if (product?.action === "error" || product?.error) return "error"
  const checks = product?.checks
  if (!checks) return "warning"
  const criticalOk =
    checks.nameMatches !== false &&
    checks.descriptionMatches !== false &&
    checks.statusMatches !== false &&
    checks.categoryCountMatches !== false &&
    checks.activeSkusNormalizedMatch !== false &&
    checks.activeVariantCountMatches !== false &&
    checks.imageCountAtLeastVesti !== false

  if (!criticalOk) return "error"
  if (checks.activeSkusMatch === false || hasRealAttributeMismatch(checks) || checks.imageCountMatches === false) return "warning"
  return "ok"
}

function stateIcon(state: "ok" | "warning" | "error") {
  if (state === "ok") return <CheckCircle2 className="size-4 shrink-0 text-primary" />
  if (state === "warning") return <AlertTriangle className="size-4 shrink-0 text-yellow-600" />
  return <XCircle className="size-4 shrink-0 text-destructive" />
}

function issueSummary(checks: any) {
  if (!checks) return "Sem checks"
  const issues: string[] = []
  if (checks.nameMatches === false) issues.push("nome")
  if (checks.descriptionMatches === false) issues.push("descrição")
  if (checks.statusMatches === false) issues.push("status")
  if (checks.categoryCountMatches === false) issues.push("categorias do Admin")
  if (checks.activeSkusMatch === false) {
    issues.push(checks.activeSkusNormalizedMatch === false ? "SKUs" : "SKUs com formatação diferente")
  }
  if (checks.activeVariantCountMatches === false) issues.push("variantes")
  if (hasRealAttributeMismatch(checks)) issues.push("cor/tamanho")
  if (checks.imageCountMatches === false && checks.imageCountAtLeastVesti !== false) issues.push("fotos extras")
  if (checks.imageCountAtLeastVesti === false) issues.push("fotos faltando")
  if (!issues.length) return "Tudo certo"

  const details: string[] = []
  const missingSkus = Array.isArray(checks.missingActiveSkus) ? checks.missingActiveSkus : []
  const extraSkus = Array.isArray(checks.extraActiveSkus) ? checks.extraActiveSkus : []
  const missingNormalizedSkus = Array.isArray(checks.missingActiveNormalizedSkus) ? checks.missingActiveNormalizedSkus : []
  const extraNormalizedSkus = Array.isArray(checks.extraActiveNormalizedSkus) ? checks.extraActiveNormalizedSkus : []
  const missingSignatures = Array.isArray(checks.missingActiveVariantSignatures) ? checks.missingActiveVariantSignatures : []
  const extraSignatures = Array.isArray(checks.extraActiveVariantSignatures) ? checks.extraActiveVariantSignatures : []

  if (checks.activeSkusNormalizedMatch === false) {
    if (missingNormalizedSkus.length) details.push(`${missingNormalizedSkus.length} SKU faltando`)
    if (extraNormalizedSkus.length) details.push(`${extraNormalizedSkus.length} SKU extra`)
  } else if (checks.activeSkusMatch === false) {
    details.push(`${Math.max(missingSkus.length, extraSkus.length)} SKU com maiúscula/minúscula diferente`)
  }
  if (hasRealAttributeMismatch(checks)) {
    if (missingSignatures.length) details.push(`${missingSignatures.length} cor/tamanho faltando`)
    if (extraSignatures.length) details.push(`${extraSignatures.length} cor/tamanho extra`)
  }

  return details.length ? `Verificar: ${issues.join(", ")} (${details.join("; ")})` : `Verificar: ${issues.join(", ")}`
}

function normalizedSignatureWithSkuCaseIgnored(signature: unknown) {
  const [sku = "", attrs = ""] = String(signature ?? "").split("::")
  return `${sku.trim().toLowerCase()}::${attrs}`
}

function sameNormalizedSignatureSet(left: unknown[], right: unknown[]) {
  if (left.length !== right.length) return false
  const rightSet = new Set(right.map(normalizedSignatureWithSkuCaseIgnored))
  return left.every((item) => rightSet.has(normalizedSignatureWithSkuCaseIgnored(item)))
}

function hasRealAttributeMismatch(checks: any) {
  if (checks?.activeVariantAttributesMatch !== false) return false
  const missingSignatures = Array.isArray(checks.missingActiveVariantSignatures) ? checks.missingActiveVariantSignatures : []
  const extraSignatures = Array.isArray(checks.extraActiveVariantSignatures) ? checks.extraActiveVariantSignatures : []
  if (missingSignatures.length && sameNormalizedSignatureSet(missingSignatures, extraSignatures)) return false
  return true
}

function failureBreakdown(products: any[]) {
  const counts: Record<string, { label: string; count: number; tone: "error" | "warn" }> = {
    api: { label: "Erro de API", count: 0, tone: "error" },
    status: { label: "Status", count: 0, tone: "error" },
    category: { label: "Categorias", count: 0, tone: "error" },
    sku: { label: "SKU faltando/extra", count: 0, tone: "error" },
    skuFormat: { label: "SKU maiúscula/minúscula", count: 0, tone: "warn" },
    variants: { label: "Qtde variantes", count: 0, tone: "error" },
    attributes: { label: "Cor/tamanho", count: 0, tone: "warn" },
    imagesMissing: { label: "Fotos faltando", count: 0, tone: "error" },
    imagesExtra: { label: "Fotos extras", count: 0, tone: "warn" },
    description: { label: "Descrição", count: 0, tone: "error" },
  }

  for (const product of products) {
    const checks = product?.checks
    if (product?.action === "error" || product?.error) counts.api.count += 1
    if (!checks) continue

    if (checks.statusMatches === false) counts.status.count += 1
    if (checks.categoryCountMatches === false) counts.category.count += 1
    if (checks.activeSkusMatch === false) {
      if (checks.activeSkusNormalizedMatch === false) counts.sku.count += 1
      else counts.skuFormat.count += 1
    }
    if (checks.activeVariantCountMatches === false) counts.variants.count += 1
    if (hasRealAttributeMismatch(checks)) counts.attributes.count += 1
    if (checks.imageCountAtLeastVesti === false) counts.imagesMissing.count += 1
    if (checks.imageCountMatches === false && checks.imageCountAtLeastVesti !== false) counts.imagesExtra.count += 1
    if (checks.descriptionMatches === false) counts.description.count += 1
  }

  return Object.values(counts).filter((item) => item.count > 0)
}

function progressTitle(type: string) {
  const labels: Record<string, string> = {
    catalog_started: "Iniciando sincronização",
    source_loaded: "Dados da Vesti carregados",
    products_started: "Processando produtos",
    product_started: "Atualizando produto",
    product_done: "Produto concluído",
    product_error: "Produto com falha",
    fatal_error: "Falha na sincronização",
  }
  return labels[type] ?? "Sincronizando"
}

function colorProgressTitle(type: string) {
  const labels: Record<string, string> = {
    started: "Iniciando leitura das cores",
    source_loaded: "Produtos carregados da Vesti",
    upserting: "Criando/atualizando cores canônicas",
    upserted: "Cor processada",
    pruning: "Comparando cores extras da UP Zero",
    deleted: "Cor extra processada",
    done: "Cores finalizadas",
    fatal_error: "Falha ao sincronizar cores",
  }
  return labels[type] ?? "Sincronizando cores"
}

function colorActionLabel(action: string) {
  const labels: Record<string, string> = {
    would_upsert: "Criar/atualizar",
    upserted: "Atualizada",
    would_replace: "Substituir RGB",
    replaced: "RGB substituído",
    kept: "Mantida",
    blocked_in_use: "Em uso",
    would_delete: "Remover",
    deleted: "Removida",
    error: "Erro",
  }
  return labels[action] ?? action ?? "-"
}

function formatDuration(value: unknown) {
  const ms = Number(value)
  if (!Number.isFinite(ms) || ms <= 0) return "-"
  const totalSeconds = Math.ceil(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes <= 0) return `${seconds}s`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours <= 0) return `${minutes}min ${seconds}s`
  return `${hours}h ${remainingMinutes}min`
}

function actionLabel(action: string) {
  const labels: Record<string, string> = {
    dry_run: "Simulado",
    exists: "Já existe",
    missing: "Não existe",
    created: "Criado",
    updated: "Atualizado",
    updated_after_conflict: "Atualizado",
    skipped: "Ignorado",
    error: "Erro",
  }
  return labels[action] ?? action ?? "-"
}

function actionVariant(action: string): "default" | "secondary" | "destructive" | "outline" {
  if (action === "error") return "destructive"
  if (action === "created") return "default"
  if (action === "skipped" || action === "dry_run" || action === "missing") return "outline"
  return "secondary"
}

function ConfigStatusRow({
  label,
  configured,
}: {
  label: string
  configured: boolean
}) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-sm">
      <span className="font-mono text-xs text-muted-foreground">{label}</span>
      <Badge variant={configured ? "default" : "secondary"}>
        {configured ? "Configurado" : "Pendente"}
      </Badge>
    </div>
  )
}

function EndpointField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      <Input className="font-mono text-xs" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

function CredentialField({
  label,
  value,
  secret = false,
  onChange,
}: {
  label: string
  value: string
  secret?: boolean
  onChange: (v: string) => void
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        autoComplete="off"
        className="font-mono text-xs"
        type={secret ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function ActionButton({
  onClick,
  loading,
  icon,
  children,
  variant = "default",
}: {
  onClick: () => void
  loading?: boolean
  icon?: React.ReactNode
  children: React.ReactNode
  variant?: "default" | "outline" | "secondary"
}) {
  return (
    <Button onClick={onClick} disabled={loading} variant={variant} className="gap-2">
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </Button>
  )
}
