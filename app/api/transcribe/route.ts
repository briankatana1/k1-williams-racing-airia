import { NextResponse } from "next/server"
import { execSync } from "child_process"
import { writeFileSync, readFileSync, unlinkSync, mkdtempSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { WaveFile } from "wavefile"
import { getWhisperPipeline } from "./pipeline"

export const maxDuration = 60

const transcriptCache = new Map<string, string>()

export async function POST(req: Request) {
  try {
    const { url } = await req.json()

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "Missing url" }, { status: 400 })
    }

    if (!url.startsWith("https://")) {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 })
    }

    // Return cached transcript if available
    const cached = transcriptCache.get(url)
    if (cached !== undefined) {
      return NextResponse.json({ text: cached, url })
    }

    // Fetch MP3 from OpenF1
    const mp3Res = await fetch(url)
    if (!mp3Res.ok) {
      return NextResponse.json({ error: "Failed to fetch audio" }, { status: 502 })
    }
    const mp3Buf = Buffer.from(await mp3Res.arrayBuffer())

    // Convert MP3 → 16kHz mono WAV via ffmpeg
    const tmp = mkdtempSync(join(tmpdir(), "whisper-"))
    const mp3Path = join(tmp, "input.mp3")
    const wavPath = join(tmp, "output.wav")

    writeFileSync(mp3Path, mp3Buf)
    try {
      execSync(
        `ffmpeg -y -i "${mp3Path}" -ar 16000 -ac 1 -sample_fmt s16 "${wavPath}" 2>/dev/null`,
        { timeout: 15_000 },
      )
    } catch {
      return NextResponse.json(
        { error: "ffmpeg conversion failed. Is ffmpeg installed?" },
        { status: 500 },
      )
    }

    // Parse WAV → Float32Array
    const wavBuf = readFileSync(wavPath)
    const wav = new WaveFile(wavBuf)
    wav.toBitDepth("32f")
    const samples = wav.getSamples(false, Float32Array) as Float32Array

    // Cleanup temp files
    try {
      unlinkSync(mp3Path)
      unlinkSync(wavPath)
    } catch {}

    // Run Whisper
    const whisper = await getWhisperPipeline()
    const result = await whisper(samples, {
      language: "en",
      return_timestamps: false,
    })

    const text = (
      Array.isArray(result)
        ? result.map((r) => r.text ?? "").join(" ")
        : (result.text ?? "")
    ).trim()

    // Cache the result
    transcriptCache.set(url, text)

    return NextResponse.json({ text, url })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.stack ?? err.message : "Transcription failed"
    console.error("[transcribe] Error:", message)
    return NextResponse.json({ error: err instanceof Error ? err.message : "Transcription failed" }, { status: 500 })
  }
}
