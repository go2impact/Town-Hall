import express from "express";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || "3000");

app.use(express.json());

// --- Auth middleware for API endpoints ---
const API_KEY = process.env.COUNCIL_API_KEY || "";

function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!API_KEY) return next(); // No key = open (local dev)
  const provided = req.headers["x-api-key"] || req.headers["authorization"]?.replace("Bearer ", "");
  if (provided === API_KEY) return next();
  res.status(401).json({ error: "Invalid or missing API key" });
}

// --- Model Configuration ---

interface ModelConfig {
  name: string;
  color: string;
  provider: "openrouter" | "google";
  modelId: string;
  tier: "frontier" | "strong";
}

const MODELS: Record<string, ModelConfig> = {
  // Frontier tier — best-in-class reasoning
  claude:   { name: "Claude Opus 4.6",  color: "#5b9bf5", provider: "openrouter", modelId: "anthropic/claude-opus-4.6",          tier: "frontier" },
  gpt5:     { name: "GPT-5.4",          color: "#a78bfa", provider: "openrouter", modelId: "openai/gpt-5.4",                     tier: "frontier" },
  grok:     { name: "Grok 4",           color: "#1d9bf0", provider: "openrouter", modelId: "x-ai/grok-4",                        tier: "frontier" },
  // Strong tier — near-frontier, great value
  gemini:   { name: "Gemini 3.1 Pro",   color: "#34d399", provider: "openrouter", modelId: "google/gemini-3.1-pro-preview",       tier: "strong" },
  deepseek: { name: "DeepSeek V3.2",    color: "#fb923c", provider: "openrouter", modelId: "deepseek/deepseek-v3.2",             tier: "strong" },
};

// ─── BASE SYSTEM PROMPT ───
// No roles. No characters. No biases. Every model gets this identical prompt.
// The value comes from model diversity (different training, different strengths),
// NOT from forcing models into personas.
// Research: Role-playing "significantly underperforms almost any other baseline" (ICLR 2025)
const BASE_SYSTEM_PROMPT = `You are one of several AI models being asked this question simultaneously.
Each model will answer independently, then review each other's work.

RULES:
- Give your honest, complete analysis. Do not hedge to seem balanced.
- If you are confident, say so and say why. If uncertain, say where and why.
- Stand your ground. If other models disagree with you later, do NOT change your position
  just because of social pressure. Only update if they present NEW evidence or logic you missed.
- State your assumptions explicitly. If you're guessing about context, say so.
- End with a confidence score (0-100) and what single thing would most change your answer.
- The user is making real decisions, sometimes with real consequences. Get it right.

This is NOT a roleplay. You are not playing a character. You are an intelligence being consulted.
Think as deeply as you need to. There is no length limit.`;

// ─── STRUCTURAL MECHANISMS ───
// These are NOT roles — they're structural interventions applied to the process,
// not to individual model identities. Inspired by Du et al. 2023, Liang et al. 2023.

const BULLSHIT_DETECTOR_PROMPT = `You are reviewing the analyses below from multiple AI models.
Model identities have been anonymized — you're seeing "Model A", "Model B", etc.
This is intentional. Judge arguments by their quality, not by which model wrote them.

Your ONLY job: find where they're wrong, lazy, or agreeing too easily.

DO NOT add your own analysis of the original question.
DO NOT be contrarian for the sake of it.

Instead:
1. If all models agree, ask: is there a plausible scenario where they're ALL wrong? What are they all assuming?
2. If confidence scores are suspiciously high, challenge them. What evidence would they need to justify that confidence?
3. If any model changed its position between rounds, was it because of new logic or because of social pressure?
   Compare each model's Round 1 position to its Round 2 position — flag any shift that isn't justified by a NEW argument.
4. Call out any vague language, hedging, or "on the other hand" cop-outs.
5. Check for cascading agreement: did models converge on one position just because a majority held it?

Be specific. Quote the exact claim you're challenging. This is quality control, not participation.`;

const SYNTHESIS_PROMPT_TEMPLATE = `You are synthesizing a multi-model discussion into a clear recommendation.
You did NOT participate in the discussion. You are reading it fresh.

Your job is to extract the ANSWER, not summarize the debate.

1. **What we know for sure** — Facts all models confirmed with evidence.
2. **Best path** — The highest-probability correct answer, with reasoning.
3. **Key risk** — The one thing most likely to make this wrong.
4. **Where they disagreed** — And who had the stronger argument, with why.
5. **Confidence** — 0-100 score, with what would change it.
6. **Gridlock check** — If models fundamentally disagree and neither side has a knockout argument,
   say so honestly. "The models could not resolve this — here are the two viable paths and the tradeoffs."
   Do NOT force consensus where there isn't one.
7. **Next actions** — Specific, actionable steps.

Give the answer. Not a balanced summary. Not a debate recap. The answer.`;

