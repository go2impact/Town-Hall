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
  role: string;
  provider: "openrouter" | "google";
  modelId: string;
  tier: "best" | "fast" | "light";
}

const MODELS: Record<string, ModelConfig> = {
  claude:   { name: "Claude Opus 4.6",  color: "#5b9bf5", role: "Architect",      provider: "openrouter", modelId: "anthropic/claude-opus-4-6",          tier: "best" },
  gemini:   { name: "Gemini 3.1 Pro",   color: "#34d399", role: "Context Keeper", provider: "google",     modelId: "gemini-3.1-pro-preview",             tier: "fast" },
  gpt5:     { name: "GPT-5.4 Pro",      color: "#a78bfa", role: "Challenger",     provider: "openrouter", modelId: "openai/gpt-5.4-pro",                 tier: "fast" },
  o3:       { name: "o3-Pro",           color: "#ef4444", role: "Reasoning",      provider: "openrouter", modelId: "openai/o3-pro",                      tier: "best" },
  deepseek: { name: "DeepSeek V3.2",    color: "#fb923c", role: "Logic Checker",  provider: "openrouter", modelId: "deepseek/deepseek-v3.2-speciale",    tier: "fast" },
  haiku:      { name: "Claude 3.5 Haiku", color: "#60a5fa", role: "Fast Analyst",  provider: "openrouter", modelId: "anthropic/claude-3.5-haiku",         tier: "light" },
  flash:      { name: "Gemini Flash",     color: "#10b981", role: "Fast Context",  provider: "google",     modelId: "gemini-2.5-flash-preview",           tier: "light" },
  "gpt4o-mini": { name: "GPT-4o Mini",   color: "#c084fc", role: "Fast General",  provider: "openrouter", modelId: "openai/gpt-4o-mini",                 tier: "light" },
};

// Role-specific system prompts
const SYSTEM_PROMPTS: Record<string, string> = {
  claude: `You are the Architect in a multi-AI decision council for a startup founder (Scott, CEO of Cowork.ai — an AI agent for remote workers).
Your job: get to the RIGHT answer. Focus on what's technically true, what's proven, what the real constraints are.
Separate facts from assumptions. Give concrete specifics. Think deeply.`,

  gemini: `You are the Context Keeper in a multi-AI decision council for a startup founder (Scott, CEO of Cowork.ai).
Your job: connect dots others miss. Check what's already been decided, what specs say, what conflicts with existing work.
Bring receipts — reference specific docs, previous discussions. Flag contradictions.`,

  gpt5: `You are the Challenger in a multi-AI decision council for a startup founder (Scott, CEO of Cowork.ai).
Your job: pressure-test every claim. Is this actually true or just conventional wisdom? What's the simplest version that works?
Only push back when genuinely wrong.`,

  o3: `You are the Reasoning Specialist in a multi-AI decision council for a startup founder (Scott, CEO of Cowork.ai).
Your job: deep, rigorous logical reasoning. Think step by step. Evaluate multiple paths by probability of success.
Quantify when possible — time, cost, probability, effort.`,

  deepseek: `You are the Logic Checker in a multi-AI decision council for a startup founder (Scott, CEO of Cowork.ai).
Your job: verify everyone's reasoning. Does the conclusion follow from the premises? Hidden assumptions?
Rate confidence levels. Identify what would change the answer.`,
};

const DEFAULT_SYSTEM = "You are an AI analyst in a decision council. Get to the right answer. Be thorough.";

// --- In-memory state ---
interface ThreadData {
  id: string;
  topic: string;
  status: "active" | "awaiting_input" | "complete" | "saved";
  created: string;
  models: string[];
  messages: any[];
  stakes?: string;
  reversible?: boolean;
  recap?: string;
  systemContext?: string; // Human-injected system prompt / context
}

const threads = new Map<string, ThreadData>();
const clients = new Map<string, express.Response[]>();

const generateId = () => {
  const now = new Date();
  return now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
};

// --- SSE helpers ---
// Global SSE subscribers (for the /events endpoint the frontend uses)
const globalClients: express.Response[] = [];

