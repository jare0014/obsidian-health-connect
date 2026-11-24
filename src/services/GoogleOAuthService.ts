import { App, Modal, Notice, Platform, Setting, requestUrl } from "obsidian";
import { HealthPluginSettings, DEFAULT_SETTINGS } from "../models/HealthSettings";

interface DesktopOAuthServer {
    close: () => void;
    listen: (port: number, cb: () => void) => void;
    on: (event: string, cb: (err: any) => void) => void;
}

class MobileOAuthModal extends Modal {
    private authUrl: string;
    private onComplete: (input: string) => Promise<boolean>;
    private onTestConnection: () => Promise<{ ok: boolean; message: string }>;

    constructor(
        app: App,
        authUrl: string,
        onComplete: (input: string) => Promise<boolean>,
        onTestConnection: () => Promise<{ ok: boolean; message: string }>
    ) {
        super(app);
        this.authUrl = authUrl;
        this.onComplete = onComplete;
        this.onTestConnection = onTestConnection;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl("h3", { text: "Connect Google Health (Mobile)" });
        contentEl.createEl("p", {
            text: "Mobile devices cannot run a local OAuth callback server. Complete sign-in using either option below:",
            cls: "setting-item-description"
        });

        const steps = contentEl.createEl("ol", {
            attr: { style: "margin: 8px 0 14px 18px; padding: 0; line-height: 1.5; font-size: 0.92em;" }
        });
        steps.createEl("li", { text: "Tap \"Open Google Sign-In\" and approve access in your browser." });
        steps.createEl("li", { text: "When redirected to localhost:8092 (the page will fail to load on mobile), copy the full URL from the address bar or the code= value." });
        steps.createEl("li", { text: "Paste the redirect URL or code below and tap \"Complete Authorization\"." });

        new Setting(contentEl)
            .setName("Step 1: Sign in with Google")
            .setDesc("Opens Google OAuth in your device browser.")
            .addButton(btn => btn
                .setButtonText("Open Google Sign-In")
                .setCta()
                .onClick(() => {
                    window.open(this.authUrl, "_blank");
                    new Notice("Opened browser for Google sign-in. Copy the redirect URL or code when finished.");
                })
            );

        let pastedInput = "";
        new Setting(contentEl)
            .setName("Step 2: Redirect URL or Authorization Code")
            .setDesc("Paste http://localhost:8092/?code=... or just the code.")
            .addText(text => {
                text.setPlaceholder("http://localhost:8092/?code=4/0A...")
                    .onChange(val => {
                        pastedInput = val.trim();
                    });
            });

        const actionSetting = new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText("Complete Authorization")
                .setCta()
                .onClick(async () => {
                    if (!pastedInput) {
                        new Notice("Please paste the redirect URL or authorization code first.");
                        return;
                    }
                    btn.setDisabled(true);
                    btn.setButtonText("Authorizing...");
                    const ok = await this.onComplete(pastedInput);
                    if (ok) {
                        this.close();
                    } else {
                        btn.setDisabled(false);
                        btn.setButtonText("Complete Authorization");
                    }
                })
            );

        contentEl.createEl("p", {
            text: "Already connected on Desktop? If your vault syncs plugin data.json, you can test the synced token directly:",
            cls: "setting-item-description"
        });

        actionSetting.addButton(btn => btn
            .setButtonText("Test Synced Token")
            .onClick(async () => {
                btn.setDisabled(true);
                const res = await this.onTestConnection();
                new Notice(res.ok ? res.message : `Not connected yet: ${res.message}`);
                if (res.ok) {
                    this.close();
                } else {
                    btn.setDisabled(false);
                }
            })
        );
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

export class GoogleOAuthService {
    private app: App;
    private settings: HealthPluginSettings;
    private saveSettings: () => Promise<void>;
    private activeServer: DesktopOAuthServer | null = null;
    private isAuthenticating: boolean = false;

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

            let res: any;
            try {
                res = await requestUrl({
                    url: "https://oauth2.googleapis.com/token",
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: body.toString(),
                    throw: false
                });
            } catch (err: any) {
                console.error("[Health Connect] Token refresh HTTP error:", err);
                return "";
            }

