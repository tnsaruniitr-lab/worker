import OpenAI from "openai";
import { config } from "../config";
import { log } from "../utils/logger";

let openaiClient: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: config.openai.apiKey });
  }
  return openaiClient;
}

export async function transcribeAudio(audioBuffer: Buffer, language: string = "en"): Promise<string> {
  const client = getOpenAIClient();

  const audioFile = new File([audioBuffer], "voice_message.ogg", {
    type: "audio/ogg",
  });

  log.info("Sending audio to OpenAI Whisper", { size: audioBuffer.length, language });

  const transcription = await client.audio.transcriptions.create({
    file: audioFile,
    model: "whisper-1",
    language,
    response_format: "text",
  });

  log.info("Transcription complete", { length: (transcription as string).length });
  return transcription as string;
}

export interface CareDocumentationAnalysis {
  patientId: string;
  patientName: string;
  serviceDate: string;
  rawContent: string;
  khCodes: string[];
  structuredData: Record<string, unknown>;
  alerts: Array<{ type: string; severity: string; description: string }>;
  originalLanguage: string;
  translations: {
    de?: string;
    en?: string;
    tr?: string;
    ar?: string;
  };
}

export async function analyzeTranscript(
  transcriptText: string,
  agencyId: string
): Promise<CareDocumentationAnalysis | null> {
  const client = getOpenAIClient();

  const systemPrompt = `You are a healthcare documentation assistant that extracts structured care information from nurse voice messages. 
Extract:
- Patient identification (name or ID)
- Date of service
- Care activities performed (use KH codes if applicable)
- Any alerts or concerns
- Detect the original language

Respond in JSON format with keys: patientId, patientName, serviceDate, khCodes, structuredData, alerts, originalLanguage`;

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: transcriptText },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    log.warn("No content in GPT response");
    return null;
  }

  try {
    const parsed = JSON.parse(content);
    return {
      patientId: parsed.patientId || "",
      patientName: parsed.patientName || "",
      serviceDate: parsed.serviceDate || new Date().toISOString().split("T")[0],
      rawContent: transcriptText,
      khCodes: parsed.khCodes || [],
      structuredData: parsed.structuredData || {},
      alerts: parsed.alerts || [],
      originalLanguage: parsed.originalLanguage || "de",
      translations: {},
    };
  } catch (err) {
    log.error("Failed to parse GPT response", { error: String(err), content });
    return null;
  }
}
