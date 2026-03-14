import express from "express";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";
import { put, list } from "@vercel/blob";

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || "3000");

app.use(express.json({ limit: "100kb" }));

// --- Auth: simple password gate ---
const SITE_PASSWORD = process.env.COUNCIL_PASSWORD || "";
const API_KEY = process.env.COUNCIL_API_KEY || "";
// SESSION_SECRET must be stable across serverless invocations — derive from password if not set
const SESSION_SECRET = process.env.SESSION_SECRET ||
  (SITE_PASSWORD ? crypto.createHash("sha256").update("council-session-secret-" + SITE_PASSWORD).digest("hex") : crypto.randomBytes(32).toString("hex"));

// Cryptographically secure session tokens — random per login, HMAC-signed
function createSessionToken(): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(nonce).digest("hex");
  return `cs_${nonce}_${sig}`;
}

function verifySessionToken(token: string): boolean {
  const parts = token.match(/^cs_([a-f0-9]{32})_([a-f0-9]{64})$/);
  if (!parts) return false;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(parts[1]).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(parts[2], "hex"), Buffer.from(expected, "hex"));
}

// --- Login endpoint (must be before auth middleware) ---
app.post("/auth/login", (req, res) => {
  const password = req.body.password;
  if (!SITE_PASSWORD) {
    // No password set — open mode (local dev)
    res.json({ success: true });
    return;
  }
  if (typeof password !== "string") {
    return res.status(400).json({ error: "Password must be a string" });
  }
  // HMAC comparison — constant time regardless of password length
  const pwHash = crypto.createHmac("sha256", SESSION_SECRET).update(password).digest();
  const expectedHash = crypto.createHmac("sha256", SESSION_SECRET).update(SITE_PASSWORD).digest();
  if (crypto.timingSafeEqual(pwHash, expectedHash)) {
    const token = createSessionToken();
    const isProduction = process.env.VERCEL || process.env.NODE_ENV === "production";
    const securePart = isProduction ? " Secure;" : "";
    res.setHeader("Set-Cookie", `council_session=${token}; Path=/; HttpOnly; SameSite=Lax;${securePart} Max-Age=604800`);
    res.json({ success: true });
  } else {
    res.status(401).json({ error: "Wrong password" });
  }
});

// Health check — no auth required
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", models: Object.keys(MODELS).length });
});

// Apply auth to everything else
app.use((req, res, next) => {
  // Skip auth for login endpoint and health check
  if (req.path === "/auth/login" || req.path === "/api/health") return next();
  requireAuth(req, res, next);
});

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!SITE_PASSWORD) return next(); // No password = open (local dev)

  // Check cookie — HMAC-verified session token
  const cookies = req.headers.cookie || "";
  const tokenMatch = cookies.match(/council_session=([^;]+)/);
  if (tokenMatch && verifySessionToken(tokenMatch[1])) return next();

  // Check API key header (for programmatic access) — HMAC constant-time comparison
  if (API_KEY) {
    const authHeader = req.headers["authorization"] || "";
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    const provided = (req.headers["x-api-key"] as string) || bearerMatch?.[1] || "";
    if (provided) {
      const providedHash = crypto.createHmac("sha256", SESSION_SECRET).update(provided).digest();
      const expectedHash = crypto.createHmac("sha256", SESSION_SECRET).update(API_KEY).digest();
      if (crypto.timingSafeEqual(providedHash, expectedHash)) {
        return next();
      }
    }
  }

  // Not authenticated — if requesting HTML, serve login page; otherwise 401
  if (req.headers.accept?.includes("text/html") || req.path === "/") {
    return res.status(401).send(LOGIN_PAGE);
  }
  res.status(401).json({ error: "Not authenticated" });
}

