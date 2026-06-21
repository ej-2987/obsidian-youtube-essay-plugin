import { App, PluginSettingTab, Setting } from "obsidian";
import type YoutubeEssayPlugin from "./main";

export type ApiProvider = "claude" | "openai" | "gemini";
export type EssayLanguage = "en" | "ko";
export type EssayQuality = "quick" | "balanced" | "thorough";

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
  defaultQuality: EssayQuality;
}

// ── Valid model lists (used for migration) ────────────────────────────────────
export const VALID_CLAUDE_MODELS = [
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
];
export const VALID_OPENAI_MODELS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-4o",
  "gpt-4o-mini",
];
export const VALID_GEMINI_MODELS = [
  "gemini-3.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  // gemini-2.0-flash 및 2.0-flash-lite 는 단종 — 목록에서 제거해 마이그레이션 강제 적용
];

export const DEFAULT_SETTINGS: YoutubeEssaySettings = {
  apiProvider: "claude",
  claudeApiKey: "",
  claudeModel: "claude-haiku-4-5-20251001",
  openaiApiKey: "",
  openaiModel: "gpt-5.4-mini",
  geminiApiKey: "",
  geminiModel: "gemini-2.5-flash",
  outputFolder: "Essays",
  defaultLanguage: "ko",
  defaultQuality: "balanced",
};

// ── Migration: reset invalid saved model names to defaults ────────────────────
export function migrateSettings(s: YoutubeEssaySettings): YoutubeEssaySettings {
  if (!VALID_CLAUDE_MODELS.includes(s.claudeModel))
    s.claudeModel = DEFAULT_SETTINGS.claudeModel;
  if (!VALID_OPENAI_MODELS.includes(s.openaiModel))
    s.openaiModel = DEFAULT_SETTINGS.openaiModel;
  if (!VALID_GEMINI_MODELS.includes(s.geminiModel))
    s.geminiModel = DEFAULT_SETTINGS.geminiModel;
  return s;
}

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

    // ── Active Provider ───────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "사용할 AI 제공자 / Active Provider" });

    new Setting(containerEl)
      .setName("Active Provider")
      .setDesc("에세이 생성에 사용할 AI 서비스를 선택하세요")
      .addDropdown((drop) =>
        drop
          .addOption("claude", "🟠 Claude (Anthropic)")
          .addOption("openai", "🟢 OpenAI (GPT)")
          .addOption("gemini", "🔵 Gemini (Google)")
          .setValue(this.plugin.settings.apiProvider)
          .onChange(async (value) => {
            this.plugin.settings.apiProvider = value as ApiProvider;
            await this.plugin.saveSettings();
          })
      );

    // ── Claude ────────────────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "🟠 Claude (Anthropic)" });

    new Setting(containerEl)
      .setName("API Key")
      .setDesc("console.anthropic.com → API Keys")
      .addText((text) => {
        text
          .setPlaceholder("sk-ant-…")
          .setValue(this.plugin.settings.claudeApiKey)
          .onChange(async (v) => {
            this.plugin.settings.claudeApiKey = v.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
        text.inputEl.style.width = "100%";
      });

    new Setting(containerEl)
      .setName("Model")
      .addDropdown((drop) =>
        drop
          .addOption("claude-opus-4-8", "Opus 4.8 — 최고 품질")
          .addOption("claude-sonnet-4-6", "Sonnet 4.6 — 균형")
          .addOption("claude-haiku-4-5-20251001", "Haiku 4.5 — 빠름 / 저렴")
          .setValue(this.plugin.settings.claudeModel)
          .onChange(async (v) => {
            this.plugin.settings.claudeModel = v;
            await this.plugin.saveSettings();
          })
      );

    // ── OpenAI ────────────────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "🟢 OpenAI (GPT)" });

    new Setting(containerEl)
      .setName("API Key")
      .setDesc("platform.openai.com → API Keys")
      .addText((text) => {
        text
          .setPlaceholder("sk-…")
          .setValue(this.plugin.settings.openaiApiKey)
          .onChange(async (v) => {
            this.plugin.settings.openaiApiKey = v.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
        text.inputEl.style.width = "100%";
      });

    new Setting(containerEl)
      .setName("Model")
      .addDropdown((drop) =>
        drop
          .addOption("gpt-5.5", "GPT-5.5 — 최고 품질")
          .addOption("gpt-5.4", "GPT-5.4 — 균형")
          .addOption("gpt-5.4-mini", "GPT-5.4 mini — 빠름 / 저렴")
          .addOption("gpt-4o", "GPT-4o — 구버전")
          .addOption("gpt-4o-mini", "GPT-4o mini — 구버전")
          .setValue(this.plugin.settings.openaiModel)
          .onChange(async (v) => {
            this.plugin.settings.openaiModel = v;
            await this.plugin.saveSettings();
          })
      );

    // ── Gemini ────────────────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "🔵 Gemini (Google)" });

    new Setting(containerEl)
      .setName("API Key")
      .setDesc("aistudio.google.com → Get API Key")
      .addText((text) => {
        text
          .setPlaceholder("AIza…")
          .setValue(this.plugin.settings.geminiApiKey)
          .onChange(async (v) => {
            this.plugin.settings.geminiApiKey = v.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
        text.inputEl.style.width = "100%";
      });

    new Setting(containerEl)
      .setName("Model")
      .addDropdown((drop) =>
        drop
          .addOption("gemini-3.5-flash", "Gemini 3.5 Flash — 최신")
          .addOption("gemini-2.5-pro", "Gemini 2.5 Pro — 최고 품질")
          .addOption("gemini-2.5-flash", "Gemini 2.5 Flash — 균형")
          .addOption("gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite — 저렴")
          .setValue(this.plugin.settings.geminiModel)
          .onChange(async (v) => {
            this.plugin.settings.geminiModel = v;
            await this.plugin.saveSettings();
          })
      );

    // ── General ───────────────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "일반 설정 / General" });

    new Setting(containerEl)
      .setName("Default Language / Style")
      .setDesc("생성 시 모달에서 언제든 변경 가능")
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
      .setName("Default Quality / Cost")
      .setDesc(
        "저비용: 빠르고 저렴 | 중간: 균형 (권장) | 고품질: 가장 상세하지만 토큰 소모 큼"
      )
      .addDropdown((drop) =>
        drop
          .addOption("quick",    "⚡ 저비용 — 짧은 영상·비용 절감")
          .addOption("balanced", "⚖️ 중간비용 — 균형 (기본값)")
          .addOption("thorough", "🔍 고품질 — 긴 영상·상세 커버리지")
          .setValue(this.plugin.settings.defaultQuality)
          .onChange(async (v) => {
            this.plugin.settings.defaultQuality = v as EssayQuality;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Output Folder")
      .setDesc("에세이가 저장될 Vault 폴더 (없으면 자동 생성)")
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