// --- Cost tracking ---
// OpenRouter pricing per 1M tokens (approximate, updated March 2026)
// Pricing per 1M tokens from OpenRouter (March 2026)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "anthropic/claude-opus-4.6":          { input: 5, output: 25 },
  "openai/gpt-5.4":                     { input: 2.5, output: 15 },
  "x-ai/grok-4":                        { input: 3, output: 15 },
  "google/gemini-3.1-pro-preview":      { input: 2, output: 12 },
  "deepseek/deepseek-v3.2":             { input: 0.26, output: 0.38 },
};

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  cost: number; // in USD
}

// --- In-memory state ---
interface ThreadData {
  id: string;
  topic: string;
  status: "active" | "clarifying" | "awaiting_input" | "complete" | "saved";
  created: string;
  models: string[];
  messages: any[];
  stakes?: string;
  reversible?: boolean;
  recap?: string;
  systemContext?: string; // Human-injected system prompt / context
  totalCost: number;  // Running cost in USD
  startTime?: number; // ms timestamp
}

const threads = new Map<string, ThreadData>();
const clients = new Map<string, express.Response[]>();

const generateId = () => {
  const now = new Date();
  return now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
};

// --- SSE helpers ---
// Global SSE subscribers (for the /events endpoint the frontend uses — local dev only)
const globalClients: express.Response[] = [];

// Inline stream target — the response object for the current /start request
let inlineStreamTarget: express.Response | null = null;

function sendEvent(threadId: string, data: any) {
  const payload = `data: ${JSON.stringify({ ...data, thread_id: threadId })}\n\n`;

  // Send to inline stream target (serverless: the /start response itself)
  if (inlineStreamTarget) {
    try { inlineStreamTarget.write(payload); } catch {}
  }

  // Send to thread-specific subscribers
  const resArr = clients.get(threadId) || [];
  for (const res of resArr) {
    try { res.write(payload); } catch {}
  }

  // Send to global subscribers (local dev)
  for (const res of globalClients) {
    try { res.write(payload); } catch {}
  }
}

function addMessage(threadId: string, msg: any) {
  const thread = threads.get(threadId);
  if (thread) thread.messages.push({ ...msg, timestamp: new Date().toISOString() });
  sendEvent(threadId, msg);
}

// --- Model API calls ---
interface ModelResponse {
  text: string;
  usage: TokenUsage;
}

async function callOpenRouter(modelId: string, prompt: string, system: string): Promise<ModelResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("No OPENROUTER_API_KEY configured");

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.APP_URL || "https://council.cowork.ai",
      "X-Title": "Cowork Council",
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 16000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenRouter ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || "[No response]";

  // Extract token usage and calculate cost
  const promptTokens = data.usage?.prompt_tokens || 0;
  const completionTokens = data.usage?.completion_tokens || 0;
  const pricing = MODEL_PRICING[modelId] || { input: 5, output: 15 };
  const cost = (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000;

  return { text, usage: { promptTokens, completionTokens, cost } };
}

