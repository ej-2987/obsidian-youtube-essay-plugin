import { requestUrl } from "obsidian";
import type { ApiProvider, EssayQuality } from "./settings";

export type EssayLanguage = "en" | "ko";

export interface EssayGenerationProgress {
  step: string;
  current: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Quality presets — controls cost vs coverage tradeoff
// ---------------------------------------------------------------------------

interface QualityParams {
  excerptMaxChars:    number;   // transcript chars fed to each section
  overlapRatio:       number;   // how much to overlap adjacent section windows
  chunkSummaryTokens: number;   // max output tokens for each chunk summary
  outlineMaxTokens:   number;   // max output tokens for outline generation
  maxSections:        number;   // hard cap on number of body sections
  sectionOutputTokens: number;  // max output tokens per section (0 = model max)
}

const QUALITY_PARAMS: Record<EssayQuality, QualityParams> = {
  quick: {
    excerptMaxChars:     5000,
    overlapRatio:        0.10,
    chunkSummaryTokens:  500,
    outlineMaxTokens:    2048,
    maxSections:         5,
    sectionOutputTokens: 2500,
  },
  balanced: {
    excerptMaxChars:     7500,
    overlapRatio:        0.15,
    chunkSummaryTokens:  700,
    outlineMaxTokens:    3000,
    maxSections:         8,
    sectionOutputTokens: 5000,
  },
  thorough: {
    excerptMaxChars:     10000,
    overlapRatio:        0.15,
    chunkSummaryTokens:  900,
    outlineMaxTokens:    4096,
    maxSections:         12,
    sectionOutputTokens: 0,    // 0 = use model max
  },
};

// ---------------------------------------------------------------------------
// Chunking helper
// ---------------------------------------------------------------------------

function chunkText(text: string, maxChars = 24000): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  const sentences = text.match(/[^.!?。！？\n]+[.!?。！？\n]+/g) ?? [text];
  let current = "";

