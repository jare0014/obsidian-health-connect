import { App, Notice } from "obsidian";
import * as fs from "fs";
import * as path from "path";

export interface MetaBindButtonTemplate {
    id: string;
    label: string;
    icon: string;
    style?: string;
    tooltip: string;
    commandId: string;
}

export class MetaBindService {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    public getDefaultButtons(): MetaBindButtonTemplate[] {
        return [
            {
                id: "health-food-logger-btn",
                label: "🍎 Log Food / Drink",
                icon: "apple",
                style: "primary",
                tooltip: "Open Food & Beverage Quick Logger",
                commandId: "health-connect-readiness:health-connect-log-food"
            },
            {
                id: "health-sync-today-btn",
                label: "⚡ Sync Google Health",
                icon: "activity",
                style: "primary",
                tooltip: "Sync today's biometrics into Daily Note",
                commandId: "health-connect-readiness:health-connect-sync-today"
            }
        ];
    }

    public async registerButton(button: MetaBindButtonTemplate): Promise<boolean> {
        const anyAdapter = this.app.vault.adapter as any;
        const vaultPath = anyAdapter.getBasePath ? anyAdapter.getBasePath() : "";
        if (!vaultPath) return false;

        const metaBindPath = path.join(vaultPath, ".obsidian", "plugins", "obsidian-meta-bind-plugin", "data.json");
        if (!fs.existsSync(metaBindPath)) {
            new Notice("Meta Bind plugin not found in vault. Please install or enable Meta Bind plugin.");
            return false;
        }

        try {
            const data = JSON.parse(fs.readFileSync(metaBindPath, "utf8"));
            if (!data.buttonTemplates) data.buttonTemplates = [];

            let existing = data.buttonTemplates.find((b: any) => b.id === button.id);

            const templateDef = {
                label: button.label,
                icon: button.icon,
                style: button.style || "primary",
                class: "",
                cssStyle: "",
                backgroundImage: "",
                tooltip: button.tooltip,
                id: button.id,
                hidden: false,
                actions: [
                    {
                        type: "command",
                        command: button.commandId
                    }
                ]
            };

            if (!existing) {
                data.buttonTemplates.push(templateDef);
            } else {
                Object.assign(existing, templateDef);
            }

            fs.writeFileSync(metaBindPath, JSON.stringify(data, null, 2), "utf8");
            new Notice(`Meta Bind button "\`${button.id}\`" registered! (Reload Meta Bind or restart Obsidian to apply)`);
            return true;
        } catch (e) {
            console.error("Failed to register Meta Bind button:", e);
            new Notice("Failed to update Meta Bind config.");
            return false;
        }
    }

    public async registerAllDefaultButtons(): Promise<void> {
        for (const btn of this.getDefaultButtons()) {
            await this.registerButton(btn);
        }
    }
}
