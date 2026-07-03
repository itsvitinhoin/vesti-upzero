import { NextResponse } from "next/server"

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "api-vesti-up-zero",
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  })
}