  for (const sentence of sentences) {
    if ((current + sentence).length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += " " + sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// ---------------------------------------------------------------------------
// Outline parser — regex scan over full text (works regardless of line format)
// ---------------------------------------------------------------------------

function parseOutline(raw: string): EssayOutline {
  // Helper: find first match of  KEY:: value  regardless of surrounding text
  const getField = (...keys: string[]): string => {
    for (const key of keys) {
      // Matches KEY:: or KEY: (single colon fallback), captures rest of line
      const re = new RegExp(`${key}\\s*::?\\s*(.+)`, "i");
      const m = raw.match(re);
      if (m?.[1]?.trim()) return m[1].trim();
    }
    return "";
  };

  const essayTitle   = getField("TITLE", "ESSAY_TITLE", "ESSAY TITLE");
  const introduction = getField("INTRO", "INTRODUCTION");
  const conclusion   = getField("CONCLUSION", "CLOSING");

  // Scan for all SECTION_N_TITLE and SECTION_N_SUMMARY regardless of spacing/formatting
  const titles:   Record<number, string> = {};
  const summaries: Record<number, string> = {};

  const titleRe   = /SECTION[_\s]?(\d+)[_\s]?TITLE\s*::?\s*(.+)/gi;
  const summaryRe = /SECTION[_\s]?(\d+)[_\s]?(SUMMARY|DESC|요약|내용)\s*::?\s*(.+)/gi;

  let m: RegExpExecArray | null;
  while ((m = titleRe.exec(raw))   !== null) titles[+m[1]]   = m[2].trim();
  while ((m = summaryRe.exec(raw)) !== null) summaries[+m[1]] = m[3].trim();

  const sections: OutlineSection[] = Object.keys(titles)
    .map(Number)
    .sort((a, b) => a - b)
    .map(n => ({ title: titles[n], summary: summaries[n] ?? "" }));

  if (!essayTitle || sections.length === 0) {
    throw new Error(
      `Could not parse outline.\nRaw response (first 600 chars):\n${raw.slice(0, 600)}`
    );
  }

  return { essayTitle, introduction, sections, conclusion };
}

// ---------------------------------------------------------------------------
// Provider-agnostic LLM call (uses Obsidian requestUrl — works on mobile)
// ---------------------------------------------------------------------------

interface LLMConfig {
  provider: ApiProvider;
  apiKey: string;
  model: string;
}

// Max output tokens by model — used to cap requests within provider limits
const MODEL_MAX_OUTPUT: Record<string, number> = {
  // Claude
  "claude-opus-4-8":            16000,
  "claude-sonnet-4-6":          16000,
  "claude-haiku-4-5-20251001":   8192,
  // OpenAI — GPT-5 계열
  "gpt-5.5":                    16384,
  "gpt-5.4":                    16384,
  "gpt-5.4-mini":               16384,
  "gpt-5.4-nano":               16384,
  // OpenAI — 구버전
  "gpt-4o":                     16384,
  "gpt-4o-mini":                16384,
  "gpt-4.1":                    32768,
  "gpt-4.1-mini":               32768,
  // Gemini
  "gemini-3.5-flash":             8192,
  "gemini-2.5-pro":               8192,
  "gemini-2.5-flash":             8192,
  "gemini-2.5-flash-lite":        8192,
  "gemini-2.0-flash":             8192,
  "gemini-2.0-flash-lite":        8192,
};

function clampTokens(cfg: LLMConfig, requested: number): number {
  const modelMax = MODEL_MAX_OUTPUT[cfg.model] ?? 4096;
  return Math.min(requested, modelMax);
}

async function llmCall(
  config: LLMConfig,
  system: string,
  user: string,
  maxTokens = 2000
): Promise<string> {
  const clamped = clampTokens(config, maxTokens);
  switch (config.provider) {
    case "claude":  return callClaude(config, system, user, clamped);
    case "openai":  return callOpenAI(config, system, user, clamped);
    case "gemini":  return callGemini(config, system, user, clamped);
  }
}

function apiError(provider: string, model: string, status: number, body: unknown): Error {
  const msg = (body as { error?: { message?: string } })?.error?.message
    ?? JSON.stringify(body).slice(0, 200);
  return new Error(`[${provider}] ${status} — model: ${model}\n${msg}`);
}

async function callClaude(cfg: LLMConfig, system: string, user: string, maxTokens: number) {
  const resp = await requestUrl({
    url: "https://api.anthropic.com/v1/messages",
    method: "POST",
    throw: false,
    headers: {
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (resp.status !== 200) throw apiError("Claude", cfg.model, resp.status, resp.json);
  const text = resp.json?.content?.[0]?.text;
  if (!text) throw new Error(`[Claude] Empty response. stop_reason: ${resp.json?.stop_reason}`);
  return text as string;
}

async function callOpenAI(cfg: LLMConfig, system: string, user: string, maxTokens: number) {
  const resp = await requestUrl({
    url: "https://api.openai.com/v1/chat/completions",
    method: "POST",
    throw: false,
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: cfg.model,
      max_completion_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (resp.status !== 200) throw apiError("OpenAI", cfg.model, resp.status, resp.json);
  const text = resp.json?.choices?.[0]?.message?.content;
  if (!text) throw new Error(`[OpenAI] Empty response. finish_reason: ${resp.json?.choices?.[0]?.finish_reason}`);
  return text as string;
}

async function callGemini(cfg: LLMConfig, system: string, user: string, maxTokens: number) {
  const resp = await requestUrl({
    url: `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${cfg.apiKey}`,
    method: "POST",
    throw: false,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        // Prevent safety blocks from terminating mid-generation
        stopSequences: [],
      },
    }),
  });
  if (resp.status !== 200) throw apiError("Gemini", cfg.model, resp.status, resp.json);

  const candidates = resp.json?.candidates;
  if (!candidates?.length) {
    const blockReason = resp.json?.promptFeedback?.blockReason ?? "unknown";
    throw new Error(`[Gemini] No candidates returned. Block reason: ${blockReason}`);
  }

  const candidate = candidates[0];
  const finishReason: string = candidate?.finishReason ?? "";
  const text: string = candidate?.content?.parts?.[0]?.text ?? "";

  if (!text) {
    throw new Error(`[Gemini] Empty content. Finish reason: ${finishReason}`);
  }

  // If cut off by token limit, warn but still return what we got
  if (finishReason === "MAX_TOKENS") {
    console.warn(`[Gemini] Section hit MAX_TOKENS — returned partial content`);
  }

  return text;
}

// ---------------------------------------------------------------------------
// Essay style system prompts
// ---------------------------------------------------------------------------

const AEON_SYSTEM = `You are a staff writer for Aeon Magazine. Your task is to retell the ideas in a video transcript in Aeon's distinctive voice — literary, unhurried, intellectually curious.

Rules:
- Follow the video's own logic and sequence of ideas. Do not invent a new argument structure.
- Cover ALL the ideas in your assigned transcript excerpt. Do not skip or compress content — if the video spent time on it, the essay must too.
- Never repeat a point already made in a previous section.
- Ground abstract ideas in concrete human experience. Use vivid prose, not academic summary.
- Subheadings should be evocative phrases that reflect what the section actually covers, not generic labels.
- Write as much as the content requires — a long video deserves a long essay. Do not cut ideas short.`;

const NYPHILOSOPHER_SYSTEM = `당신은 《뉴 필로소퍼(New Philosopher)》 한국어판 철학 에세이 작가입니다.

역할: 영상 트랜스크립트의 내용을 뉴필로소퍼 문체로 다시 쓰는 것. 내용을 창작하거나 부풀리는 것이 아닙니다.

규칙:
- 영상이 전개하는 논리와 흐름을 그대로 따르세요. 새로운 논증 구조를 만들지 마세요.
- 이미 다룬 내용을 반복하지 마세요. 쓸 내용이 없으면 억지로 늘리지 마세요.
- 철학적 개념을 구체적 장면이나 질문으로 열되, 영상에 없는 내용을 추가하지 마세요.
- 소제목은 해당 섹션의 실제 내용을 반영하는 명상적·질문형 문구로 짓되, 과장하지 마세요.
- 문체는 사변적이고 서정적이되 논리적 흐름을 잃지 않습니다.`;

const SYS = (lang: EssayLanguage) => (lang === "en" ? AEON_SYSTEM : NYPHILOSOPHER_SYSTEM);

// ---------------------------------------------------------------------------
// Step 1: Condense long transcripts, then build outline
// ---------------------------------------------------------------------------

interface OutlineSection { title: string; summary: string; }
interface EssayOutline {
  essayTitle: string;
  introduction: string;
  sections: OutlineSection[];
  conclusion: string;
}

async function buildOutline(
  cfg: LLMConfig,
  transcript: string,
  lang: EssayLanguage,
  sourceTitle: string,
  qp: QualityParams,
  onStatus: (s: string) => void
): Promise<EssayOutline> {
  const chunks = chunkText(transcript, 24000);
  let condensed = transcript;

  // For long transcripts, summarise each chunk first
  if (chunks.length > 1) {
    const summaries: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      onStatus(
        lang === "en"
          ? `Condensing transcript part ${i + 1}/${chunks.length}…`
          : `트랜스크립트 요약 중 ${i + 1}/${chunks.length}…`
      );
      const s = await llmCall(
        cfg,
        lang === "en"
          ? "You are a precise summariser. Preserve every distinct topic and argument so nothing is lost when the summary is used to write an essay."
          : "당신은 정확한 요약 전문가입니다. 이후 에세이 작성에 쓰일 요약이므로 모든 개별 주제와 논점이 손실 없이 보존되어야 합니다.",
        lang === "en"
          ? `Summarise this transcript excerpt (part ${i + 1}/${chunks.length}). List every topic in order with enough detail to reconstruct the ideas later:\n\n${chunks[i]}`
          : `다음 트랜스크립트 조각(${i + 1}/${chunks.length}번째)을 순서대로, 나중에 재구성 가능한 수준으로 요약하세요:\n\n${chunks[i]}`,
        qp.chunkSummaryTokens
      );
      summaries.push(s);
    }
    condensed = summaries.join("\n\n---\n\n");
  }

  onStatus(lang === "en" ? "Building essay outline…" : "에세이 개요 구성 중…");

  const prompt =
    lang === "en"
      ? `Read the transcript below and map it into an Aeon essay outline. The outline must mirror the VIDEO'S actual structure and sequence — do not invent themes or merge/skip distinct ideas.

Output ONLY lines in the format  KEY:: value  (one per line, no markdown, no extra text).

TITLE:: a literary essay title capturing the video's core idea
INTRO:: one sentence: the opening hook or scene
SECTION_1_TITLE:: evocative subheading for what the video covers first
SECTION_1_SUMMARY:: specific content this section covers (one sentence)
SECTION_2_TITLE:: ...
SECTION_2_SUMMARY:: ...
... (keep adding sections until ALL topics in the transcript are accounted for)
CONCLUSION:: one sentence: how the essay closes

How many sections: decide based on how many distinct topics the video covers. A 10-minute video might need 3–4 sections. A 30-minute video typically needs 6–8. A 60-minute video may need 10 or more. Never merge unrelated topics into one section just to reduce the count. Every major idea in the transcript must appear in a section summary.

TRANSCRIPT:
${condensed}`
      : `영상 "${sourceTitle}"의 실제 전개 흐름을 에세이 개요로 옮기세요. 영상에 없는 새로운 섹션이나 주제를 만들지 마세요.

반드시 아래 형식으로만 출력하세요. 각 줄은  키:: 값  형태. 마크다운·JSON·추가 텍스트 없이:

TITLE:: 영상의 핵심 아이디어를 담은 철학적·시적 제목
INTRO:: 서두 장면/질문 (한 문장, 영상 내용 기반)
SECTION_1_TITLE:: 영상이 실제로 먼저 다루는 내용을 반영한 소제목
SECTION_1_SUMMARY:: 이 섹션 내용 (한 문장, 트랜스크립트 기반)
SECTION_2_TITLE:: ...
SECTION_2_SUMMARY:: ...
(영상의 자연스러운 구조에 맞게 섹션 수 결정 — 보통 3–6개)
CONCLUSION:: 에세이 마무리 방향 (한 문장)

섹션 수는 영상 내용이 실제로 요구하는 만큼만 사용하세요. 분량 채우기용 섹션 추가 금지.

트랜스크립트:
${condensed}`;

  const raw = await llmCall(cfg, SYS(lang), prompt, qp.outlineMaxTokens);
  const outline = parseOutline(raw);
  // Respect maxSections cap for the chosen quality preset
  if (outline.sections.length > qp.maxSections) {
    outline.sections = outline.sections.slice(0, qp.maxSections);
  }
  return outline;
}

// ---------------------------------------------------------------------------
// Step 2: Write each body section
// ---------------------------------------------------------------------------

async function writeSection(
  cfg: LLMConfig,
  lang: EssayLanguage,
  outline: EssayOutline,
  index: number,
  fullTranscript: string,
  prevText: string,
  qp: QualityParams
): Promise<string> {
  const section = outline.sections[index];
  const n = outline.sections.length;

  const sliceSize = Math.ceil(fullTranscript.length / n);
  const overlap   = Math.ceil(sliceSize * qp.overlapRatio);
  const start = Math.max(0, Math.floor((index / n) * fullTranscript.length) - overlap);
  const end   = Math.min(start + qp.excerptMaxChars, fullTranscript.length);
  const excerpt = fullTranscript.slice(start, end);

  const prompt =
    lang === "en"
      ? `You are writing section ${index + 1} of ${n} for the Aeon essay titled "${outline.essayTitle}".

FULL OUTLINE (for context — each section covers only its own topic):
${outline.sections.map((s, i) => `${i + 1}. ${s.title}: ${s.summary}`).join("\n")}

${prevText ? `PREVIOUS TEXT (last 800 chars — do NOT repeat any of this):\n…${prevText.slice(-800)}\n` : ""}
CURRENT SECTION: "${section.title}"
${index === 0 ? "Open with a vivid hook — a scene, anecdote, or provocative question that draws the reader in." : "Continue naturally from the previous section."}

Your job: rewrite the TRANSCRIPT EXCERPT below in Aeon's literary voice.
- Cover EVERY idea and argument in the excerpt. Do not skip or compress anything that the video actually discusses.
- Do NOT repeat ideas from previous sections.
- Write as much as the excerpt requires — this is a long-form essay, not a summary.
- Output body text ONLY (no heading). Every sentence must be complete.

TRANSCRIPT EXCERPT FOR THIS SECTION:
${excerpt}`
      : `뉴필로소퍼 에세이 "${outline.essayTitle}"의 ${index + 1}번째 섹션(전체 ${n}개)을 작성합니다.

개요:
${outline.sections.map((s, i) => `${i + 1}. ${s.title}: ${s.summary}`).join("\n")}

${prevText ? `이전 본문 (마지막 600자 — 이 내용을 절대 반복하지 마세요):\n…${prevText.slice(-600)}\n` : ""}
현재 섹션: "${section.title}"
${index === 0 ? "일상의 장면이나 철학적 질문으로 에세이를 여세요." : "이전 섹션에서 자연스럽게 이어지세요."}

아래 트랜스크립트 내용을 뉴필로소퍼 문체로 다시 쓰세요. 트랜스크립트가 실제로 말하는 내용만 다루세요. 이전 섹션에서 이미 다룬 내용은 반복하지 마세요. 소제목 없이 본문만 출력하세요. 반드시 마지막 문장을 완전히 끝내세요.

이 섹션의 트랜스크립트:
${excerpt}`;

  const modelMax = MODEL_MAX_OUTPUT[cfg.model] ?? 4096;
  const outTokens = qp.sectionOutputTokens > 0
    ? Math.min(qp.sectionOutputTokens, modelMax)
    : modelMax;
  return (await llmCall(cfg, SYS(lang), prompt, outTokens)).trim();
}

// ---------------------------------------------------------------------------
// Step 3: Write introduction and conclusion
// ---------------------------------------------------------------------------

async function writeIntroOrConclusion(
  cfg: LLMConfig,
  lang: EssayLanguage,
  outline: EssayOutline,
  bodyText: string,
  type: "introduction" | "conclusion"
): Promise<string> {
  const prompt =
    lang === "en"
      ? type === "introduction"
        ? `Write the opening paragraph(s) for the Aeon essay "${outline.essayTitle}".
Direction: ${outline.introduction}
Hook the reader with a scene or question. Establish the essay's intellectual direction. Do not summarise what follows — just open the door.
Output introduction text ONLY. End every sentence completely.`
        : `Write the closing paragraph(s) for the Aeon essay "${outline.essayTitle}".
Direction: ${outline.conclusion}
Do NOT summarise the essay. Return to the opening image or question if possible, then open onto a wider horizon. Leave the reader with something to think about.

ESSAY BODY (final portion):
${bodyText.slice(-2000)}

Output conclusion text ONLY. End every sentence completely.`
      : type === "introduction"
      ? `에세이 "${outline.essayTitle}"의 서론을 작성하세요.
방향: ${outline.introduction}
독자를 끌어들이는 장면이나 질문으로 시작하고 에세이의 사유 방향을 암시하세요. 본문을 요약하지 마세요 — 그냥 문을 열면 됩니다.
서론 본문만 출력하세요. 반드시 완전한 문장으로 마무리하세요.`
      : `에세이 "${outline.essayTitle}"의 결론을 작성하세요.
방향: ${outline.conclusion}
본문을 요약하지 마세요. 가능하면 서두의 이미지나 질문으로 돌아오며 더 큰 지평을 열어 마무리하세요.

본문 마지막 부분:
${bodyText.slice(-2000)}

결론 본문만 출력하세요. 반드시 완전한 문장으로 마무리하세요.`;

  return (await llmCall(cfg, SYS(lang), prompt, 2000)).trim();
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function generateEssay(
  provider: ApiProvider,
  apiKey: string,
  model: string,
  transcript: string,
  language: EssayLanguage,
  sourceTitle: string,
  quality: EssayQuality,
  onProgress: (p: EssayGenerationProgress) => void
): Promise<string> {
  const cfg: LLMConfig = { provider, apiKey, model };
  const qp = QUALITY_PARAMS[quality];
  const onStatus = (step: string) => onProgress({ step, current: 0, total: 100 });

  // ── 1. Outline ─────────────────────────────────────────────────────────────
  const outline = await buildOutline(cfg, transcript, language, sourceTitle, qp, onStatus);

  const totalSteps = outline.sections.length + 2;
  let done = 0;
  const tick = (step: string) => {
    done++;
    onProgress({ step, current: Math.round((done / totalSteps) * 100), total: 100 });
  };

  // ── 2. Introduction ────────────────────────────────────────────────────────
  tick(language === "en" ? "Writing introduction…" : "서론 작성 중…");
  const intro = await writeIntroOrConclusion(cfg, language, outline, "", "introduction");

  // ── 3. Body sections ───────────────────────────────────────────────────────
  const bodies: string[] = [];
  for (let i = 0; i < outline.sections.length; i++) {
    tick(
      language === "en"
        ? `Writing section ${i + 1}/${outline.sections.length}: "${outline.sections[i].title}"`
        : `섹션 ${i + 1}/${outline.sections.length} 작성 중: "${outline.sections[i].title}"`
    );
    const text = await writeSection(cfg, language, outline, i, transcript, bodies.join("\n\n"), qp);
    bodies.push(text);
  }

  // ── 4. Conclusion ──────────────────────────────────────────────────────────
  tick(language === "en" ? "Writing conclusion…" : "결론 작성 중…");
  const conclusion = await writeIntroOrConclusion(
    cfg, language, outline, bodies.join("\n\n"), "conclusion"
  );

  // ── Assemble markdown ──────────────────────────────────────────────────────
  const styleTag = language === "en" ? "AEON Essay" : "뉴필로소퍼 에세이";
  const now = new Date().toISOString().slice(0, 10);

  // Sanitize for YAML: escape double-quotes so frontmatter doesn't break
  const safeTitle = outline.essayTitle.replace(/"/g, '\\"');

  const toc = outline.sections.map((s, i) => `${i + 1}. ${s.title}`).join("\n");

  const body = outline.sections
    .map((s, i) => `## ${s.title}\n\n${bodies[i]}`)
    .join("\n\n---\n\n");

  return `---
title: "${safeTitle}"
source: "${sourceTitle}"
generated: "${now}"
style: "${styleTag}"
language: "${language}"
provider: "${provider}"
model: "${model}"
---

# ${outline.essayTitle}

> *${styleTag} — based on: ${sourceTitle}*

## ${language === "en" ? "Contents" : "목차"}

${toc}

---

${intro}

---

${body}

---

## ${language === "en" ? "Closing Reflection" : "나오며"}

${conclusion}

---

*${language === "en" ? "Source" : "출처"}: ${sourceTitle} · ${now} · ${styleTag}*
`;
}