// Login endpoint
const LOGIN_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cowork Council — Login</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0a0a0f; color: #e0e0e0; font-family: system-ui, -apple-system, sans-serif;
      display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .login-box { background: #1a1a2e; border: 1px solid #333; border-radius: 12px; padding: 40px;
      max-width: 400px; width: 90%; text-align: center; }
    .login-box h1 { font-size: 24px; margin-bottom: 8px; color: #fff; }
    .login-box p { color: #888; margin-bottom: 24px; font-size: 14px; }
    .login-box input { width: 100%; padding: 12px 16px; background: #0a0a0f; border: 1px solid #444;
      border-radius: 8px; color: #fff; font-size: 16px; margin-bottom: 16px; outline: none; }
    .login-box input:focus { border-color: #5b9bf5; }
    .login-box button { width: 100%; padding: 12px; background: #5b9bf5; color: #fff; border: none;
      border-radius: 8px; font-size: 16px; cursor: pointer; font-weight: 600; }
    .login-box button:hover { background: #4a8ae5; }
    .error { color: #f87171; font-size: 14px; margin-bottom: 12px; display: none; }
  </style>
</head>
<body>
  <div class="login-box">
    <h1>Cowork Council</h1>
    <p>Enter the password to continue</p>
    <div class="error" id="err">Wrong password</div>
    <form id="f">
      <input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password" />
      <button type="submit">Enter</button>
    </form>
  </div>
  <script>
    document.getElementById('f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = e.target.password.value;
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) { window.location.href = '/'; }
      else { document.getElementById('err').style.display = 'block'; }
    });
  </script>
</body>
</html>`;

function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!API_KEY) return next();
  const authHeader = req.headers["authorization"] || "";
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const provided = (req.headers["x-api-key"] as string) || bearerMatch?.[1] || "";
  if (provided) {
    const providedHash = crypto.createHmac("sha256", SESSION_SECRET).update(provided).digest();
    const expectedHash = crypto.createHmac("sha256", SESSION_SECRET).update(API_KEY).digest();
    if (crypto.timingSafeEqual(providedHash, expectedHash)) {
      return next();
    }
  }
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
  // Additional models
  llama:    { name: "Llama 4 Maverick", color: "#3b82f6", provider: "openrouter", modelId: "meta-llama/llama-4-maverick",         tier: "strong" },
  mistral:  { name: "Mistral Large",    color: "#f97316", provider: "openrouter", modelId: "mistralai/mistral-large-2411",        tier: "strong" },
  qwen:     { name: "Qwen3 235B",       color: "#ef4444", provider: "openrouter", modelId: "qwen/qwen3-235b-a22b",               tier: "strong" },
  sonnet:   { name: "Claude Sonnet 4.6",color: "#8b5cf6", provider: "openrouter", modelId: "anthropic/claude-sonnet-4.6",         tier: "strong" },
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

// --- Token estimation & truncation ---
// ~4 chars per token is a safe approximation for English text
const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

// Max input tokens we'll send to any model (conservative — DeepSeek context is small)
const MAX_ROUND_INPUT_TOKENS = 30_000;

// Truncate text to fit within a token budget, preserving start and end
function truncateToTokenBudget(text: string, maxTokens: number): string {
  const estimated = estimateTokens(text);
  if (estimated <= maxTokens) return text;
  const maxChars = maxTokens * 4;
  const keepStart = Math.floor(maxChars * 0.7);
  const keepEnd = Math.floor(maxChars * 0.25);
  return text.slice(0, keepStart) + "\n\n[... truncated for context limits ...]\n\n" + text.slice(-keepEnd);
}

// Truncate round results to fit within budget, proportionally per model
function truncateRoundResults(results: { key: string; name: string; text: string }[], totalBudget: number): string {
  const perModel = Math.floor(totalBudget / Math.max(results.length, 1));
  return results.map(r => `**${r.name}:** ${truncateToTokenBudget(r.text, perModel)}`).join("\n\n");
}

// --- Cost tracking ---
// OpenRouter pricing per 1M tokens (approximate, updated March 2026)
// Pricing per 1M tokens from OpenRouter (March 2026)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "anthropic/claude-opus-4.6":          { input: 5, output: 25 },
  "openai/gpt-5.4":                     { input: 2.5, output: 15 },
  "x-ai/grok-4":                        { input: 3, output: 15 },
  "google/gemini-3.1-pro-preview":      { input: 2, output: 12 },
  "deepseek/deepseek-v3.2":             { input: 0.26, output: 0.38 },
  "meta-llama/llama-4-maverick":        { input: 0.2, output: 0.6 },
  "mistralai/mistral-large-2411":       { input: 2, output: 6 },
  "qwen/qwen3-235b-a22b":              { input: 0.7, output: 3 },
  "anthropic/claude-sonnet-4.6":        { input: 3, output: 15 },
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
  status: "active" | "clarifying" | "awaiting_clarification" | "awaiting_input" | "complete" | "saved";
  created: string;
  models: string[];
  messages: any[];
  stakes?: string;
  reversible?: boolean;
  recap?: string;
  systemContext?: string; // Human-injected system prompt / context
  clarificationAnswers?: string; // User's answers to Round 0 questions
  totalCost: number;  // Running cost in USD
  startTime?: number; // ms timestamp
}

const threads = new Map<string, ThreadData>();
const clients = new Map<string, express.Response[]>();

const generateId = () => crypto.randomUUID();

// --- SSE helpers ---
// Global SSE subscribers (for the /events endpoint the frontend uses — local dev only)
const globalClients: express.Response[] = [];

// Per-thread stream targets — maps thread ID to the response object streaming its events
// This replaces the old single global `inlineStreamTarget` which caused cross-talk
// when Vercel reused a warm function instance for concurrent requests.
const threadStreamTargets = new Map<string, express.Response>();

function sendEvent(threadId: string, data: any) {
  const payload = `data: ${JSON.stringify({ ...data, thread_id: threadId })}\n\n`;

  // Send to this thread's stream target
  const target = threadStreamTargets.get(threadId);
  if (target) {
    try { target.write(payload); } catch {}
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

async function callOpenRouter(modelId: string, prompt: string, system: string, retries = 2, signal?: AbortSignal): Promise<ModelResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("No OPENROUTER_API_KEY configured");

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal,
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

      if (resp.status === 429 && attempt < retries) {
        const wait = (attempt + 1) * 3000;
        console.log(`  ⏳ ${modelId} rate limited, retrying in ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }

      if (resp.status >= 500 && attempt < retries) {
        const wait = (attempt + 1) * 2000;
        console.log(`  ⏳ ${modelId} server error (${resp.status}), retrying in ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`OpenRouter ${resp.status}: ${errText.slice(0, 200)}`);
      }

      const data = await resp.json();
      const text = data.choices?.[0]?.message?.content || "[No response]";

      const promptTokens = data.usage?.prompt_tokens || 0;
      const completionTokens = data.usage?.completion_tokens || 0;
      const pricing = MODEL_PRICING[modelId] || { input: 5, output: 15 };
      const cost = (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000;

      return { text, usage: { promptTokens, completionTokens, cost } };
    } catch (err: any) {
      if (attempt === retries) throw err;
      console.log(`  ⏳ ${modelId} failed (${err.message}), retrying...`);
      await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
    }
  }
  throw new Error(`${modelId} failed after ${retries + 1} attempts`);
}

async function callGoogle(modelId: string, prompt: string, system: string, signal?: AbortSignal): Promise<ModelResponse> {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("No GOOGLE_API_KEY or GEMINI_API_KEY configured");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
  const resp = await fetch(`${url}?key=${apiKey}`, {
    method: "POST",
    signal,
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

async function callModel(key: string, prompt: string, systemOverride?: string, timeoutMs = 240_000): Promise<ModelResponse> {
  const cfg = MODELS[key];
  if (!cfg) throw new Error(`Unknown model: ${key}`);
  const system = systemOverride || BASE_SYSTEM_PROMPT;

  // AbortController cancels the actual fetch on timeout (not just racing)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = cfg.provider === "google"
      ? await callGoogle(cfg.modelId, prompt, system, controller.signal)
      : await callOpenRouter(cfg.modelId, prompt, system, 2, controller.signal);
    return result;
  } catch (err: any) {
    if (err.name === "AbortError") {
      throw new Error(`${cfg.name} timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// --- Structured Recommendation Engine ---

// ── ROUND 0 ONLY: Ask clarifying questions, then pause for user input ──
async function runClarificationRound(threadId: string, topic: string, modelKeys: string[]) {
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

  const trackCost = (usage: TokenUsage) => {
    thread.totalCost += usage.cost;
    sendEvent(threadId, { type: "cost_update", totalCost: thread.totalCost, elapsed: (Date.now() - startTime) / 1000 });
  };

  const contextPrefix = thread.systemContext
    ? `\n\nAdditional context from the founder:\n${thread.systemContext}\n\n`
    : "";

  // ── ROUND 0: Clarifying Questions (single lead model) ──
  // One model asks — avoids redundant overlapping questions from 3+ models.
  // Prefer Claude (best at targeted clarification), fall back to first available.
  const leadModel = models.includes("claude") ? "claude" : models[0];
  const otherModels = models.filter(k => k !== leadModel);

  addMessage(threadId, {
    type: "status", phase: "clarification",
    text: `Round 0 — Asking clarifying questions before the analysis`,
  });

  // Lead model asks main clarifying questions
  addMessage(threadId, { type: "message", role: "model", name: leadModel, text: "Thinking about what to ask...", done: false });

  const clarifyPrompt = `The founder is asking: ${topic}${contextPrefix}

Before the council analyzes this, what 2-4 clarifying questions would help give a MUCH better answer?

Think about:
- What assumptions might be wrong?
- What context would dramatically change the recommendation?
- What constraints or requirements aren't clear?

Be specific, brief, and practical. Format as a numbered list. Only ask questions that would genuinely change the analysis — no filler.`;

  let leadQuestions = "";
  try {
    const response = await callModel(leadModel, clarifyPrompt);
    trackCost(response.usage);
    leadQuestions = response.text;
    addMessage(threadId, { type: "message", role: "model", name: leadModel, text: response.text, done: true, phase: "clarification" });
  } catch (err: any) {
    addMessage(threadId, { type: "message", role: "model", name: leadModel, text: `[Error: ${err.message}]`, done: true });
  }

  // Optional: one other model can add a brief follow-up if it spots a gap
  if (otherModels.length > 0 && leadQuestions) {
    const followupModel = otherModels[0];
    addMessage(threadId, { type: "message", role: "model", name: followupModel, text: "Checking if anything was missed...", done: false });

    const followupPrompt = `The founder is asking: ${topic}${contextPrefix}

Another advisor already asked these clarifying questions (DO NOT repeat any of them):

${leadQuestions}

Is there ONE critical question they missed that would significantly change the analysis? If so, ask it briefly (1-2 sentences). If they covered it well, just say "Good questions — nothing to add." Be extremely brief.`;

    try {
      const response = await callModel(followupModel, followupPrompt);
      trackCost(response.usage);
      addMessage(threadId, { type: "message", role: "model", name: followupModel, text: response.text, done: true, phase: "clarification" });
    } catch (err: any) {
      addMessage(threadId, { type: "message", role: "model", name: followupModel, text: `[Error: ${err.message}]`, done: true });
    }
  }

  // ── PAUSE: Wait for user to answer clarifying questions ──
  thread.status = "awaiting_clarification";
  addMessage(threadId, {
    type: "status", phase: "awaiting_clarification",
    text: "Answer the questions above to improve the analysis, or click Skip to proceed without answers.",
  });
}

// ── ROUNDS 1-3: Full analysis, cross-examination, BS check, synthesis ──
// Called after user answers clarifying questions (or skips)
async function runAnalysisRounds(threadId: string, topic: string, modelKeys: string[]) {
  const models = modelKeys.filter(k => MODELS[k]);
  if (models.length === 0) {
    addMessage(threadId, { type: "status", phase: "error", text: "No valid models selected." });
    return;
  }

  const thread = threads.get(threadId);
  if (!thread) return;

  // Resume timing from where we left off, or start fresh
  const startTime = thread.startTime || Date.now();
  if (!thread.startTime) thread.startTime = startTime;
  thread.status = "active";

  const trackCost = (usage: TokenUsage) => {
    thread.totalCost += usage.cost;
    sendEvent(threadId, { type: "cost_update", totalCost: thread.totalCost, elapsed: (Date.now() - startTime) / 1000 });
  };

  // Build context with clarification answers if provided
  let fullContextPrefix = thread.systemContext
    ? `\n\nAdditional context from the founder:\n${thread.systemContext}\n\n`
    : "";

  if (thread.clarificationAnswers) {
    fullContextPrefix += `\n\nThe founder answered the clarifying questions:\n${thread.clarificationAnswers}\n\n`;
  }

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

  // Token-budget-aware: truncate Round 1 results so Round 2 prompts don't overflow
  const r1Budget = Math.floor(MAX_ROUND_INPUT_TOKENS * 0.6); // 60% of budget for R1 content
  const allPositions = truncateRoundResults(
    validR1.map(r => ({ ...r, text: stripConfidence(r.text) })),
    r1Budget
  );
  const round2Results: { key: string; name: string; text: string }[] = [];

  const round2Promises = models.map(async (key) => {
    const cfg = MODELS[key];
    const ownR1 = validR1.find(r => r.key === key);

    addMessage(threadId, { type: "message", role: "model", name: key, text: "Reviewing...", done: false });

    const ownR1Text = ownR1 ? truncateToTokenBudget(ownR1.text, 3000) : "";
    const prompt = `The user asked: ${topic}${fullContextPrefix}

All Round 1 analyses from different models:
${allPositions}

${ownR1Text ? `Your Round 1 analysis was: ${ownR1Text}` : ""}

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

  // Validate Round 2 — if all models failed, fall through to synthesis with R1 data only
  if (round2Results.length === 0) {
    console.log("  ⚠️ All models failed in Round 2 — skipping to synthesis with Round 1 data only");
    addMessage(threadId, { type: "status", phase: "quality_check", text: "Round 2 failed — synthesizing from Round 1 data." });
  }

  // ── ROUND 2.5: Bullshit Detector ──
  // A separate structural pass — NOT a role, NOT a participant.
  // Uses the highest-tier model to check for groupthink, lazy agreement, or weak reasoning.
  const tierPriority = ["frontier", "strong"];
  const bsDetectorKey = [...models].sort((a, b) => {
    const aTier = tierPriority.indexOf(MODELS[a]?.tier || "strong");
    const bTier = tierPriority.indexOf(MODELS[b]?.tier || "strong");
    return aTier - bTier;
  })[0] || "claude";

  // Token-budget-aware Round 2 aggregation
  const r2Budget = Math.floor(MAX_ROUND_INPUT_TOKENS * 0.5);
  const allR2 = truncateRoundResults(
    round2Results.map(r => ({ ...r, name: `${r.name} (Round 2)` })),
    r2Budget
  );

  // ── ANONYMIZATION for BS Detector ──
  const anonymousLabels = ["Model A", "Model B", "Model C", "Model D", "Model E", "Model F", "Model G", "Model H", "Model I"];
  const anonR1Budget = Math.floor(MAX_ROUND_INPUT_TOKENS * 0.4);
  const anonR2Budget = Math.floor(MAX_ROUND_INPUT_TOKENS * 0.4);
  const anonymizedR1 = truncateRoundResults(
    validR1.map((r, i) => ({ ...r, key: r.key, name: `${anonymousLabels[i] || `Model ${i+1}`} (Round 1)` })),
    anonR1Budget
  );
  const anonymizedR2 = truncateRoundResults(
    round2Results.map((r, i) => ({ ...r, key: r.key, name: `${anonymousLabels[i] || `Model ${i+1}`} (Round 2)` })),
    anonR2Budget
  );

  // Only run the BS detector if we have enough models and reasonable time remaining.
  // Vercel has a 300s limit — only skip BS if we're really close to the wall.
  let bsDetectorText = "";
  const elapsedSoFar = (Date.now() - startTime) / 1000;
  const timeBudgetOk = elapsedSoFar < 260;

  if (round2Results.length >= 2 && timeBudgetOk) {
    addMessage(threadId, {
      type: "status", phase: "quality_check",
      text: "Quality check — Scanning for groupthink, weak reasoning, or lazy agreement.",
    });

    addMessage(threadId, { type: "message", role: "model", name: "bs-detector", text: "Checking...", done: false });

    // Feed anonymized versions to BS detector — prevents model authority bias
    // NOTE: BULLSHIT_DETECTOR_PROMPT is passed as system prompt via callModel, not duplicated here
    const bsPrompt = `The user asked: ${topic}

Round 1 (independent analyses — model identities anonymized):
${anonymizedR1}

Round 2 (after cross-examination — model identities anonymized):
${anonymizedR2}`;

    try {
      // Use remaining time minus buffer for synthesis — skip if we'd exceed Vercel limit
      const remainingForBs = (260 - elapsedSoFar) * 1000;
      if (remainingForBs <= 10_000) {
        throw new Error("Not enough time remaining — skipping to synthesis");
      }
      const bsTimeoutMs = Math.max(30_000, remainingForBs);
      const bsResponse = await callModel(bsDetectorKey, bsPrompt, BULLSHIT_DETECTOR_PROMPT, bsTimeoutMs);
      bsDetectorText = bsResponse.text;
      trackCost(bsResponse.usage);
      addMessage(threadId, { type: "message", role: "model", name: "bs-detector", text: bsDetectorText, done: true, phase: "quality_check" });
    } catch (err: any) {
      // BS detector is optional — if it times out, continue to synthesis
      console.log(`  ⚠️ BS detector failed: ${err.message} — skipping to synthesis`);
      addMessage(threadId, { type: "message", role: "model", name: "bs-detector", text: `[Quality check skipped: ${err.message}]`, done: true });
    }
  } else if (round2Results.length >= 2 && !timeBudgetOk) {
    console.log(`  ⚠️ Skipping BS detector — ${elapsedSoFar.toFixed(0)}s elapsed, need time for synthesis`);
    addMessage(threadId, { type: "message", role: "model", name: "bs-detector", text: "[Quality check skipped — time budget exceeded, proceeding to synthesis]", done: true });
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

  // NOTE: SYNTHESIS_PROMPT_TEMPLATE is passed as system prompt via callModel, not duplicated here
  const synthPrompt = `The user asked: ${topic}

Round 1 (independent analyses):
${allPositions}

Round 2 (cross-examination):
${allR2}

${bsDetectorText ? `Quality Check (bullshit detector):\n${bsDetectorText}\n` : ""}`;

  // Validate and truncate synthesis prompt if over budget
  const synthTokenEst = estimateTokens(synthPrompt);
  const finalSynthPrompt = synthTokenEst > MAX_ROUND_INPUT_TOKENS
    ? (console.log(`  ⚠️ Synthesis prompt ${synthTokenEst} tokens — over budget, truncating...`),
       truncateToTokenBudget(synthPrompt, MAX_ROUND_INPUT_TOKENS))
    : synthPrompt;

  let synthesisText = "";
  let confidence = 75;
  let consensusType: "unanimous" | "additive" | "divergent" = "additive";

  try {
    // Use remaining time budget, not hardcoded 240s
    const synthElapsed = (Date.now() - startTime) / 1000;
    const synthTimeoutMs = Math.max(60_000, (295 - synthElapsed) * 1000);
    console.log(`  ⏱️ Synthesis timeout: ${(synthTimeoutMs / 1000).toFixed(0)}s (${synthElapsed.toFixed(0)}s elapsed)`);
    const response = await callModel(synthModelKey, finalSynthPrompt, SYNTHESIS_PROMPT_TEMPLATE, synthTimeoutMs);
    synthesisText = response.text;
    trackCost(response.usage);

    // Extract confidence from 0-100 score
    const confMatch = synthesisText.match(/\b(\d{1,3})(?:\/100|%|\s*(?:out of|\/)\s*100)\b/);
    if (confMatch) {
      confidence = Math.min(100, Math.max(0, parseInt(confMatch[1])));
    } else if (synthesisText.toLowerCase().includes("gridlock") || synthesisText.toLowerCase().includes("could not resolve")) {
      confidence = 35;
      consensusType = "divergent";
    } else {
      // Fallback: look for confidence-anchored patterns (avoid matching random numbers)
      const confContext = synthesisText.toLowerCase();
      if (confContext.includes("very high confidence") || confContext.includes("confidence: very high")) {
        confidence = 92;
      } else if (confContext.includes("high confidence") || confContext.includes("confidence: high")) {
        confidence = 82;
      } else if (confContext.includes("medium confidence") || confContext.includes("moderate confidence") || confContext.includes("confidence: medium")) {
        confidence = 62;
      } else if (confContext.includes("low confidence") || confContext.includes("confidence: low")) {
        confidence = 40;
      }
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

// ── Standalone synthesis function — can be called from its own endpoint ──
async function runSynthesisOnly(threadId: string, topic: string, modelKeys: string[], roundData: { round1: string; round2: string; bsDetector: string }) {
  const thread = threads.get(threadId);
  if (!thread) return;

  const startTime = Date.now();
  const models = modelKeys.filter(k => MODELS[k]);

  const trackCost = (usage: TokenUsage) => {
    thread.totalCost += usage.cost;
    sendEvent(threadId, { type: "cost_update", totalCost: thread.totalCost, elapsed: (Date.now() - startTime) / 1000 });
  };

  const tierPriority = ["frontier", "strong"];
  const synthCandidates = [...models].sort((a, b) => {
    const aTier = tierPriority.indexOf(MODELS[a]?.tier || "strong");
    const bTier = tierPriority.indexOf(MODELS[b]?.tier || "strong");
    return aTier - bTier;
  });
  const synthModelKey = synthCandidates[0] || "claude";

  addMessage(threadId, {
    type: "status", phase: "synthesizing",
    text: `Synthesis — ${MODELS[synthModelKey]?.name || synthModelKey} extracting the recommendation.`,
  });

  // NOTE: SYNTHESIS_PROMPT_TEMPLATE is passed as system prompt via callModel, not duplicated here
  const synthPrompt = `The user asked: ${topic}

Round 1 (independent analyses):
${roundData.round1}

Round 2 (cross-examination):
${roundData.round2}

${roundData.bsDetector ? `Quality Check (bullshit detector):\n${roundData.bsDetector}\n` : ""}`;

  let synthesisText = "";
  let confidence = 75;
  let consensusType: "unanimous" | "additive" | "divergent" = "additive";

  try {
    const response = await callModel(synthModelKey, synthPrompt, SYNTHESIS_PROMPT_TEMPLATE);
    synthesisText = response.text;
    trackCost(response.usage);

    const confMatch = synthesisText.match(/\b(\d{1,3})(?:\/100|%|\s*(?:out of|\/)\s*100)\b/);
    if (confMatch) {
      confidence = Math.min(100, Math.max(0, parseInt(confMatch[1])));
    } else if (synthesisText.toLowerCase().includes("gridlock") || synthesisText.toLowerCase().includes("could not resolve")) {
      confidence = 35;
      consensusType = "divergent";
    } else {
      const confContext = synthesisText.toLowerCase();
      if (confContext.includes("very high confidence") || confContext.includes("confidence: very high")) {
        confidence = 92;
      } else if (confContext.includes("high confidence") || confContext.includes("confidence: high")) {
        confidence = 82;
      } else if (confContext.includes("medium confidence") || confContext.includes("moderate confidence") || confContext.includes("confidence: medium")) {
        confidence = 62;
      } else if (confContext.includes("low confidence") || confContext.includes("confidence: low")) {
        confidence = 40;
      }
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
  const topic = req.body.topic?.trim()?.slice(0, 10_000); // Max 10K chars
  const modelInput = Array.isArray(req.body.models) ? req.body.models : ["claude", "gemini", "gpt5", "deepseek"];
  const models = modelInput.filter((m: string) => typeof m === "string" && MODELS[m]).slice(0, 9); // Max 9 models, only valid ones
  const systemContext = req.body.systemContext?.trim()?.slice(0, 20_000); // Max 20K chars context
  const skipClarification = req.body.skipClarification === true;
  if (!topic) return res.status(400).json({ error: "No topic" });
  if (models.length === 0) return res.status(400).json({ error: "No valid models" });

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

  threadStreamTargets.set(tid, res);
  try {
    if (skipClarification) {
      // Skip Round 0 — go straight to full analysis
      await runAnalysisRounds(tid, topic, models);
    } else {
      // Run Round 0 only — pause for user input after clarifying questions
      await runClarificationRound(tid, topic, models);
    }
  } catch (err: any) {
    console.error("Discussion error:", err);
    addMessage(tid, { type: "status", phase: "error", text: `Discussion error: ${err.message}` });
  } finally {
    threadStreamTargets.delete(tid);
    res.end();
  }
});

// ── Standalone synthesis endpoint — gets its own fresh 300s Vercel budget ──
app.post("/synthesize", async (req, res) => {
  const tid = req.body.thread_id;
  const topic = req.body.topic?.trim()?.slice(0, 10_000);
  const modelInput = Array.isArray(req.body.models) ? req.body.models : ["claude"];
  const models = modelInput.filter((m: string) => typeof m === "string" && MODELS[m]).slice(0, 9);
  const round1 = (req.body.round1 || "").slice(0, 100_000); // Cap round data
  const round2 = (req.body.round2 || "").slice(0, 100_000);
  const bsDetector = (req.body.bsDetector || "").slice(0, 50_000);

  if (!tid || !topic) return res.status(400).json({ error: "Missing thread_id or topic" });

  // Reconstruct thread if needed (serverless: different invocation)
  let thread = threads.get(tid);
  if (!thread) {
    thread = {
      id: tid, topic, status: "active", created: new Date().toISOString(),
      models, messages: [], totalCost: 0,
    };
    threads.set(tid, thread);
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  threadStreamTargets.set(tid, res);
  try {
    await runSynthesisOnly(tid, topic, models, { round1, round2, bsDetector });
  } catch (err: any) {
    console.error("Synthesis endpoint error:", err);
    addMessage(tid, { type: "status", phase: "error", text: `Synthesis error: ${err.message}` });
  } finally {
    threadStreamTargets.delete(tid);
    res.end();
  }
});

// ── Resume after clarifying questions answered (or skipped) ──
// Serverless-safe: frontend sends full context since threads don't persist across invocations
app.post("/clarify", async (req, res) => {
  const tid = req.body.thread_id;
  const answers = req.body.answers?.trim()?.slice(0, 20_000); // Max 20K chars
  const topic = req.body.topic?.trim()?.slice(0, 10_000);
  const modelInput = Array.isArray(req.body.models) ? req.body.models : ["claude", "gemini", "gpt5", "deepseek"];
  const models = modelInput.filter((m: string) => typeof m === "string" && MODELS[m]).slice(0, 9);
  const systemContext = req.body.systemContext?.trim()?.slice(0, 20_000);

  if (!tid || !topic) return res.status(400).json({ error: "Missing thread_id or topic" });

  // Reconstruct thread if it doesn't exist (serverless: different invocation)
  let thread = threads.get(tid);
  if (!thread) {
    thread = {
      id: tid, topic, status: "awaiting_clarification", created: new Date().toISOString(),
      models, messages: [], systemContext, totalCost: 0,
    };
    threads.set(tid, thread);
  }

  // Store answers for context injection
  if (answers) {
    thread.clarificationAnswers = answers;
    addMessage(tid, { type: "message", role: "human", name: "human", text: answers, done: true, phase: "clarification_response" });
  }

  // Stream SSE for the remaining rounds
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  threadStreamTargets.set(tid, res);
  try {
    await runAnalysisRounds(tid, topic, models);
  } catch (err: any) {
    console.error("Clarify resume error:", err);
    addMessage(tid, { type: "status", phase: "error", text: `Resume error: ${err.message}` });
  } finally {
    threadStreamTargets.delete(tid);
    res.end();
  }
});

// Programmatic API endpoint — agents call this
// sync=true (default for API callers): waits for full discussion, returns recap
// sync=false (default for UI): returns immediately, streams via SSE
app.post("/api/ask", requireApiKey, async (req, res) => {
  const question = req.body.question?.trim()?.slice(0, 10_000);
  const modelInput = Array.isArray(req.body.models) ? req.body.models : ["claude", "gemini", "gpt5", "deepseek"];
  const models = modelInput.filter((m: string) => typeof m === "string" && MODELS[m]).slice(0, 9);
  const systemContext = req.body.systemContext?.trim()?.slice(0, 20_000);
  const sync = req.body.sync === true;

  if (!question) return res.status(400).json({ error: "No question" });

  const tid = generateId();
  threads.set(tid, {
    id: tid, topic: question, status: "active", created: new Date().toISOString(),
    models, messages: [], systemContext, totalCost: 0,
  });

  if (sync) {
    // Programmatic API: skip clarification, run analysis directly
    try {
      await runAnalysisRounds(tid, question, models);
      const threadFinal = threads.get(tid);
      res.json({
        thread_id: tid, status: "complete",
        recap: threadFinal?.recap || "No recap generated.",
        messages: threadFinal?.messages?.filter((m: any) => m.done && m.text && !m.typing) || [],
      });
    } catch (err: any) {
      console.error("Sync API error:", err);
      res.status(500).json({ error: `Analysis failed: ${err.message}` });
    }
  } else {
    // Stream SSE inline — skip clarification for API callers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.write(`data: ${JSON.stringify({ type: "thread_created", thread_id: tid })}\n\n`);
    threadStreamTargets.set(tid, res);
    try {
      await runAnalysisRounds(tid, question, models);
    } finally {
      threadStreamTargets.delete(tid);
      res.end();
    }
  }
});

// ─── META-QA: Multi-model quality check on Council outputs ───
// After a deliberation completes, hit /api/qa to get a parallel quality review
// from 3 frontier models. Same pattern as the AWS QA pipeline.
app.post("/api/qa", requireApiKey, async (req, res) => {
  const threadId = req.body.thread_id;
  const content = req.body.content?.trim()?.slice(0, 20_000);

  if (!content && !threadId) {
    return res.status(400).json({ error: "Provide 'content' or 'thread_id'" });
  }

  // If thread_id provided, use the recap as content
  let textToReview = content || "";
  if (threadId && !textToReview) {
    const thread = threads.get(threadId);
    if (thread?.recap) {
      textToReview = thread.recap;
    } else {
      return res.status(404).json({ error: "Thread not found or no recap available" });
    }
  }

  const qaModels = ["claude", "gpt5", "gemini"].filter(m => MODELS[m]);
  if (qaModels.length === 0) {
    return res.status(500).json({ error: "No QA models available" });
  }

  const qaSystemPrompt = `You are a quality reviewer. Analyze this Council deliberation output for:
1. Factual accuracy — any claims that seem wrong or unsupported?
2. Logical consistency — do the conclusions follow from the arguments?
3. Completeness — are important perspectives missing?
4. Actionability — can the reader actually use this advice?

Rate each dimension 1-5 and give an overall verdict:
VERDICT: PASS (4+ on all) | NEEDS_IMPROVEMENT (any 2-3) | FAIL (any 1)

Be concise. Focus on real issues, not nitpicks.`;

  const qaPrompt = `Review this Council deliberation output:\n\n${textToReview}`;

  // Fan out to QA models in parallel
  const qaResults = await Promise.all(
    qaModels.map(async (modelKey) => {
      const cfg = MODELS[modelKey];
      try {
        const result = await callOpenRouter(cfg.modelId, qaPrompt, qaSystemPrompt, 1);
        return { model: modelKey, name: cfg.name, content: result, error: null };
      } catch (err: any) {
        return { model: modelKey, name: cfg.name, content: null, error: err.message };
      }
    })
  );

  // Count verdicts
  let passes = 0;
  let fails = 0;
  for (const r of qaResults) {
    if (r.content?.includes("VERDICT: PASS")) passes++;
    if (r.content?.includes("VERDICT: FAIL")) fails++;
  }

  const consensus = fails > 0 ? "FAIL" : passes === qaResults.length ? "PASS" : "NEEDS_REVIEW";

  res.json({
    consensus,
    passes,
    fails,
    total: qaResults.length,
    reviews: qaResults,
  });
});

app.get("/threads", (req, res) => {
  res.json(Array.from(threads.values()).map(t => ({
    id: t.id, topic: t.topic, status: t.status,
    created: t.created, stakes: t.stakes, reversible: t.reversible,
  })));
});

app.post("/human", async (req, res) => {
  const tid = req.body.thread_id;
  const text = req.body.text?.trim()?.slice(0, 10_000);
  const topic = req.body.topic?.trim()?.slice(0, 10_000);
  if (!text) return res.status(400).json({ error: "Empty" });
  if (!tid || typeof tid !== "string") return res.status(400).json({ error: "Missing thread_id" });

  // Reconstruct thread if needed (serverless: different invocation)
  let thread = threads.get(tid);
  if (!thread && topic) {
    const modelInput = Array.isArray(req.body.models) ? req.body.models : ["claude", "gemini", "gpt5", "deepseek"];
    // Validate and cap previousMessages to prevent memory abuse
    const prevMessages = Array.isArray(req.body.previousMessages)
      ? req.body.previousMessages.slice(-30).map((m: any) => ({
          type: m.type, role: m.role, name: m.name,
          text: typeof m.text === "string" ? m.text.slice(0, 10_000) : "",
          done: m.done,
        }))
      : [];
    thread = {
      id: tid, topic, status: "complete", created: new Date().toISOString(),
      models: modelInput.filter((m: string) => MODELS[m]).slice(0, 9),
      messages: prevMessages,
      systemContext: req.body.systemContext?.trim()?.slice(0, 20_000),
      totalCost: 0,
    };
    threads.set(tid, thread);
  }
  if (!thread) return res.status(404).json({ error: "Thread not found — include topic for serverless" });

  // Stream SSE for follow-ups too
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  addMessage(tid, { type: "message", role: "human", name: "human", text, done: true });

  threadStreamTargets.set(tid, res);
  try {
    await handleFollowup(tid, text, req.body.models);
  } catch (err: any) {
    console.error("Followup error:", err);
  } finally {
    threadStreamTargets.delete(tid);
    res.end();
  }
});

// ── Persist thread to Vercel Blob ──
app.post("/save/:threadId", async (req, res) => {
  const tid = req.params.threadId;

  // Validate thread ID format (must be UUID to prevent path traversal)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tid)) {
    return res.status(400).json({ error: "Invalid thread ID format" });
  }

  // Accept thread data from the frontend (since serverless may not have it in memory)
  const threadData = req.body.thread || threads.get(tid);
  const rawMessages = req.body.messages || threadData?.messages || [];
  const recap = typeof req.body.recap === "string" ? req.body.recap.slice(0, 50_000) : (threadData?.recap || "");

  if (!threadData && !req.body.thread) {
    return res.status(404).json({ error: "Thread not found and no data provided" });
  }

  // Sanitize messages — only persist expected fields, cap counts and sizes
  const messages = Array.isArray(rawMessages)
    ? rawMessages.slice(0, 200).map((m: any) => ({
        type: m.type, role: m.role, name: typeof m.name === "string" ? m.name.slice(0, 50) : undefined,
        text: typeof m.text === "string" ? m.text.slice(0, 30_000) : "",
        done: !!m.done, phase: m.phase, synthesis: m.synthesis,
        timestamp: m.timestamp,
      }))
    : [];

  // Sanitize thread data — only persist expected fields
  const safeThread = {
    id: tid,
    topic: typeof threadData?.topic === "string" ? threadData.topic.slice(0, 10_000) : "",
    status: "saved",
    created: threadData?.created || new Date().toISOString(),
    models: Array.isArray(threadData?.models) ? threadData.models.filter((m: string) => typeof m === "string").slice(0, 9) : [],
    totalCost: typeof threadData?.totalCost === "number" ? threadData.totalCost : 0,
  };

  try {
    // Check if this thread already exists — only allow saving once (no overwrites)
    const { blobs: existing } = await list({ prefix: `council/threads/${tid}.json` });
    if (existing.some(b => b.pathname === `council/threads/${tid}.json`)) {
      return res.status(409).json({ error: "Thread already saved — overwrites not allowed" });
    }

    const payload = {
      thread: safeThread,
      messages,
      recap,
      savedAt: new Date().toISOString(),
    };

    const blob = await put(`council/threads/${tid}.json`, JSON.stringify(payload), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
    });

    // Also update in-memory if we have it
    const memThread = threads.get(tid);
    if (memThread) memThread.status = "saved";

    console.log(`[Blob] Saved thread ${tid} → ${blob.url}`);
    res.json({ success: true, url: blob.url });
  } catch (err: any) {
    console.error(`[Blob] Save error for ${tid}:`, err);
    res.status(500).json({ error: `Failed to save: ${err.message}` });
  }
});

// ── Load thread from Vercel Blob ──
app.get("/load/:threadId", async (req, res) => {
  const tid = req.params.threadId;

  // Validate thread ID format (must be UUID)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tid)) {
    return res.status(400).json({ error: "Invalid thread ID format" });
  }

  try {
    const { blobs } = await list({ prefix: `council/threads/${tid}.json` });
    const exactBlob = blobs.find(b => b.pathname === `council/threads/${tid}.json`);
    if (!exactBlob) {
      return res.status(404).json({ error: "Thread not found in cloud storage" });
    }
    // Use downloadUrl for private blobs
    const response = await fetch(exactBlob.downloadUrl);
    if (!response.ok) {
      return res.status(502).json({ error: `Failed to fetch from blob storage: ${response.status}` });
    }
    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    console.error(`[Blob] Load error for ${tid}:`, err);
    res.status(500).json({ error: `Failed to load: ${err.message}` });
  }
});

// ── List all saved threads from Vercel Blob ──
app.get("/saved-threads", async (_req, res) => {
  try {
    const { blobs } = await list({ prefix: "council/threads/" });
    const threads = blobs.map(b => ({
      id: b.pathname.replace("council/threads/", "").replace(".json", ""),
      url: b.url,
      size: b.size,
      uploadedAt: b.uploadedAt,
    }));
    res.json({ threads });
  } catch (err: any) {
    console.error("[Blob] List error:", err);
    res.status(500).json({ error: `Failed to list: ${err.message}` });
  }
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
