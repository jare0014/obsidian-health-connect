import { App, Notice } from "obsidian";
import { HealthPluginSettings } from "../models/HealthTypes";

export class GoogleAuthService {
    private app: App;
    private settings: HealthPluginSettings;
    private saveSettings: () => Promise<void>;

    constructor(app: App, settings: HealthPluginSettings, saveSettings: () => Promise<void>) {
        this.app = app;
        this.settings = settings;
        this.saveSettings = saveSettings;
    }

    public getAuthUrl(): string {
        const scopes = [
            "https://www.googleapis.com/auth/fitness.sleep.read",
            "https://www.googleapis.com/auth/fitness.heart_rate.read",
            "https://www.googleapis.com/auth/fitness.nutrition.read",
            "https://www.googleapis.com/auth/fitness.nutrition.write",
            "https://www.googleapis.com/auth/fitness.hydration.read",
            "https://www.googleapis.com/auth/fitness.hydration.write",
            "https://www.googleapis.com/auth/fitness.activity.read",
            "https://www.googleapis.com/auth/fitness.activity.write"
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

    public async parseAndApplyCredentialsJson(jsonText: string): Promise<boolean> {
        try {
            const parsed = JSON.parse(jsonText);
            const client = parsed.web || parsed.installed || parsed;

            if (client.client_id) {
                this.settings.clientId = client.client_id;
            }
            if (client.client_secret) {
                this.settings.clientSecret = client.client_secret;
            }
            this.settings.rawCredentialsJson = jsonText;

            // Securely store in Obsidian Keychain / Secret Storage if available
            await this.storeSecret("health-connect-google-credentials", jsonText);
            await this.storeSecret("health-connect-google-client-secret", this.settings.clientSecret);

            await this.saveSettings();
            new Notice("Credentials JSON parsed and stored in Keychain! 🔐");
            return true;
        } catch (e) {
            new Notice("Invalid JSON format. Please paste the complete downloaded credentials.json file.");
            return false;
        }
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

            await this.storeSecret("health-connect-refresh-token", this.settings.tokens.refreshToken || "");
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
        const { tokens, clientId } = this.settings;
        if (tokens?.accessToken && tokens?.expiresAt && Date.now() < tokens.expiresAt - 60000) {
            return tokens.accessToken;
        }

        const refreshToken = tokens?.refreshToken || await this.getSecret("health-connect-refresh-token");
        const clientSecret = this.settings.clientSecret || await this.getSecret("health-connect-client-secret");
        if (!refreshToken || !clientId || !clientSecret) return null;

        try {
            const body = new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: refreshToken,
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

    public async testConnection(): Promise<{ ok: boolean; message: string }> {
        const token = await this.getValidAccessToken();
        if (!token) return { ok: false, message: "No valid token. Please connect Google Account." };

        try {
            const res = await fetch("https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=" + token);
            if (res.ok) {
                return { ok: true, message: "Connection verified! All read/write scopes active." };
            }
            return { ok: false, message: `Token validation returned status ${res.status}` };
        } catch (e) {
            return { ok: false, message: `Network error: ${e.message}` };
        }
    }

    public isConnected(): boolean {
        return !!(this.settings.tokens.accessToken || this.settings.tokens.refreshToken);
    }

    private async storeSecret(key: string, value: string): Promise<void> {
        const anyApp = this.app as any;
        if (anyApp.secretStorage && typeof anyApp.secretStorage.setSecret === 'function') {
            try {
                await anyApp.secretStorage.setSecret(key, value);
            } catch (e) {
                // Fallback to in-memory plugin settings
            }
        }
    }

    private async getSecret(key: string): Promise<string | null> {
        const anyApp = this.app as any;
        if (anyApp.secretStorage && typeof anyApp.secretStorage.getSecret === 'function') {
            try {
                return await anyApp.secretStorage.getSecret(key);
            } catch (e) {
                return null;
            }
        }
        return null;
    }
}
