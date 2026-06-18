import { requestUrl } from "obsidian";
import type { ApiProvider } from "./settings";

export type EssayLanguage = "en" | "ko";

export interface EssayGenerationProgress {
  step: string;
  current: number;
  total: number;
}

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
// Provider-agnostic LLM call (uses Obsidian requestUrl — works on mobile)
// ---------------------------------------------------------------------------

interface LLMConfig {
  provider: ApiProvider;
  apiKey: string;
  model: string;
}

async function llmCall(
  config: LLMConfig,
  system: string,
  user: string,
  maxTokens = 2000
): Promise<string> {
  switch (config.provider) {
    case "claude":  return callClaude(config, system, user, maxTokens);
    case "openai":  return callOpenAI(config, system, user, maxTokens);
    case "gemini":  return callGemini(config, system, user, maxTokens);
  }
}

async function callClaude(cfg: LLMConfig, system: string, user: string, maxTokens: number) {
  const resp = await requestUrl({
    url: "https://api.anthropic.com/v1/messages",
    method: "POST",
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
  if (resp.status !== 200)
    throw new Error(`Claude API ${resp.status}: ${JSON.stringify(resp.json?.error ?? resp.json)}`);
  return resp.json.content[0].text as string;
}

async function callOpenAI(cfg: LLMConfig, system: string, user: string, maxTokens: number) {
  const resp = await requestUrl({
    url: "https://api.openai.com/v1/chat/completions",
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (resp.status !== 200)
    throw new Error(`OpenAI API ${resp.status}: ${JSON.stringify(resp.json?.error ?? resp.json)}`);
  return resp.json.choices[0].message.content as string;
}

async function callGemini(cfg: LLMConfig, system: string, user: string, maxTokens: number) {
  const resp = await requestUrl({
    url: `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${cfg.apiKey}`,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });
  if (resp.status !== 200)
    throw new Error(`Gemini API ${resp.status}: ${JSON.stringify(resp.json?.error ?? resp.json)}`);
  return resp.json.candidates[0].content.parts[0].text as string;
}

// ---------------------------------------------------------------------------
// Essay style system prompts
// ---------------------------------------------------------------------------

const AEON_SYSTEM = `You are a staff writer for Aeon Magazine — the digital publication celebrated for long-form essays blending philosophy, science, psychology, and culture. Your essays are:
- Richly narrative: opening with a vivid scene, anecdote, or provocative claim that draws the reader in immediately
- Intellectually rigorous yet accessible: abstract ideas always grounded in concrete human experience
- Exploratory in structure: following the arc of thought rather than a textbook schema; subheadings read like evocative chapter titles, not dry labels
- Comprehensive: Aeon essays run 3,000–6,000 words; every significant idea from the source must find a place
- Written in a literary, unhurried voice with occasional first-person reflection and direct address to the reader

You will be given source material (a video transcript). Synthesise ALL of its ideas into one unified essay. Do not omit any significant concept or argument.`;

const NYPHILOSOPHER_SYSTEM = `당신은 《뉴 필로소퍼(New Philosopher)》 한국어판 철학 에세이 작가입니다. 이 잡지 에세이의 특징:
- 철학적 개념을 일상의 구체적 장면이나 질문으로 열어 독자가 자신의 삶 속에서 사유를 시작하도록 초대합니다
- 소크라테스, 칸트, 하이데거, 푸코 등 철학 전통과의 대화를 자연스럽게 녹여 넣되 현대적 맥락과 연결합니다
- 수사적 질문을 적절히 사용해 독자의 내면적 성찰을 유도합니다
- 소제목은 질문형이거나 명상적인 문구로, 단순한 목차 이상의 의미를 담습니다
- 분량은 충분히 길게(4,000자 이상) 원본 자료의 모든 핵심 내용을 빠짐없이 담습니다
- 문체는 사변적이고 서정적이되 논리적 흐름을 잃지 않습니다

주어진 자료(트랜스크립트)의 모든 중요한 개념과 논점을 하나의 통합된 에세이로 녹여내세요. 어떤 내용도 누락하지 마세요.`;

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
          ? "You are a precise summariser. Extract every distinct concept, argument, and example."
          : "당신은 정확한 요약 전문가입니다. 모든 개별 개념, 논점, 사례를 빠짐없이 추출하세요.",
        lang === "en"
          ? `Summarise the key ideas in this transcript excerpt (part ${i + 1}/${chunks.length}) in 500 words. Preserve all distinct concepts:\n\n${chunks[i]}`
          : `다음 트랜스크립트 조각(${i + 1}/${chunks.length}번째)의 핵심 개념을 모두 보존하면서 600자 이내로 요약하세요:\n\n${chunks[i]}`,
        800
      );
      summaries.push(s);
    }
    condensed = summaries.join("\n\n---\n\n");
  }

  onStatus(lang === "en" ? "Building essay outline…" : "에세이 개요 구성 중…");

  const prompt =
    lang === "en"
      ? `Create a detailed outline for an Aeon-style long-form essay based on the following transcript from "${sourceTitle}".

Return ONLY valid JSON (no markdown fences):
{
  "essayTitle": "A compelling, literary title",
  "introduction": "One paragraph: the opening hook and thesis arc",
  "sections": [
    { "title": "Evocative subheading", "summary": "What this section covers (2–3 sentences)" }
  ],
  "conclusion": "One paragraph: how the essay closes and what resonance it leaves"
}

ALL ideas from the source must be distributed across sections. Use 5–8 sections.

TRANSCRIPT CONTENT:
${condensed}`
      : `다음 트랜스크립트("${sourceTitle}") 내용을 바탕으로 뉴필로소퍼 스타일 철학 에세이 개요를 작성하세요.

유효한 JSON만 반환하세요 (마크다운 펜스 없이):
{
  "essayTitle": "철학적이고 시적인 에세이 제목",
  "introduction": "도입부 설명 — 서두의 장면/질문과 주제의식 묘사 (한 단락)",
  "sections": [
    { "title": "성찰적 소제목 (질문형 또는 명상적 문구)", "summary": "이 섹션에서 다룰 내용 (2–3문장)" }
  ],
  "conclusion": "결론부 설명 — 에세이가 어떻게 닫히는지 (한 단락)"
}

원본 자료의 모든 개념이 섹션에 분배되어야 합니다. 섹션은 5–8개 사용하세요.

트랜스크립트 내용:
${condensed}`;

  const raw = await llmCall(cfg, SYS(lang), prompt, 2048);
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Could not parse outline JSON from model response.");
  return JSON.parse(match[0]) as EssayOutline;
}