async function callGoogle(modelId: string, prompt: string, system: string): Promise<ModelResponse> {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("No GOOGLE_API_KEY or GEMINI_API_KEY configured");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
  const resp = await fetch(`${url}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 16000, temperature: 0.7 },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Google ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "[No response]";
  const promptTokens = data.usageMetadata?.promptTokenCount || 0;
  const completionTokens = data.usageMetadata?.candidatesTokenCount || 0;
  const pricing = MODEL_PRICING[modelId] || { input: 1, output: 4 };
  const cost = (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000;

  return { text, usage: { promptTokens, completionTokens, cost } };
}

async function callModel(key: string, prompt: string, systemOverride?: string): Promise<ModelResponse> {
  const cfg = MODELS[key];
  if (!cfg) throw new Error(`Unknown model: ${key}`);
  const system = systemOverride || BASE_SYSTEM_PROMPT;
  return cfg.provider === "google"
    ? callGoogle(cfg.modelId, prompt, system)
    : callOpenRouter(cfg.modelId, prompt, system);
}

// --- Structured Decision Engine ---

async function runDiscussion(threadId: string, topic: string, modelKeys: string[]) {
  const models = modelKeys.filter(k => MODELS[k]);
  if (models.length === 0) {
    addMessage(threadId, { type: "status", phase: "error", text: "No valid models selected." });
    return;
  }

  const thread = threads.get(threadId);
  if (!thread) return;

  const startTime = Date.now();
  thread.startTime = startTime;
  thread.totalCost = 0;

  // Helper to track cost and send running total
  const trackCost = (usage: TokenUsage) => {
    thread.totalCost += usage.cost;
    sendEvent(threadId, { type: "cost_update", totalCost: thread.totalCost, elapsed: (Date.now() - startTime) / 1000 });
  };

  // Inject human system context if provided
  const contextPrefix = thread.systemContext
    ? `\n\nAdditional context from the founder:\n${thread.systemContext}\n\n`
    : "";

  // ── ROUND 0: Clarifying Questions ──
  // Each model asks 1-3 clarifying questions to get more context before analysis
  addMessage(threadId, {
    type: "status", phase: "clarification",
    text: `Round 0 — Models are asking clarifying questions before diving in`,
  });

  const clarifyResults: { key: string; name: string; text: string }[] = [];

  const clarifyPromises = models.slice(0, 3).map(async (key) => {
    const cfg = MODELS[key];
    addMessage(threadId, { type: "message", role: "model", name: key, text: "Thinking about what to ask...", done: false });

    const clarifyPrompt = `The founder is asking: ${topic}${contextPrefix}

Before you analyze this, what 1-3 clarifying questions would help you give a MUCH better answer?

Think about:
- What assumptions are you making that might be wrong?
- What context would dramatically change your recommendation?
- What constraints or requirements aren't clear?

Be specific and brief. Format as a numbered list. Only ask questions that would genuinely change your analysis — don't ask obvious or filler questions.`;

    try {
      const response = await callModel(key, clarifyPrompt);
      trackCost(response.usage);
      addMessage(threadId, { type: "message", role: "model", name: key, text: response.text, done: true, phase: "clarification" });
      clarifyResults.push({ key, name: cfg.name, text: response.text });
    } catch (err: any) {
      addMessage(threadId, { type: "message", role: "model", name: key, text: `[Error: ${err.message}]`, done: true });
    }
  });

  await Promise.all(clarifyPromises);

  // Note: The clarifying questions are shown to the user. The user can always
  // follow up after the discussion with more context. We don't block the stream
  // waiting — this keeps the serverless single-request SSE pattern intact.
  // The questions become part of the discussion record.

  // Rebuild contextPrefix (in case systemContext was provided)
  const fullContextPrefix = thread.systemContext
    ? `\n\nAdditional context from the founder:\n${thread.systemContext}\n\n`
    : "";

  // ── ROUND 1: Parallel first-principles analysis ──
  addMessage(threadId, {
    type: "status", phase: "blind_draft",
    text: `Round 1 — First principles analysis across ${models.length} models`,
  });

  const round1Results: { key: string; name: string; text: string; error?: boolean }[] = [];

  const round1Promises = models.map(async (key) => {
    const cfg = MODELS[key];
    addMessage(threadId, { type: "message", role: "model", name: key, text: "Analyzing...", done: false });

    const prompt = `The founder is asking: ${topic}${fullContextPrefix}
Analyze from first principles:
1. What facts do we actually know? (not assumptions)
2. What are the real constraints?
3. What does the objective require?
4. What's the highest-probability correct path?
5. Confidence level (low/medium/high) and what would change your answer.

Get to the answer. No filler. Think as deeply as needed.`;

    try {
      const t0 = Date.now();
      const response = await callModel(key, prompt);
      trackCost(response.usage);
      console.log(`  ✅ ${cfg.name} responded (${((Date.now() - t0) / 1000).toFixed(0)}s, ${response.text.length} chars, $${response.usage.cost.toFixed(4)})`);
      addMessage(threadId, { type: "message", role: "model", name: key, text: response.text, done: true });
      round1Results.push({ key, name: cfg.name, text: response.text });
    } catch (err: any) {
      console.error(`  ❌ ${cfg.name} FAILED:`, err.message);
      addMessage(threadId, { type: "message", role: "model", name: key, text: `[Error: ${err.message}]`, done: true });
      round1Results.push({ key, name: cfg.name, text: `[Error]`, error: true });
    }
  });

  await Promise.all(round1Promises);

  const validR1 = round1Results.filter(r => !r.error);
  if (validR1.length < 1) {
    addMessage(threadId, { type: "status", phase: "error", text: "All models failed. Check API keys." });
    if (thread) thread.status = "complete";
    return;
  }

  // ── ROUND 2: Cross-examination — models review each other's work ──
  addMessage(threadId, {
    type: "status", phase: "targeted_debate",
    text: "Round 2 — Models reviewing each other's analyses.",
  });

  // ── CONFIDENCE HIDING ──
  // ConfidenceCal (IEEE BigDIA 2024) showed exposed confidence scores between agents
  // cause cascading over-confidence. We strip confidence lines before sharing between models.
  const stripConfidence = (text: string) =>
    text.replace(/\b[Cc]onfidence[:\s]*\d{1,3}\s*(?:\/\s*100|%|out of 100)?[^\n]*/g, "[confidence hidden]")
        .replace(/\b\d{1,3}\s*\/\s*100\b/g, "[score hidden]");

  const allPositions = validR1.map(r => `**${r.name}:** ${stripConfidence(r.text)}`).join("\n\n");
  const round2Results: { key: string; name: string; text: string }[] = [];

  const round2Promises = models.map(async (key) => {
    const cfg = MODELS[key];
    const ownR1 = validR1.find(r => r.key === key);

    addMessage(threadId, { type: "message", role: "model", name: key, text: "Reviewing...", done: false });

    const prompt = `The user asked: ${topic}${fullContextPrefix}

All Round 1 analyses from different models:
${allPositions}

${ownR1 ? `Your Round 1 analysis was: ${ownR1.text}` : ""}

Review the other models' analyses:
1. Where did another model identify something you missed? Acknowledge it specifically.
2. Where is another model factually wrong or reasoning poorly? Cite the exact claim and explain why.
3. Did any model make assumptions that could be wrong? Which ones?
4. Has seeing their analyses changed YOUR answer? If so, explain what NEW information or logic changed your mind.
   If NOT, explain why you're standing firm despite their arguments.
5. Updated confidence score (0-100) and what would change your answer.

IMPORTANT: Do NOT change your position just because other models disagree. Only update if you see
NEW evidence, logic, or a flaw in your own reasoning that you missed. If you still think you're right,
say so and explain why their counterarguments don't hold up.`;

    try {
      const response = await callModel(key, prompt);
      trackCost(response.usage);
      addMessage(threadId, { type: "message", role: "model", name: key, text: response.text, done: true });
      round2Results.push({ key, name: cfg.name, text: response.text });
    } catch (err: any) {
      addMessage(threadId, { type: "message", role: "model", name: key, text: `[Error: ${err.message}]`, done: true });
    }
  });

  await Promise.all(round2Promises);

  // ── ROUND 2.5: Bullshit Detector ──
  // A separate structural pass — NOT a role, NOT a participant.
  // Uses the highest-tier model to check for groupthink, lazy agreement, or weak reasoning.
  const tierPriority = ["frontier", "strong"];
  const bsDetectorKey = [...models].sort((a, b) => {
    const aTier = tierPriority.indexOf(MODELS[a]?.tier || "strong");
    const bTier = tierPriority.indexOf(MODELS[b]?.tier || "strong");
    return aTier - bTier;
  })[0] || "claude";

  const allR2 = round2Results.map(r => `**${r.name} (Round 2):** ${r.text}`).join("\n\n");

  // ── ANONYMIZATION for BS Detector ──
  // Research (Identity Bias in LLM Debate, 2025) shows stripping model identity
  // markers forces evaluation by argument quality rather than model authority.
  // We anonymize both rounds before feeding to the quality checker.
  const anonymousLabels = ["Model A", "Model B", "Model C", "Model D", "Model E"];
  const anonymizedR1 = validR1.map((r, i) => `**${anonymousLabels[i] || `Model ${i+1}`} (Round 1):** ${r.text}`).join("\n\n");
  const anonymizedR2 = round2Results.map((r, i) => `**${anonymousLabels[i] || `Model ${i+1}`} (Round 2):** ${r.text}`).join("\n\n");

  // Only run the BS detector if we have enough models for it to be meaningful
  let bsDetectorText = "";
  if (round2Results.length >= 2) {
    addMessage(threadId, {
      type: "status", phase: "quality_check",
      text: "Quality check — Scanning for groupthink, weak reasoning, or lazy agreement.",
    });

    addMessage(threadId, { type: "message", role: "model", name: "bs-detector", text: "Checking...", done: false });

    // Feed anonymized versions to BS detector — prevents model authority bias
    const bsPrompt = `The user asked: ${topic}

Round 1 (independent analyses — model identities anonymized):
${anonymizedR1}

Round 2 (after cross-examination — model identities anonymized):
${anonymizedR2}

${BULLSHIT_DETECTOR_PROMPT}`;

    try {
      const bsResponse = await callModel(bsDetectorKey, bsPrompt, BULLSHIT_DETECTOR_PROMPT);
      bsDetectorText = bsResponse.text;
      trackCost(bsResponse.usage);
      addMessage(threadId, { type: "message", role: "model", name: "bs-detector", text: bsDetectorText, done: true, phase: "quality_check" });
    } catch (err: any) {
      addMessage(threadId, { type: "message", role: "model", name: "bs-detector", text: `[Quality check error: ${err.message}]`, done: true });
    }
  }

  // ── ROUND 3: Synthesis and Recommendation ──
  // Uses a different model than the BS detector when possible, for independence.
  // The synthesizer is NOT a participant — it reads the discussion fresh.
  const synthCandidates = [...models].sort((a, b) => {
    const aTier = tierPriority.indexOf(MODELS[a]?.tier || "strong");
    const bTier = tierPriority.indexOf(MODELS[b]?.tier || "strong");
    return aTier - bTier;
  });
  // Pick a different model than the BS detector if we can
  const synthModelKey = synthCandidates.find(k => k !== bsDetectorKey) || synthCandidates[0] || "gpt5";

  addMessage(threadId, {
    type: "status", phase: "synthesizing",
    text: `Synthesis — ${MODELS[synthModelKey]?.name || synthModelKey} extracting the recommendation.`,
  });

  const synthPrompt = `The user asked: ${topic}

Round 1 (independent analyses):
${allPositions}

Round 2 (cross-examination):
${allR2}

${bsDetectorText ? `Quality Check (bullshit detector):\n${bsDetectorText}\n` : ""}

${SYNTHESIS_PROMPT_TEMPLATE}`;

  let synthesisText = "";
  let confidence = 75;
  let consensusType: "unanimous" | "additive" | "divergent" = "additive";

  try {
    const response = await callModel(synthModelKey, synthPrompt, SYNTHESIS_PROMPT_TEMPLATE);
    synthesisText = response.text;
    trackCost(response.usage);

    // Extract confidence from 0-100 score
    const confMatch = synthesisText.match(/\b(\d{1,3})(?:\/100|%|\s*(?:out of|\/)\s*100)\b/);
    if (confMatch) {
      confidence = Math.min(100, Math.max(0, parseInt(confMatch[1])));
    } else if (synthesisText.toLowerCase().includes("gridlock") || synthesisText.toLowerCase().includes("could not resolve")) {
      confidence = 35;
      consensusType = "divergent";
    } else if (synthesisText.includes("VERY HIGH") || /\b9[0-9]\b/.test(synthesisText)) {
      confidence = 92;
    } else if (synthesisText.includes("HIGH") || /\b8[0-9]\b/.test(synthesisText)) {
      confidence = 82;
    } else if (synthesisText.includes("MEDIUM") || /\b[56][0-9]\b/.test(synthesisText)) {
      confidence = 62;
    } else if (synthesisText.includes("LOW") || /\b[34][0-9]\b/.test(synthesisText)) {
      confidence = 40;
    }

    if (synthesisText.toLowerCase().includes("unanimous") || synthesisText.toLowerCase().includes("all models agree")) consensusType = "unanimous";
    else if (synthesisText.toLowerCase().includes("divergent") || synthesisText.toLowerCase().includes("gridlock") || synthesisText.toLowerCase().includes("could not resolve")) consensusType = "divergent";

    addMessage(threadId, { type: "message", role: "model", name: "moderator", text: synthesisText, done: true, synthesis: true });
  } catch (err: any) {
    synthesisText = `[Synthesis error: ${err.message}]`;
    addMessage(threadId, { type: "message", role: "model", name: "moderator", text: synthesisText, done: true });
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  sendEvent(threadId, {
    type: "recap",
    text: synthesisText,
    confidence,
    isConsensus: consensusType,
    recommendation: "See synthesis above.",
    keyCaveat: "Review confidence assessment.",
    nextStep: "Follow the Next Actions in the synthesis.",
    elapsedTime: `${elapsed}s`,
    estimatedCost: `$${thread.totalCost.toFixed(3)}`,
  });

  if (thread) {
    thread.status = "complete";
    thread.recap = synthesisText;
  }

  addMessage(threadId, { type: "status", phase: "complete", text: "Analysis complete. Type to ask follow-ups.", done: true });
}

