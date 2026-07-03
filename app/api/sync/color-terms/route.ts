import { type NextRequest, NextResponse } from "next/server"
import { withExternalApiConfigOverrides } from "@/lib/server-api-config"
import { runColorTermsSync, type ColorTermsSyncRequest, type ColorTermsProgress } from "@/lib/sync/color-terms-sync"

function streamColorTermsSync(body: ColorTermsSyncRequest) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      const send = (event: ColorTermsProgress | { type: "done"; report: unknown }) => {
        if (closed) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`))
      }, 15000)

      try {
        const report = await withExternalApiConfigOverrides(body.credentials, () =>
          runColorTermsSync(body, (event) => send(event)),
        )
        send({ type: "done", report })
      } catch (err) {
        send({
          type: "fatal_error",
          message: err instanceof Error ? err.message : "Falha inesperada ao sincronizar cores.",
        })
      } finally {
        closed = true
        clearInterval(heartbeat)
        controller.close()
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as ColorTermsSyncRequest
  if (body.realtime) return streamColorTermsSync(body)

  const payload = await withExternalApiConfigOverrides(body.credentials, () => runColorTermsSync(body))
  return NextResponse.json(payload)
}
