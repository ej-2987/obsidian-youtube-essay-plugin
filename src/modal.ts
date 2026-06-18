import { App, Modal, Notice, Setting, TAbstractFile, TFile, FuzzySuggestModal } from "obsidian";
import type YoutubeEssayPlugin from "./main";
import { generateEssay } from "./essay";
import type { EssayLanguage } from "./settings";

// ── File picker modal ─────────────────────────────────────────────────────────

class FileSuggestModal extends FuzzySuggestModal<TFile> {
  private onChoose: (file: TFile) => void;

  constructor(app: App, onChoose: (file: TFile) => void) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("Choose a transcript .md file…");
  }

  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}

// ── Main modal ────────────────────────────────────────────────────────────────

export class YoutubeEssayModal extends Modal {
  plugin: YoutubeEssayPlugin;
  private selectedFile: TFile | null = null;
  private language: EssayLanguage;
  private isGenerating = false;
  private progressBar: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private fileNameEl: HTMLElement | null = null;

  constructor(app: App, plugin: YoutubeEssayPlugin) {
    super(app);
    this.plugin = plugin;
    this.language = plugin.settings.defaultLanguage;

    // Pre-select the active file if it is a markdown file
    const active = this.app.workspace.getActiveFile();
    if (active && active.extension === "md") {
      this.selectedFile = active;
    }
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "YouTube Essay Generator" });

    // ── File selector ─────────────────────────────────────────────────────────
    const fileSetting = new Setting(contentEl)
      .setName("Transcript file")
      .setDesc("Select the .md transcript file exported by YTranscript");

    this.fileNameEl = fileSetting.descEl.createEl("div");
    this.fileNameEl.style.cssText =
      "margin-top:4px; font-size:0.85em; color:var(--text-accent); font-weight:500;";
    this.updateFileLabel();

    fileSetting.addButton((btn) =>
      btn.setButtonText("Choose file…").onClick(() => {
        new FileSuggestModal(this.app, (file) => {
          this.selectedFile = file;
          this.updateFileLabel();
        }).open();
      })
    );

    // ── Language selector ─────────────────────────────────────────────────────
    new Setting(contentEl)
      .setName("Essay Style")
      .addDropdown((drop) =>
        drop
          .addOption("ko", "한국어 — 뉴필로소퍼 스타일")
          .addOption("en", "English — AEON style")
          .setValue(this.language)
          .onChange((v) => (this.language = v as EssayLanguage))
      );

    // ── Progress area ─────────────────────────────────────────────────────────
    this.statusEl = contentEl.createEl("p");
    this.statusEl.style.cssText =
      "color:var(--text-muted); font-size:0.85em; min-height:1.2em; margin:4px 0;";

    const progressWrap = contentEl.createEl("div");
    progressWrap.style.cssText =
      "height:4px; background:var(--background-modifier-border); border-radius:2px; margin:6px 0 12px; overflow:hidden;";
    this.progressBar = progressWrap.createEl("div");
    this.progressBar.style.cssText =
      "height:100%; width:0%; background:var(--interactive-accent); transition:width 0.4s ease;";

    // ── Generate button ───────────────────────────────────────────────────────
    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText("Generate Essay")
        .setCta()
        .onClick(() => {
          if (!this.isGenerating) this.runGeneration();
        })
    );
  }

  private updateFileLabel() {
    if (!this.fileNameEl) return;
    this.fileNameEl.setText(
      this.selectedFile ? `📄 ${this.selectedFile.path}` : "No file selected"
    );
  }

  private setStatus(text: string, percent?: number) {
    if (this.statusEl) this.statusEl.setText(text);
    if (this.progressBar && percent !== undefined) {
      this.progressBar.style.width = `${percent}%`;
    }
  }

  private getApiKey(): string {
    const s = this.plugin.settings;
    switch (s.apiProvider) {
      case "claude": return s.claudeApiKey;
      case "openai": return s.openaiApiKey;
      case "gemini": return s.geminiApiKey;
    }
  }

  private getModel(): string {
    const s = this.plugin.settings;
    switch (s.apiProvider) {
      case "claude": return s.claudeModel;
      case "openai": return s.openaiModel;
      case "gemini": return s.geminiModel;
    }
  }

  private async runGeneration() {
    if (!this.selectedFile) {
      new Notice("Please select a transcript file first.");
      return;
    }
    const apiKey = this.getApiKey();
    if (!apiKey) {
      new Notice(
        `YouTube Essay Generator: Please add your ${this.plugin.settings.apiProvider} API key in Settings.`
      );
      return;
    }

    this.isGenerating = true;
    this.setStatus(this.language === "en" ? "Reading transcript…" : "트랜스크립트 읽는 중…", 2);

    try {
      // ── 1. Read transcript ──────────────────────────────────────────────────
      const transcript = await this.app.vault.read(this.selectedFile);
      if (!transcript.trim()) {
        throw new Error("The selected file is empty.");
      }

      const sourceTitle = this.selectedFile.basename;
      this.setStatus(
        this.language === "en"
          ? `Transcript loaded (${transcript.length.toLocaleString()} chars). Generating essay…`
          : `트랜스크립트 로드 완료 (${transcript.length.toLocaleString()}자). 에세이 생성 중…`,
        5
      );

      // ── 2. Generate essay ───────────────────────────────────────────────────
      const markdown = await generateEssay(
        this.plugin.settings.apiProvider,
        apiKey,
        this.getModel(),
        transcript,
        this.language,
        sourceTitle,
        ({ step, current }) => this.setStatus(step, 5 + Math.round(current * 0.93))
      );

      // ── 3. Save to vault ────────────────────────────────────────────────────
      await this.saveEssay(markdown, sourceTitle);
      this.setStatus(this.language === "en" ? "Essay saved!" : "에세이 저장 완료!", 100);
      setTimeout(() => this.close(), 1800);
    } catch (err) {
      const msg = (err as Error).message;
      console.error("[YouTubeEssay]", err);
      new Notice(`Essay Generator Error: ${msg}`);
      this.setStatus(`Error: ${msg}`);
    } finally {
      this.isGenerating = false;
    }
  }

  private async saveEssay(markdown: string, sourceTitle: string) {
    const folder = this.plugin.settings.outputFolder;
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder);
    }

    const safeTitle = sourceTitle
      .replace(/[\\/:*?"<>|#^[\]]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
    const styleSuffix = this.language === "en" ? "AEON" : "뉴필로소퍼";
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `${folder ? folder + "/" : ""}${safeTitle} — ${styleSuffix} (${timestamp}).md`;

    const file = await this.app.vault.create(filename, markdown);
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file as TFile);
    new Notice(`Essay saved: ${filename}`);
  }

  onClose() {
    this.contentEl.empty();
  }
}