            if (!res || res.status !== 200) {
                console.error("[Health Connect] Token refresh failed:", res?.text || res?.status);
                return "";
            }

            const data = res.json;
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
            new Notice("Google Credentials parsed and saved! 🔐");
            return true;
        } catch (e) {
            new Notice("Invalid credentials JSON format.");
            return false;
        }
    }

    public buildAuthUrl(clientId: string, redirectUri: string): string {
        const allScopes = new Set([
            ...(this.settings.requestedScopes || []),
            ...DEFAULT_SETTINGS.requestedScopes
        ]);
        allScopes.delete("https://www.googleapis.com/auth/googlehealth.activity.readonly");
        allScopes.delete("https://www.googleapis.com/auth/googlehealth.mindfulness.readonly");
        allScopes.delete("https://www.googleapis.com/auth/googlehealth.mindfulness.writeonly");
        allScopes.add("https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly");
        allScopes.add("https://www.googleapis.com/auth/googlehealth.activity_and_fitness.writeonly");
        const cleanScopes = Array.from(allScopes).filter(s => s && s.trim() !== "");
        this.settings.requestedScopes = cleanScopes;

        return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(cleanScopes.join(" "))}&access_type=offline&prompt=consent`;
    }

    public extractAuthCodeFromInput(rawInput: string): { code?: string; error?: string } {
        const trimmed = (rawInput || "").trim();
        if (!trimmed) return {};

        if (/^https?:\/\//i.test(trimmed)) {
            try {
                const parsed = new URL(trimmed);
                const error = parsed.searchParams.get("error");
                if (error) return { error };
                const code = parsed.searchParams.get("code");
                if (code) return { code: code.trim() };
            } catch {
                // fall through
            }
        }

        if (trimmed.startsWith("?") || trimmed.includes("code=") || trimmed.includes("error=")) {
            const query = trimmed.startsWith("?") ? trimmed.slice(1) : trimmed;
            const params = new URLSearchParams(query);
            const error = params.get("error");
            if (error) return { error };
            const code = params.get("code");
            if (code) return { code: code.trim() };
        }

        return { code: trimmed };
    }

    public async exchangeAuthCode(
        authCode: string,
        clientId?: string,
        clientSecret?: string,
        redirectUri?: string
    ): Promise<{ ok: boolean; error?: string; status?: number }> {
        const resolvedClientId = (clientId ?? this.settings.clientId ?? "").trim();
        const resolvedClientSecret = (clientSecret ?? this.settings.clientSecret ?? await this.getSecret("health-connect-client-secret") ?? "").trim();
        const resolvedRedirectUri = (redirectUri ?? this.settings.redirectUri ?? "http://localhost:8092").trim();

        if (!resolvedClientId || !resolvedClientSecret) {
            return { ok: false, error: "Please enter Client ID & Secret in settings first." };
        }

        const body = new URLSearchParams({
            code: authCode.trim(),
            client_id: resolvedClientId,
            client_secret: resolvedClientSecret,
            redirect_uri: resolvedRedirectUri,
            grant_type: "authorization_code"
        });

        let tokenRes: any;
        try {
            tokenRes = await requestUrl({
                url: "https://oauth2.googleapis.com/token",
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: body.toString(),
                throw: false
            });
        } catch (err: any) {
            const errText = err?.text || err?.response?.text || "";
            const errJson = err?.json ? JSON.stringify(err.json) : "";
            const fullErr = errText || errJson || err?.message || String(err);
            console.error("[Health Connect] Token exchange HTTP error:", fullErr);
            return { ok: false, error: fullErr, status: err?.status || 500 };
        }

        if (!tokenRes || tokenRes.status !== 200) {
            const errText = tokenRes?.text || String(tokenRes?.status || "Unknown");
            console.error("[Health Connect] Failed to exchange token:", errText);
            return { ok: false, error: errText, status: tokenRes?.status || 500 };
        }

        const data = tokenRes.json;
        this.settings.tokens = {
            accessToken: data.access_token,
            refreshToken: data.refresh_token || this.settings.tokens?.refreshToken || "",
            expiresAt: Date.now() + (data.expires_in * 1000)
        };

        if (this.settings.tokens.refreshToken) {
            await this.setSecret("health-connect-refresh-token", this.settings.tokens.refreshToken);
        }
        if (resolvedClientSecret) {
            await this.setSecret("health-connect-client-secret", resolvedClientSecret);
        }
        await this.saveSettings();
        return { ok: true };
    }

    public async completeMobileOAuth(rawInput: string): Promise<boolean> {
        const { code, error } = this.extractAuthCodeFromInput(rawInput);
        if (error) {
            new Notice(`Google Health authorization error: ${error}`);
            return false;
        }
        if (!code) {
            new Notice("Could not find an authorization code in the pasted input.");
            return false;
        }

        const result = await this.exchangeAuthCode(code);
        if (!result.ok) {
            new Notice(`Token exchange failed: ${result.error || "Unknown error"}`);
            return false;
        }

        new Notice("Google Health Connected Successfully! 🟢");
        return true;
    }

    private openExternalAuthUrl(authUrl: string): void {
        if (Platform.isDesktopApp) {
            try {
                const nodeRequire = (window as any).require;
                const electron = nodeRequire ? nodeRequire("electron") : null;
                if (electron?.shell?.openExternal) {
                    electron.shell.openExternal(authUrl);
                    return;
                }
            } catch {
                // fall back to window.open
            }
        }
        window.open(authUrl, "_blank");
    }

    public async startOAuthFlow(isUserGesture: boolean = true): Promise<void> {
        if (!isUserGesture) {
            console.warn("[Health Connect] OAuth flow blocked: requires explicit user gesture.");
            return;
        }

        const clientId = (this.settings.clientId || "").trim();
        const clientSecret = (this.settings.clientSecret || await this.getSecret("health-connect-client-secret") || "").trim();
        const redirectUri = (this.settings.redirectUri || "http://localhost:8092").trim();

        if (!clientId || !clientSecret) {
            new Notice("Please enter Client ID & Secret in settings first.");
            return;
        }

        const authUrl = this.buildAuthUrl(clientId, redirectUri);

        if (Platform.isMobileApp || !Platform.isDesktopApp) {
            new MobileOAuthModal(
                this.app,
                authUrl,
                (input) => this.completeMobileOAuth(input),
                () => this.testConnection()
            ).open();
            return;
        }

        if (this.isAuthenticating) {
            new Notice("Google Health authorization is already waiting for login in your browser. ⏳");
            return;
        }

        const nodeRequire = (window as any).require || (typeof require === "function" ? require : null);
        const http = Platform.isDesktopApp && nodeRequire ? nodeRequire("http") : null;
        if (!http || typeof http.createServer !== "function") {
            new MobileOAuthModal(
                this.app,
                authUrl,
                (input) => this.completeMobileOAuth(input),
                () => this.testConnection()
            ).open();
            return;
        }

        if (this.activeServer) {
            try { this.activeServer.close(); } catch (e) {}
            this.activeServer = null;
        }

        this.isAuthenticating = true;

        let listenPort = 8092;
        try {
            const parsedRedirect = new URL(redirectUri);
            if (parsedRedirect.port) {
                listenPort = Number(parsedRedirect.port) || 8092;
            }
        } catch {
            // keep default 8092
        }

        const cleanup = () => {
            if (this.activeServer === server) {
                try { server.close(); } catch (e) {}
                this.activeServer = null;
            }
            this.isAuthenticating = false;
        };

        const server: DesktopOAuthServer = http.createServer(async (req: any, res: any) => {
            const parsedUrl = new URL(req.url || "/", `http://localhost:${listenPort}`);
            if (parsedUrl.pathname === "/favicon.ico") {
                res.writeHead(404);
                res.end();
                return;
            }

            const authCode = parsedUrl.searchParams.get("code");
            const error = parsedUrl.searchParams.get("error");

            if (error) {
                res.writeHead(400, { "Content-Type": "text/html" });
                res.end(`<h1>Authentication Failed</h1><p>${error}</p>`);
                cleanup();
                new Notice(`Google Health authorization error: ${error}`);
                return;
            }

            if (authCode) {
                try {
                    const exchange = await this.exchangeAuthCode(authCode, clientId, clientSecret, redirectUri);
                    if (!exchange.ok) {
                        res.writeHead(exchange.status || 500, { "Content-Type": "text/html" });
                        res.end(`<h1>Token Exchange Failed</h1><p>${exchange.error || "Unknown"}</p><p><small>Client: ${clientId.substring(0, 15)}...</small></p>`);
                        cleanup();
                        new Notice(`Failed to exchange token (${exchange.status || 500}): ${exchange.error || "Unknown"}`);
                        return;
                    }

                    res.writeHead(200, { "Content-Type": "text/html" });
                    res.end("<h1>Authentication Successful!</h1><p>You can close this tab and return to Obsidian.</p>");
                    cleanup();
                    new Notice("Google Health Connected Successfully! 🟢");
                } catch (e: any) {
                    console.error("[Health Connect] Token exchange exception:", e);
                    cleanup();
                    new Notice("Token exchange error: " + (e?.message || String(e)));
                }
            } else {
                res.writeHead(400, { "Content-Type": "text/html" });
                res.end("<h1>Authentication Failed</h1><p>No authorization code received.</p>");
                cleanup();
            }
        });

        server.on("error", (err: any) => {
            console.error("OAuth server error:", err);
            cleanup();
            new Notice("OAuth Server Notice: " + (err.code === "EADDRINUSE" ? `Port ${listenPort} busy, retrying...` : err.message));
        });

        this.activeServer = server;

        server.listen(listenPort, () => {
            this.openExternalAuthUrl(authUrl);
            new Notice("Opening browser for Google Health authorization...");
        });

        setTimeout(() => {
            if (this.activeServer === server) {
                cleanup();
            }
        }, 120000);
    }

    public async testConnection(): Promise<{ ok: boolean; message: string }> {
        const token = await this.getAccessToken();
        if (!token) return { ok: false, message: "No valid token. Please connect Google Account." };

        try {
            const res = await requestUrl({
                url: "https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=" + encodeURIComponent(token),
                method: "GET",
                throw: false
            });
            if (res.status === 200) return { ok: true, message: "Google Health API connection active! 🟢" };
            return { ok: false, message: `Status code ${res.status}` };
        } catch (e: any) {
            return { ok: false, message: e?.message || String(e) };
        }
    }

    public isConnected(): boolean {
        return !!(this.settings.tokens?.accessToken || this.settings.tokens?.refreshToken);
    }

    public async setSecret(key: string, val: string): Promise<void> {
        const anyApp = this.app as any;
        if (anyApp.secretStorage && typeof anyApp.secretStorage.setSecret === 'function') {
            try {
                await anyApp.secretStorage.setSecret(key, val);
                return;
            } catch (e) {}
        }
        // Fallback to in-memory settings
        if (key === "health-connect-refresh-token") {
            if (!this.settings.tokens) this.settings.tokens = {};
            this.settings.tokens.refreshToken = val;
        } else if (key === "health-connect-client-secret") {
            this.settings.clientSecret = val;
        } else if (key === "health-connect-google-credentials") {
            this.settings.rawCredentialsJson = val;
        }
    }

    public async getSecret(key: string): Promise<string> {
        const anyApp = this.app as any;
        if (anyApp.secretStorage && typeof anyApp.secretStorage.getSecret === 'function') {
            try {
                const s = await anyApp.secretStorage.getSecret(key);
                if (s) return s;
            } catch (e) {}
        }
        // Fallback to in-memory settings
        if (key === "health-connect-refresh-token") {
            return this.settings.tokens?.refreshToken || "";
        } else if (key === "health-connect-client-secret") {
            return this.settings.clientSecret || "";
        } else if (key === "health-connect-google-credentials") {
            return this.settings.rawCredentialsJson || "";
        }
        return "";
    }
}
