import { WhatsappInboundMessage } from "../db";
import { downloadAudio } from "../services/storage";
import { downloadMediaFromTwilio } from "../services/twilio";
import { transcribeAudio } from "../services/openai";
import { updateMessageTranscribed } from "../claim";
import { log } from "../utils/logger";

export interface TranscribeResult {
  success: boolean;
  transcriptText: string | null;
  error?: string;
}

export async function processTranscribe(
  message: WhatsappInboundMessage,
  mediaBlobId: string | null
): Promise<TranscribeResult> {
  const { messageSid, mediaUrl, transcriptText: existingTranscript } = message;

  if (existingTranscript) {
    log.info("Transcript already exists, skipping", { messageSid });
    return { success: true, transcriptText: existingTranscript };
  }

  try {
    let audioBuffer: Buffer;

    if (mediaBlobId) {
      log.info("Loading audio from object storage", { messageSid, mediaBlobId });
      audioBuffer = await downloadAudio(mediaBlobId);
    } else if (mediaUrl) {
      log.info("Fallback: downloading audio from Twilio", { messageSid });
      const { buffer } = await downloadMediaFromTwilio(mediaUrl);
      audioBuffer = buffer;
    } else {
      return { success: false, transcriptText: null, error: "No audio source available" };
    }

    const transcript = await transcribeAudio(audioBuffer);

    await updateMessageTranscribed(messageSid, transcript);

    log.info("Transcribe stage complete", { messageSid, transcriptLength: transcript.length });
    return { success: true, transcriptText: transcript };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("Transcribe stage failed", { messageSid, error: errorMsg });
    return { success: false, transcriptText: null, error: errorMsg };
  }
}
