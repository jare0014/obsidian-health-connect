import { Notice } from "obsidian";
import { HealthPluginSettings } from "../models/HealthTypes";

export class GoogleAuthService {
    private settings: HealthPluginSettings;
    private saveSettings: () => Promise<void>;

    constructor(settings: HealthPluginSettings, saveSettings: () => Promise<void>) {
        this.settings = settings;
        this.saveSettings = saveSettings;
    }

    public getAuthUrl(): string {
        const scopes = [
            "https://www.googleapis.com/auth/fitness.sleep.read",
            "https://www.googleapis.com/auth/fitness.heart_rate.read",
            "https://www.googleapis.com/auth/fitness.nutrition.read",
            "https://www.googleapis.com/auth/fitness.hydration.read",
            "https://www.googleapis.com/auth/fitness.activity.read"
        ].join(" ");

        const params = new URLSearchParams({
            client_id: this.settings.clientId,
            redirect_uri: this.settings.redirectUri,
            response_type: "code",
            scope: scopes,
            access_type: "offline",
            prompt: "consent"
        });

        return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }

    public async exchangeAuthCode(authCode: string): Promise<boolean> {
        try {
            const body = new URLSearchParams({
                code: authCode.trim(),
                client_id: this.settings.clientId,
                client_secret: this.settings.clientSecret,
                redirect_uri: this.settings.redirectUri,
                grant_type: "authorization_code"
            });

            const res = await fetch("https://oauth2.googleapis.com/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: body.toString()
            });

            if (!res.ok) {
                const err = await res.text();
                console.error("Token exchange error:", err);
                new Notice("Failed to authenticate with Google Health. Check your credentials.");
                return false;
            }

            const data = await res.json();
            this.settings.tokens = {
                accessToken: data.access_token,
                refreshToken: data.refresh_token || this.settings.tokens.refreshToken,
                expiresAt: Date.now() + (data.expires_in * 1000)
            };

            await this.saveSettings();
            new Notice("Google Health Connected Successfully! 🟢");
            return true;
        } catch (e) {
            console.error("Google Auth error:", e);
            new Notice("Network error during Google OAuth.");
            return false;
        }
    }

    public async getValidAccessToken(): Promise<string | null> {
        const { tokens, clientId, clientSecret } = this.settings;
        if (!tokens.accessToken) return null;

        if (tokens.expiresAt && Date.now() < tokens.expiresAt - 60000) {
            return tokens.accessToken;
        }

        if (!tokens.refreshToken) return null;

        try {
            const body = new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: tokens.refreshToken,
                grant_type: "refresh_token"
            });

            const res = await fetch("https://oauth2.googleapis.com/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: body.toString()
            });

            if (!res.ok) {
                return null;
            }

            const data = await res.json();
            this.settings.tokens.accessToken = data.access_token;
            this.settings.tokens.expiresAt = Date.now() + (data.expires_in * 1000);
            await this.saveSettings();
            return data.access_token;
        } catch (e) {
            console.error("Refresh token error:", e);
            return null;
        }
    }

    public isConnected(): boolean {
        return !!(this.settings.tokens.accessToken || this.settings.tokens.refreshToken);
    }
}
