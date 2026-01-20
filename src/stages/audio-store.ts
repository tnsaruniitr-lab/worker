import { WhatsappInboundMessage } from "../db";
import { downloadMediaFromTwilio } from "../services/twilio";
import { uploadAudio, checkAudioExists, getDeterministicAudioKey } from "../services/storage";
import { updateMessageAudioStored } from "../claim";
import { log } from "../utils/logger";

export interface AudioStoreResult {
  success: boolean;
  mediaBlobId: string | null;
  error?: string;
}

export async function processAudioStore(message: WhatsappInboundMessage): Promise<AudioStoreResult> {
  const { messageSid, mediaUrl, mediaBlobId, agencyId } = message;

  if (mediaBlobId) {
    log.info("Audio already stored, skipping", { messageSid, mediaBlobId });
    return { success: true, mediaBlobId };
  }

  if (!mediaUrl) {
    log.warn("No media URL available", { messageSid });
    return { success: false, mediaBlobId: null, error: "No media URL" };
  }

  try {
    const { buffer, contentType } = await downloadMediaFromTwilio(mediaUrl);

    const objectKey = await uploadAudio(buffer, agencyId, messageSid, contentType);

    await updateMessageAudioStored(messageSid, objectKey);

    log.info("Audio store stage complete", { messageSid, objectKey });
    return { success: true, mediaBlobId: objectKey };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("Audio store stage failed", { messageSid, error: errorMsg });
    return { success: false, mediaBlobId: null, error: errorMsg };
  }
}
