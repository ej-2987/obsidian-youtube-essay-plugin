import { Plugin, Notice } from "obsidian";
import { YoutubeEssaySettings, DEFAULT_SETTINGS, YoutubeEssaySettingTab } from "./settings";
import { YoutubeEssayModal } from "./modal";

export default class YoutubeEssayPlugin extends Plugin {
  settings: YoutubeEssaySettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: "generate-youtube-essay",
      name: "Generate essay from YouTube video",
      callback: () => {
        if (!this.hasApiKey()) {
          new Notice(
            "YouTube Essay Generator: Please add an API key (Claude / OpenAI / Gemini) in the plugin settings."
          );
          return;
        }
        new YoutubeEssayModal(this.app, this).open();
      },
    });

    this.addRibbonIcon("film", "YouTube Essay Generator", () => {
      new YoutubeEssayModal(this.app, this).open();
    });

    this.addSettingTab(new YoutubeEssaySettingTab(this.app, this));
  }

  private hasApiKey(): boolean {
    const s = this.settings;
    return !!(s.claudeApiKey || s.openaiApiKey || s.geminiApiKey);
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
