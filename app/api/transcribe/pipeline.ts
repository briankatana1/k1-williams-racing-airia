import { pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers"

declare const globalThis: { __whisperPipeline?: AutomaticSpeechRecognitionPipeline }

let pipelineInstance: AutomaticSpeechRecognitionPipeline | null =
  globalThis.__whisperPipeline ?? null

export async function getWhisperPipeline(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (pipelineInstance) return pipelineInstance

  pipelineInstance = await pipeline(
    "automatic-speech-recognition",
    "onnx-community/whisper-base",
    {
      dtype: {
        encoder_model: "fp32",
        decoder_model_merged: "q4",
      },
      device: "cpu",
    },
  )

  // Survive HMR in dev
  globalThis.__whisperPipeline = pipelineInstance
  return pipelineInstance
}
