import { type NextRequest, NextResponse } from "next/server"
import { proxyFetch } from "@/lib/proxy"
import { DEFAULT_ENDPOINTS } from "@/lib/api-config"
import { getExternalApiConfig, withExternalApiConfigOverrides } from "@/lib/server-api-config"
import { mapVestiProductToUpzero } from "@/lib/mappers/vesti-to-upzero"

// Recebe um produto bruto da Vesti + credenciais da UP Zero,
// faz o mapeamento e cria o produto na UP Zero.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))

  if (!body.product || typeof body.product !== "object") {
    return NextResponse.json(
      {
        ok: false,
        status: 0,
        statusText: "",
        url: "",
        durationMs: 0,
        responseHeaders: {},
        data: null,
        error: "Nenhum produto da Vesti foi informado para sincronizar.",
      },
      { status: 200 },
    )
  }

  const mapped = mapVestiProductToUpzero(body.product)
  const result = await withExternalApiConfigOverrides(body.credentials, async () => {
    const config = getExternalApiConfig("upzero")
    return proxyFetch({
      ...config,
      endpoint: body.upzero?.endpoint ?? DEFAULT_ENDPOINTS.upzero.products,
      method: "POST",
      body: mapped,
    })
  })

  return NextResponse.json({ ...result, mappedPayload: mapped })
}
