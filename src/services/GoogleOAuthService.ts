import { App, Notice } from "obsidian";
import * as http from "http";
import * as url from "url";
import { HealthPluginSettings } from "../models/HealthSettings";

export class GoogleOAuthService {
    private app: App;
    private settings: HealthPluginSettings;
    private saveSettings: () => Promise<void>;
    private activeServer: http.Server | null = null;

    constructor(app: App, settings: HealthPluginSettings, saveSettings: () => Promise<void>) {
        this.app = app;
        this.settings = settings;
        this.saveSettings = saveSettings;
    }

    public async getAccessToken(): Promise<string> {
        const { tokens } = this.settings;
        if (tokens?.accessToken && tokens?.expiresAt && Date.now() < tokens.expiresAt - 60000) {
            return tokens.accessToken;
        }

        const refreshToken = tokens?.refreshToken || await this.getSecret("health-connect-refresh-token");
        const clientSecret = this.settings.clientSecret || await this.getSecret("health-connect-client-secret");
        const clientId = this.settings.clientId;

        if (!refreshToken || !clientId || !clientSecret) {
            return "";
        }

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

            if (!res.ok) return "";

            const data = await res.json();
            if (!this.settings.tokens) this.settings.tokens = {};
            this.settings.tokens.accessToken = data.access_token;
            this.settings.tokens.expiresAt = Date.now() + (data.expires_in * 1000);
            if (data.refresh_token) {
                this.settings.tokens.refreshToken = data.refresh_token;
                await this.setSecret("health-connect-refresh-token", data.refresh_token);
            }
            await this.saveSettings();
            return data.access_token;
        } catch (e) {
            console.error("Token refresh failed:", e);
            return "";
        }
    }

    public async parseAndApplyCredentialsJson(jsonText: string): Promise<boolean> {
        try {
            const parsed = JSON.parse(jsonText);
            const client = parsed.web || parsed.installed || parsed;

            if (client.client_id) this.settings.clientId = client.client_id.trim();
            if (client.client_secret) {
                this.settings.clientSecret = client.client_secret.trim();
                await this.setSecret("health-connect-client-secret", client.client_secret.trim());
            }
            if (client.redirect_uris && client.redirect_uris.length > 0) {
                this.settings.redirectUri = client.redirect_uris[0].trim();
            }
            this.settings.rawCredentialsJson = jsonText;

            await this.setSecret("health-connect-google-credentials", jsonText);
            await this.saveSettings();
            new Notice("Google Credentials parsed and saved to Keychain! 🔐");
            return true;
        } catch (e) {
            new Notice("Invalid credentials JSON format.");
            return false;
        }
    }

    public async startOAuthFlow(): Promise<void> {
        const clientId = this.settings.clientId;
        const clientSecret = this.settings.clientSecret || await this.getSecret("health-connect-client-secret");
        const redirectUri = this.settings.redirectUri || "http://localhost:8092";
        const requestedScopes = this.settings.requestedScopes;

        if (!clientId || !clientSecret) {
            new Notice("Please enter Client ID & Secret in settings first.");
            return;
        }

        if (this.activeServer) {
            try { this.activeServer.close(); } catch (e) {}
            this.activeServer = null;
        }

        const server = http.createServer(async (req, res) => {
            const reqUrl = url.parse(req.url || "", true);
            const authCode = reqUrl.query.code as string;

            if (authCode) {
                res.writeHead(200, { "Content-Type": "text/html" });
                res.end("<h1>Authentication Successful!</h1><p>You can close this tab and return to Obsidian.</p>");
                try { server.close(); } catch (e) {}
                this.activeServer = null;

                try {
                    const body = new URLSearchParams({
                        code: authCode,
                        client_id: clientId,
                        client_secret: clientSecret,
                        redirect_uri: redirectUri,
                        grant_type: "authorization_code"
                    });

                    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
                        method: "POST",
                        headers: { "Content-Type": "application/x-www-form-urlencoded" },
                        body: body.toString()
                    });

                    if (!tokenRes.ok) {
                        new Notice("Failed to exchange token.");
                        return;
                    }

                    const data = await tokenRes.json();
                    this.settings.tokens = {
                        accessToken: data.access_token,
                        refreshToken: data.refresh_token || this.settings.tokens?.refreshToken || "",
                        expiresAt: Date.now() + (data.expires_in * 1000)
                    };

                    if (this.settings.tokens.refreshToken) {
                        await this.setSecret("health-connect-refresh-token", this.settings.tokens.refreshToken);
                    }
                    await this.saveSettings();
                    new Notice("Google Health Connected Successfully! 🟢");
                } catch (e) {
                    new Notice("Token exchange error: " + e.message);
                }
            } else {
                res.writeHead(400, { "Content-Type": "text/html" });
                res.end("<h1>Authentication Failed</h1>");
                try { server.close(); } catch (e) {}
                this.activeServer = null;
            }
        });

        server.on("error", (err: any) => {
            console.error("OAuth server error:", err);
            new Notice("OAuth Server Notice: " + (err.code === "EADDRINUSE" ? "Port 8092 busy, retrying..." : err.message));
        });

        this.activeServer = server;

        server.listen(8092, () => {
            const cleanScopes = (requestedScopes || [])
                .filter(s => s !== "https://www.googleapis.com/auth/googlehealth.activity.readonly" && s.trim() !== "");
            if (!cleanScopes.includes("https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly")) {
                cleanScopes.push("https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly");
            }
            this.settings.requestedScopes = cleanScopes;

            const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(cleanScopes.join(" "))}&access_type=offline&prompt=consent`;
            
            try {
                const electron = (window as any).require ? (window as any).require("electron") : null;
                if (electron?.shell?.openExternal) {
                    electron.shell.openExternal(authUrl);
                } else {
                    window.open(authUrl, "_blank");
                }
            } catch (e) {
                window.open(authUrl, "_blank");
            }

            new Notice("Opening browser for Google Health authorization...");
        });

        setTimeout(() => { 
            if (this.activeServer === server) {
                try { server.close(); } catch (e) {}
                this.activeServer = null;
            }
        }, 120000);
    }

    public async testConnection(): Promise<{ ok: boolean; message: string }> {
        const token = await this.getAccessToken();
        if (!token) return { ok: false, message: "No valid token. Please connect Google Account." };

        try {
            const res = await fetch("https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=" + token);
            if (res.ok) return { ok: true, message: "Google Health API connection active! 🟢" };
            return { ok: false, message: `Status code ${res.status}` };
        } catch (e) {
            return { ok: false, message: e.message };
        }
    }

    public isConnected(): boolean {
        return !!(this.settings.tokens.accessToken || this.settings.tokens.refreshToken);
    }

    private async setSecret(key: string, val: string): Promise<void> {
        const anyApp = this.app as any;
        if (anyApp.secretStorage?.setSecret) {
            try { await anyApp.secretStorage.setSecret(key, val); } catch (e) {}
        }
    }

    private async getSecret(key: string): Promise<string> {
        const anyApp = this.app as any;
        if (anyApp.secretStorage?.getSecret) {
            try { return await anyApp.secretStorage.getSecret(key) || ""; } catch (e) {}
        }
        return "";
    }
}
