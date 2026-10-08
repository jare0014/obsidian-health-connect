import { App } from "obsidian";
import HealthConnectPlugin from "../main";
import { HealthHubModal, HealthHubTab } from "./HealthHubModal";

export class FoodLoggerModal extends HealthHubModal {
    constructor(app: App, plugin: HealthConnectPlugin, activeTab: HealthHubTab = 'log') {
        super(app, plugin, activeTab, 'nutrition');
    }
}
