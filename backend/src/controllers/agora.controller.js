import pkg from "agora-access-token";

const { RtcTokenBuilder, RtcRole } = pkg;

export const generateAgoraToken = (req, res) => {
    try {
        const { channelName } = req.body;

        if (!channelName) {
            return res.status(400).json({ message: "Channel name is required" });
        }

        const appId = process.env.AGORA_APP_ID;
        const appCertificate = process.env.AGORA_APP_CERTIFICATE;

        if (!appId || !appCertificate) {
            return res.status(500).json({
                message: "Agora credentials are missing in .env",
            });
        }

        const uid = 0; // IMPORTANT: must match frontend join(uid = null)

        const role = RtcRole.PUBLISHER;

        const expirationTimeInSeconds = 3600; // 1 hour
        const currentTimestamp = Math.floor(Date.now() / 1000);
        const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

        const token = RtcTokenBuilder.buildTokenWithUid(
            appId,
            appCertificate,
            channelName,
            uid,
            role,
            privilegeExpiredTs
        );

        res.status(200).json({
            success: true,
            token,
        });
    } catch (error) {
        res.status(500).json({
            message: "Failed to generate Agora token",
            error: error.message,
        });
    }
};
