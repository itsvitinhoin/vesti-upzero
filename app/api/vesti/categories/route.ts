import { type NextRequest, NextResponse } from "next/server"
import { proxyFetch } from "@/lib/proxy"
import { DEFAULT_ENDPOINTS } from "@/lib/api-config"
import { getExternalApiConfig, withExternalApiConfigOverrides } from "@/lib/server-api-config"

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const result = await withExternalApiConfigOverrides(body.credentials, async () => {
    const config = getExternalApiConfig("vesti")
    return proxyFetch({
      ...config,
      endpoint: body.endpoint ?? DEFAULT_ENDPOINTS.vesti.categories,
      method: "GET",
    })
  })
  return NextResponse.json(result)
}
