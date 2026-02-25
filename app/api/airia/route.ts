import { NextResponse } from "next/server"

const PIPELINES: Record<string, string | undefined> = {
  pit: process.env.AIRIA_PIPELINE_ID,
  chat: process.env.AIRIA_CHAT_PIPELINE_ID,
  tension: process.env.AIRIA_TENSION_PIPELINE_ID,
  telemetry: process.env.AIRIA_TELEMETRY_PIPELINE_ID,
  tyre: process.env.AIRIA_TYRE_PIPELINE_ID,
}

export async function POST(request: Request) {
  const apiKey = process.env.AIRIA_API_KEY

  if (!apiKey) {
    return NextResponse.json(
      { error: "Airia credentials not configured" },
      { status: 500 },
    )
  }

  let userInput: string | undefined
  let pipeline: string | undefined
  try {
    const body = await request.json()
    userInput = body?.userInput
    pipeline = body?.pipeline
  } catch {
    return NextResponse.json(
      { error: "Invalid or empty request body" },
      { status: 400 },
    )
  }

  if (!userInput) {
    return NextResponse.json(
      { error: "userInput is required" },
      { status: 400 },
    )
  }

  const pipelineId = PIPELINES[pipeline ?? "pit"]
  if (!pipelineId) {
    return NextResponse.json(
      { error: `Unknown pipeline: ${pipeline}` },
      { status: 400 },
    )
  }

  try {
    const res = await fetch(
      `https://prodaus.api.airia.ai/v2/PipelineExecution/${pipelineId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": apiKey,
        },
        body: JSON.stringify({ userInput, asyncOutput: false }),
      },
    )

    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json(
        { error: `Airia API error: ${res.status}`, detail: text },
        { status: res.status },
      )
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to reach Airia API" },
      { status: 502 },
    )
  }
}