function sendEvent(threadId: string, data: any) {
  const payload = `data: ${JSON.stringify({ ...data, thread_id: threadId })}\n\n`;

  // Send to thread-specific subscribers
  const resArr = clients.get(threadId) || [];
  for (const res of resArr) {
    try { res.write(payload); } catch {}
  }

  // Send to global subscribers
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
async function callOpenRouter(modelId: string, prompt: string, system: string): Promise<string> {
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
  return data.choices?.[0]?.message?.content || "[No response]";
}

async function callGoogle(modelId: string, prompt: string, system: string): Promise<string> {
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
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "[No response]";
}

async function callModel(key: string, prompt: string, systemOverride?: string): Promise<string> {
  const cfg = MODELS[key];
  if (!cfg) throw new Error(`Unknown model: ${key}`);
  const system = systemOverride || SYSTEM_PROMPTS[key] || DEFAULT_SYSTEM;
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

  // Inject human system context if provided
  const contextPrefix = thread.systemContext
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

    const prompt = `The founder is asking: ${topic}${contextPrefix}
Analyze from first principles:
1. What facts do we actually know? (not assumptions)
2. What are the real constraints?
3. What does the objective require?
4. What's the highest-probability correct path?
5. Confidence level (low/medium/high) and what would change your answer.

Get to the answer. No filler. Think as deeply as needed.`;

    try {
      const t0 = Date.now();
      const text = await callModel(key, prompt);
      console.log(`  ✅ ${cfg.name} responded (${((Date.now() - t0) / 1000).toFixed(0)}s, ${text.length} chars)`);
      addMessage(threadId, { type: "message", role: "model", name: key, text, done: true });
      round1Results.push({ key, name: cfg.name, text });
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

  // ── ROUND 2: Pressure-test and converge ──
  addMessage(threadId, {
    type: "status", phase: "targeted_debate",
    text: "Round 2 — Models pressure-testing each other's analyses.",
  });

  const allPositions = validR1.map(r => `**${r.name}:** ${r.text}`).join("\n\n");
  const round2Results: { key: string; name: string; text: string }[] = [];

  for (const key of models) {
    const cfg = MODELS[key];
    const ownR1 = validR1.find(r => r.key === key);

    addMessage(threadId, { type: "message", role: "model", name: key, text: "Reviewing...", done: false });

    const prompt = `The founder asked: ${topic}${contextPrefix}
All Round 1 analyses:
${allPositions}

${ownR1 ? `Your Round 1 analysis: ${ownR1.text}` : ""}

Now that you've seen everyone's analysis:
1. Where did someone else get it MORE right than you? Update your view.
2. Where is someone factually wrong? Cite the specific error.
3. What's the strongest path forward considering ALL analyses?
4. What are we still uncertain about?
5. Confidence now (low/medium/high)?

Converge on the RIGHT answer, not defend your original take.`;

    try {
      const text = await callModel(key, prompt);
      addMessage(threadId, { type: "message", role: "model", name: key, text, done: true });
      round2Results.push({ key, name: cfg.name, text });
    } catch (err: any) {
      addMessage(threadId, { type: "message", role: "model", name: key, text: `[Error: ${err.message}]`, done: true });
    }
  }

  // ── ROUND 3: Synthesis and Recommendation ──
  addMessage(threadId, {
    type: "status", phase: "synthesizing",
    text: "Round 3 — Synthesizing recommendation.",
  });

  const allR2 = round2Results.map(r => `**${r.name} (Round 2):** ${r.text}`).join("\n\n");

  const synthPrompt = `The founder asked: ${topic}

Round 1 (initial analyses):
${allPositions}

Round 2 (pressure-tested):
${allR2}

Synthesize into a clear recommendation:

1. **What we know for sure** — Facts all models confirmed.
2. **Best path** — The highest-probability correct answer, with full reasoning.
3. **Key risk** — The one thing most likely to make this wrong.
4. **Confidence** — VERY HIGH / HIGH / MEDIUM / LOW
5. **Autonomy classification:** AUTO-PROCEED / NOTIFY-HUMAN / HUMAN-REQUIRED
6. **Next actions** — Specific, actionable steps.

This is a decision tool, not a debate summary. Give the founder the answer.`;

  const synthSystem = `You are the Council Moderator. Give the founder the RIGHT answer, not a balanced summary. Be honest about confidence.`;

  let synthesisText = "";
  let confidence = 75;
  let consensusType: "unanimous" | "additive" | "divergent" = "additive";

  try {
    synthesisText = await callModel("gemini", synthPrompt, synthSystem);

    if (synthesisText.includes("VERY HIGH")) confidence = 95;
    else if (synthesisText.includes("HIGH")) confidence = 85;
    else if (synthesisText.includes("MEDIUM")) confidence = 65;
    else if (synthesisText.includes("LOW")) confidence = 40;

    if (synthesisText.toLowerCase().includes("unanimous")) consensusType = "unanimous";
    else if (synthesisText.toLowerCase().includes("divergent")) consensusType = "divergent";

    addMessage(threadId, { type: "message", role: "model", name: "moderator", text: synthesisText, done: true, synthesis: true });
  } catch (err: any) {
    synthesisText = `[Synthesis error: ${err.message}]`;
    addMessage(threadId, { type: "message", role: "model", name: "moderator", text: synthesisText, done: true });
  }

  sendEvent(threadId, {
    type: "recap",
    text: synthesisText,
    confidence,
    isConsensus: consensusType,
    recommendation: "See synthesis above.",
    keyCaveat: "Review confidence assessment.",
    nextStep: "Follow the Next Actions in the synthesis.",
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

The founder just said: "${humanText}"

Respond directly as ${cfg.name}, the ${cfg.role}.`;

    try {
      const text = await callModel(key, prompt);
      addMessage(threadId, { type: "message", role: "model", name: key, text, done: true });
    } catch (err: any) {
      addMessage(threadId, { type: "message", role: "model", name: key, text: `[Error: ${err.message}]`, done: true });
    }
  }
}

function detectAddressedModels(text: string, threadModels: string[]): string[] {
  const lower = text.toLowerCase();
  const nameMap: Record<string, string | null> = {
    claude: "claude", gemini: "gemini", gpt: "gpt5", gpt5: "gpt5",
    o3: "o3", deepseek: "deepseek",
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

app.post("/start", (req, res) => {
  const topic = req.body.topic?.trim();
  const models = req.body.models || ["claude", "gemini", "gpt5", "deepseek"];
  const systemContext = req.body.systemContext?.trim();
  if (!topic) return res.status(400).json({ error: "No topic" });

  const tid = generateId();
  threads.set(tid, {
    id: tid, topic, status: "active", created: new Date().toISOString(),
    models, messages: [], stakes: req.body.stakes, reversible: req.body.reversible,
    systemContext,
  });

  res.json({ thread_id: tid });

  runDiscussion(tid, topic, models).catch(err => {
    console.error("Discussion error:", err);
    addMessage(tid, { type: "status", phase: "error", text: `Discussion error: ${err.message}` });
  });
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
    models, messages: [], systemContext,
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
    res.json({ thread_id: tid, status: "active" });
    runDiscussion(tid, question, models).catch(console.error);
  }
});

app.get("/threads", (req, res) => {
  res.json(Array.from(threads.values()).map(t => ({
    id: t.id, topic: t.topic, status: t.status,
    created: t.created, stakes: t.stakes, reversible: t.reversible,
  })));
});

app.post("/human", (req, res) => {
  const tid = req.body.thread_id;
  const text = req.body.text?.trim();
  if (!text) return res.status(400).json({ error: "Empty" });

  const thread = threads.get(tid);
  if (!thread) return res.status(404).json({ error: "Thread not found" });

  addMessage(tid, { type: "message", role: "human", name: "human", text, done: true });
  handleFollowup(tid, text, req.body.models).catch(console.error);
  res.json({ success: true });
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
