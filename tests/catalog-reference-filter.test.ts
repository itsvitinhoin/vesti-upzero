import assert from "node:assert/strict"
import { test } from "node:test"
import { runCatalogSync } from "../lib/sync/catalog-sync"
import { withExternalApiConfigOverrides } from "../lib/server-api-config"

test("does not write to UP Zero when none of the requested references exist", async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ url: string; method: string }> = []

  globalThis.fetch = async (input, init) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    requests.push({ url, method })
    const data = url.includes("/v1/categories/")
      ? { response: [] }
      : { response: [{ id: "vesti-1", code: "OUTRA" }], links: { next: null } }
    return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } })
  }

  try {
    const report = await withExternalApiConfigOverrides({
      requireExplicitCredentials: true,
      vestiApiBaseUrl: "https://vesti.test/api",
      vestiCompanyId: "test-company",
      vestiApiToken: "test-token",
      upzeroApiBaseUrl: "https://upzero.test",
      upzeroApiToken: "test-token",
    }, () => runCatalogSync({
      dryRun: false,
      productReferences: ["00123"],
      startDate: "2026-09-16",
      endDate: "2026-09-16",
      maxProducts: 1,
      archiveExtraProducts: true,
      pruneExtraAttributeTerms: true,
    }))

    assert.equal(report.ok, false)
    assert.deepEqual(report.filters.missingReferences, ["00123"])
    assert.equal(report.stats.uniqueProducts, 0)
    assert.ok(requests.every(({ method }) => method === "GET"))
    assert.ok(requests.every(({ url }) => url.startsWith("https://vesti.test/")))
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("rejects an explicit empty reference filter before any API call", async () => {
  await assert.rejects(runCatalogSync({ productReferences: [] }), /pelo menos uma referência válida/)
})
