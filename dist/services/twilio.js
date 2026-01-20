"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadMediaFromTwilio = downloadMediaFromTwilio;
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
async function downloadMediaFromTwilio(mediaUrl) {
    const authHeader = `Basic ${Buffer.from(`${config_1.config.twilio.accountSid}:${config_1.config.twilio.authToken}`).toString("base64")}`;
    logger_1.log.info("Downloading media from Twilio", { mediaUrl: mediaUrl.substring(0, 50) + "..." });
    const response = await fetch(mediaUrl, {
        headers: { Authorization: authHeader },
    });
    if (!response.ok) {
        throw new Error(`Twilio download failed: HTTP ${response.status} ${response.statusText}`);
    }
    const contentType = response.headers.get("content-type") || "audio/ogg";
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    logger_1.log.info("Media downloaded from Twilio", { size: buffer.length, contentType });
    return { buffer, contentType };
}
//# sourceMappingURL=twilio.js.map