async function handleFollowup(threadId: string, humanText: string, modelKeys?: string[]) {
  const thread = threads.get(threadId);
  if (!thread) return;

  const models = modelKeys || detectAddressedModels(humanText, thread.models);

  const recentMessages = thread.messages
    .filter((m: any) => !m.typing && m.text && m.text.length > 10)
    .slice(-20)
    .map((m: any) => `${m.name || m.role}: ${m.text}`)
    .join("\n\n");

  for (const key of models) {
    const cfg = MODELS[key];
    if (!cfg) continue;

    addMessage(threadId, { type: "message", role: "model", name: key, text: "Responding...", done: false });

    const prompt = `Original topic: ${thread.topic}

Recent conversation:
${recentMessages}

The user just said: "${humanText}"

Respond directly. If you made a previous argument in this discussion, maintain consistency with it
unless the user's new input gives you genuine reason to update.`;

    try {
      const response = await callModel(key, prompt);
      addMessage(threadId, { type: "message", role: "model", name: key, text: response.text, done: true });
    } catch (err: any) {
      addMessage(threadId, { type: "message", role: "model", name: key, text: `[Error: ${err.message}]`, done: true });
    }
  }
}

function detectAddressedModels(text: string, threadModels: string[]): string[] {
  const lower = text.toLowerCase();
  const nameMap: Record<string, string | null> = {
    claude: "claude", opus: "claude", gemini: "gemini", gpt: "gpt5", gpt5: "gpt5",
    deepseek: "deepseek", grok: "grok",
    all: null, everyone: null, "you all": null,
  };

  const addressed: string[] = [];
  for (const [name, key] of Object.entries(nameMap)) {
    if (lower.includes(name)) {
      if (key === null) return threadModels;
      if (!addressed.includes(key)) addressed.push(key);
    }
  }
  return addressed.length > 0 ? addressed : threadModels;
}

