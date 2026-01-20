import { config } from "../config";
import { log } from "../utils/logger";

export async function downloadMediaFromTwilio(mediaUrl: string): Promise<{ buffer: Buffer; contentType: string }> {
  const authHeader = `Basic ${Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString("base64")}`;

  log.info("Downloading media from Twilio", { mediaUrl: mediaUrl.substring(0, 50) + "..." });

  const response = await fetch(mediaUrl, {
    headers: { Authorization: authHeader },
  });

  if (!response.ok) {
    throw new Error(`Twilio download failed: HTTP ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "audio/ogg";
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  log.info("Media downloaded from Twilio", { size: buffer.length, contentType });
  return { buffer, contentType };
}