// ---------------------------------------------------------------------------
// Step 2: Write each body section
// ---------------------------------------------------------------------------

async function writeSection(
  cfg: LLMConfig,
  lang: EssayLanguage,
  outline: EssayOutline,
  index: number,
  chunks: string[],
  prevText: string
): Promise<string> {
  const section = outline.sections[index];
  // Map section index to a proportional chunk of the transcript
  const chunkIndex = Math.min(
    Math.floor((index / outline.sections.length) * chunks.length),
    chunks.length - 1
  );

  const prompt =
    lang === "en"
      ? `You are writing section ${index + 1} of ${outline.sections.length} for the Aeon essay titled "${outline.essayTitle}".

FULL OUTLINE:
${outline.sections.map((s, i) => `${i + 1}. ${s.title}: ${s.summary}`).join("\n")}

${prevText ? `PREVIOUS TEXT (last 1200 chars for continuity):\n…${prevText.slice(-1200)}\n` : ""}
CURRENT SECTION: "${section.title}"
Focus: ${section.summary}
${index === 0 ? "Open with a vivid hook — a scene, anecdote, or provocative question." : ""}

Write 450–700 words of polished Aeon prose. Output body text ONLY — no heading, no title.

RELEVANT TRANSCRIPT EXCERPT:
${chunks[chunkIndex]}`
      : `뉴필로소퍼 에세이 "${outline.essayTitle}"의 ${index + 1}번째 섹션(전체 ${outline.sections.length}개)을 작성합니다.

전체 개요:
${outline.sections.map((s, i) => `${i + 1}. ${s.title}: ${s.summary}`).join("\n")}

${prevText ? `이전 본문 (연속성을 위한 마지막 1200자):\n…${prevText.slice(-1200)}\n` : ""}
현재 섹션: "${section.title}"
핵심 내용: ${section.summary}
${index === 0 ? "에세이를 끌어당기는 일상의 장면이나 철학적 질문으로 시작하세요." : ""}

700–1000자의 세련된 뉴필로소퍼 문체로 작성하세요. 소제목 없이 본문만 출력하세요.

관련 트랜스크립트 발췌:
${chunks[chunkIndex]}`;

  return (await llmCall(cfg, SYS(lang), prompt, 1600)).trim();
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
        ? `Write the INTRODUCTION for the Aeon essay "${outline.essayTitle}".
Blueprint: ${outline.introduction}
Open with a vivid scene or provocative claim, establish intellectual stakes, hint at what follows.
200–350 words. Output introduction text ONLY.`
        : `Write the CONCLUSION for the Aeon essay "${outline.essayTitle}".
Blueprint: ${outline.conclusion}
Return to the opening image or question, close resonantly, open onto a wider horizon. Avoid pat summaries.

ESSAY BODY (final portion for context):
${bodyText.slice(-2500)}

200–350 words. Output conclusion text ONLY.`
      : type === "introduction"
      ? `에세이 "${outline.essayTitle}"의 서론을 작성하세요.
방향: ${outline.introduction}
일상의 장면이나 철학적 질문으로 시작하고 에세이의 사유 방향을 제시한 뒤 이어질 내용을 암시하세요.
300–500자. 서론 본문만 출력하세요.`
      : `에세이 "${outline.essayTitle}"의 결론을 작성하세요.
방향: ${outline.conclusion}
서두의 이미지나 질문으로 돌아오며 울림 있게 마무리하되 더 큰 지평을 열어야 합니다. 단순 요약은 피하세요.

본문 마지막 부분:
${bodyText.slice(-2500)}

300–500자. 결론 본문만 출력하세요.`;

  return (await llmCall(cfg, SYS(lang), prompt, 1000)).trim();
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
  onProgress: (p: EssayGenerationProgress) => void
): Promise<string> {
  const cfg: LLMConfig = { provider, apiKey, model };
  const onStatus = (step: string) => onProgress({ step, current: 0, total: 100 });

  // ── 1. Outline ─────────────────────────────────────────────────────────────
  const outline = await buildOutline(cfg, transcript, language, sourceTitle, onStatus);
  const chunks = chunkText(transcript, 24000);

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
    const text = await writeSection(cfg, language, outline, i, chunks, bodies.join("\n\n"));
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

  const toc = outline.sections.map((s, i) => `${i + 1}. ${s.title}`).join("\n");

  const body = outline.sections
    .map((s, i) => `## ${s.title}\n\n${bodies[i]}`)
    .join("\n\n---\n\n");

  return `---
title: "${outline.essayTitle}"
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