// --- Routes ---

app.post("/start", async (req, res) => {
  const topic = req.body.topic?.trim();
  const models = req.body.models || ["claude", "gemini", "gpt5", "deepseek"];
  const systemContext = req.body.systemContext?.trim();
  if (!topic) return res.status(400).json({ error: "No topic" });

  const tid = generateId();
  threads.set(tid, {
    id: tid, topic, status: "active", created: new Date().toISOString(),
    models, messages: [], stakes: req.body.stakes, reversible: req.body.reversible,
    systemContext, totalCost: 0,
  });

  // Stream SSE directly on this response (works in serverless)
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  // Send thread_id as first event so frontend knows it
  res.write(`data: ${JSON.stringify({ type: "thread_created", thread_id: tid, topic })}\n\n`);

  inlineStreamTarget = res;
  try {
    await runDiscussion(tid, topic, models);
  } catch (err: any) {
    console.error("Discussion error:", err);
    addMessage(tid, { type: "status", phase: "error", text: `Discussion error: ${err.message}` });
  } finally {
    inlineStreamTarget = null;
    res.end();
  }
});

// Programmatic API endpoint — agents call this
// sync=true (default for API callers): waits for full discussion, returns recap
// sync=false (default for UI): returns immediately, streams via SSE
app.post("/api/ask", requireApiKey, async (req, res) => {
  const question = req.body.question?.trim();
  const models = req.body.models || ["claude", "gemini", "gpt5", "deepseek"];
  const systemContext = req.body.systemContext?.trim();
  const sync = req.body.sync === true;

  if (!question) return res.status(400).json({ error: "No question" });

  const tid = generateId();
  threads.set(tid, {
    id: tid, topic: question, status: "active", created: new Date().toISOString(),
    models, messages: [], systemContext, totalCost: 0,
  });

  if (sync) {
    await runDiscussion(tid, question, models);
    const thread = threads.get(tid);
    res.json({
      thread_id: tid, status: "complete",
      recap: thread?.recap || "No recap generated.",
      messages: thread?.messages?.filter((m: any) => m.done && m.text && !m.typing) || [],
    });
  } else {
    // Stream SSE inline
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.write(`data: ${JSON.stringify({ type: "thread_created", thread_id: tid })}\n\n`);
    inlineStreamTarget = res;
    try {
      await runDiscussion(tid, question, models);
    } finally {
      inlineStreamTarget = null;
      res.end();
    }
  }
});

