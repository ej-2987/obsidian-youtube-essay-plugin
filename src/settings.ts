import { App, PluginSettingTab, Setting } from "obsidian";
import type YoutubeEssayPlugin from "./main";

export type ApiProvider = "claude" | "openai" | "gemini";
export type EssayLanguage = "en" | "ko";

export interface YoutubeEssaySettings {
  apiProvider: ApiProvider;
  claudeApiKey: string;
  claudeModel: string;
  openaiApiKey: string;
  openaiModel: string;
  geminiApiKey: string;
  geminiModel: string;
  outputFolder: string;
  defaultLanguage: EssayLanguage;
}

export const DEFAULT_SETTINGS: YoutubeEssaySettings = {
  apiProvider: "claude",
  claudeApiKey: "",
  claudeModel: "claude-opus-4-8",
  openaiApiKey: "",
  openaiModel: "gpt-4o",
  geminiApiKey: "",
  geminiModel: "gemini-2.0-flash",
  outputFolder: "Essays",
  defaultLanguage: "ko",
};

export class YoutubeEssaySettingTab extends PluginSettingTab {
  plugin: YoutubeEssayPlugin;

  constructor(app: App, plugin: YoutubeEssayPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "YouTube Essay Generator" });

    // ── API Provider ──────────────────────────────────────────────────────────
    new Setting(containerEl)
      .setName("AI Provider")
      .setDesc("Which AI service to use for essay generation")
      .addDropdown((drop) =>
        drop
          .addOption("claude", "Claude (Anthropic)")
          .addOption("openai", "OpenAI (GPT)")
          .addOption("gemini", "Gemini (Google)")
          .setValue(this.plugin.settings.apiProvider)
          .onChange(async (value) => {
            this.plugin.settings.apiProvider = value as ApiProvider;
            await this.plugin.saveSettings();
            this.display(); // re-render to show relevant fields
          })
      );

    // ── Claude ────────────────────────────────────────────────────────────────
    if (this.plugin.settings.apiProvider === "claude") {
      new Setting(containerEl)
        .setName("Claude API Key")
        .setDesc("From console.anthropic.com → API Keys")
        .addText((text) =>
          text
            .setPlaceholder("sk-ant-…")
            .setValue(this.plugin.settings.claudeApiKey)
            .onChange(async (v) => {
              this.plugin.settings.claudeApiKey = v.trim();
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("Claude Model")
        .addDropdown((drop) =>
          drop
            .addOption("claude-opus-4-8", "Claude Opus 4.8 — best quality")
            .addOption("claude-sonnet-4-6", "Claude Sonnet 4.6 — fast")
            .addOption("claude-haiku-4-5-20251001", "Claude Haiku 4.5 — fastest")
            .setValue(this.plugin.settings.claudeModel)
            .onChange(async (v) => {
              this.plugin.settings.claudeModel = v;
              await this.plugin.saveSettings();
            })
        );
    }

    // ── OpenAI ────────────────────────────────────────────────────────────────
    if (this.plugin.settings.apiProvider === "openai") {
      new Setting(containerEl)
        .setName("OpenAI API Key")
        .setDesc("From platform.openai.com → API Keys")
        .addText((text) =>
          text
            .setPlaceholder("sk-…")
            .setValue(this.plugin.settings.openaiApiKey)
            .onChange(async (v) => {
              this.plugin.settings.openaiApiKey = v.trim();
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("OpenAI Model")
        .addDropdown((drop) =>
          drop
            .addOption("gpt-4o", "GPT-4o — best quality")
            .addOption("gpt-4o-mini", "GPT-4o mini — fast")
            .addOption("o3-mini", "o3-mini — reasoning")
            .setValue(this.plugin.settings.openaiModel)
            .onChange(async (v) => {
              this.plugin.settings.openaiModel = v;
              await this.plugin.saveSettings();
            })
        );
    }

    // ── Gemini ────────────────────────────────────────────────────────────────
    if (this.plugin.settings.apiProvider === "gemini") {
      new Setting(containerEl)
        .setName("Gemini API Key")
        .setDesc("From aistudio.google.com → Get API Key")
        .addText((text) =>
          text
            .setPlaceholder("AIza…")
            .setValue(this.plugin.settings.geminiApiKey)
            .onChange(async (v) => {
              this.plugin.settings.geminiApiKey = v.trim();
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("Gemini Model")
        .addDropdown((drop) =>
          drop
            .addOption("gemini-2.5-pro-preview-06-05", "Gemini 2.5 Pro — best quality")
            .addOption("gemini-2.0-flash", "Gemini 2.0 Flash — fast")
            .addOption("gemini-2.0-flash-lite", "Gemini 2.0 Flash-Lite — fastest")
            .setValue(this.plugin.settings.geminiModel)
            .onChange(async (v) => {
              this.plugin.settings.geminiModel = v;
              await this.plugin.saveSettings();
            })
        );
    }

    // ── General ───────────────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "General" });

    new Setting(containerEl)
      .setName("Default Language / Style")
      .addDropdown((drop) =>
        drop
          .addOption("ko", "한국어 — 뉴필로소퍼 스타일")
          .addOption("en", "English — AEON style")
          .setValue(this.plugin.settings.defaultLanguage)
          .onChange(async (v) => {
            this.plugin.settings.defaultLanguage = v as EssayLanguage;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Output Folder")
      .setDesc("Vault folder where generated essays are saved (created if absent)")
      .addText((text) =>
        text
          .setPlaceholder("Essays")
          .setValue(this.plugin.settings.outputFolder)
          .onChange(async (v) => {
            this.plugin.settings.outputFolder = v.trim();
            await this.plugin.saveSettings();
          })
      );
  }
}