app.get("/threads", (req, res) => {
  res.json(Array.from(threads.values()).map(t => ({
    id: t.id, topic: t.topic, status: t.status,
    created: t.created, stakes: t.stakes, reversible: t.reversible,
  })));
});

app.post("/human", async (req, res) => {
  const tid = req.body.thread_id;
  const text = req.body.text?.trim();
  if (!text) return res.status(400).json({ error: "Empty" });

  const thread = threads.get(tid);
  if (!thread) return res.status(404).json({ error: "Thread not found" });

  // Stream SSE for follow-ups too
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  addMessage(tid, { type: "message", role: "human", name: "human", text, done: true });

  inlineStreamTarget = res;
  try {
    await handleFollowup(tid, text, req.body.models);
  } catch (err: any) {
    console.error("Followup error:", err);
  } finally {
    inlineStreamTarget = null;
    res.end();
  }
});

app.post("/save/:threadId", (req, res) => {
  const thread = threads.get(req.params.threadId);
  if (thread) thread.status = "saved";
  res.json({ success: true });
});

// Global SSE endpoint — frontend connects here
app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  globalClients.push(res);

  const interval = setInterval(() => {
    try { res.write(`data: ${JSON.stringify({ ping: true })}\n\n`); } catch { clearInterval(interval); }
  }, 25000);

  req.on("close", () => {
    clearInterval(interval);
    const idx = globalClients.indexOf(res);
    if (idx >= 0) globalClients.splice(idx, 1);
  });
});

// Per-thread SSE endpoint (for programmatic clients)
app.get("/stream/:threadId", (req, res) => {
  const threadId = req.params.threadId;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const existing = clients.get(threadId) || [];
  existing.push(res);
  clients.set(threadId, existing);

  const interval = setInterval(() => {
    try { res.write(`data: ${JSON.stringify({ ping: true })}\n\n`); } catch { clearInterval(interval); }
  }, 25000);

  req.on("close", () => {
    clearInterval(interval);
    const arr = clients.get(threadId) || [];
    clients.set(threadId, arr.filter(r => r !== res));
  });
});

app.get("/thread/:tid", (req, res) => {
  const thread = threads.get(req.params.tid);
  if (!thread) return res.status(404).json({ error: "Not found" });
  res.json({
    ...thread,
    messages: thread.messages.filter((m: any) => !m.typing && !m.ping),
  });
});

// Polling endpoint — alternative to SSE for serverless environments
app.get("/api/messages/:tid", (req, res) => {
  const thread = threads.get(req.params.tid);
  if (!thread) return res.status(404).json({ error: "Not found" });

  const since = parseInt(req.query.since as string) || 0;
  const msgs = thread.messages
    .filter((m: any, i: number) => i >= since && !m.typing && !m.ping)
    .map((m: any, i: number) => ({ ...m, index: since + i }));

  res.json({
    messages: msgs,
    status: thread.status,
    total: thread.messages.filter((m: any) => !m.typing && !m.ping).length,
    recap: thread.recap,
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    models: Object.keys(MODELS),
    threads: threads.size,
    hasOpenRouter: !!process.env.OPENROUTER_API_KEY,
    hasGoogle: !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY),
  });
});

// --- Start server (local dev only) ---
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      if (!req.path.startsWith("/api") && !req.path.startsWith("/stream")) {
        res.sendFile(path.join(distPath, "index.html"));
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🏛️  Cowork Council running on http://localhost:${PORT}`);
    console.log(`   Models: ${Object.values(MODELS).map(m => m.name).join(", ")}`);
    console.log(`   OpenRouter: ${process.env.OPENROUTER_API_KEY ? "✅" : "❌"}`);
    console.log(`   Google AI: ${process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY ? "✅" : "❌"}`);
    console.log(`   API Auth: ${API_KEY ? "✅ (key required)" : "⚠️  open (set COUNCIL_API_KEY)"}`);
  });
}

// On Vercel, export the app for serverless. Locally, start the server.
if (!process.env.VERCEL) {
  startServer();
}

export default app;
