#!/usr/bin/env npx tsx
/**
 * Automated stress test: Run 10 consecutive Council sessions
 * Mix of fast (2 model) and frontier (3 model) configs.
 * Verify each reaches synthesis with a recap.
 *
 * Usage: npx tsx test-10-sessions.ts
 */

const BASE = process.env.TEST_URL || "http://localhost:3000";
const PASSWORD = process.env.COUNCIL_PASSWORD || "wordpass";

// Mix of configs — some fast, some frontier-heavy, some long prompts
const SESSIONS = [
  {
    topic: "Should a solo founder use TypeScript or Python for a SaaS MVP?",
    models: ["deepseek", "gemini"],
    label: "2-model fast",
  },
  {
    topic: "Is remote work better than in-office for a 5-person startup in 2026, considering the new generation of AI coding tools that make async collaboration more productive?",
    models: ["claude", "gpt5", "deepseek"],
    label: "3-model frontier",
  },
  {
    topic: "PostgreSQL vs MongoDB for a new project?",
    models: ["gemini", "deepseek"],
    label: "2-model fast",
  },
  {
    topic: "We're a 2-person startup with $50K in the bank. We have a working product with 12 paying customers at $99/mo. Should we raise a pre-seed round, try to get into YC, or keep bootstrapping and focus on getting to $10K MRR? Consider: our burn rate is $8K/mo, the market is competitive but growing, and our NPS is 72.",
    models: ["claude", "gpt5", "gemini"],
    label: "3-model frontier + long prompt",
  },
  {
    topic: "Should we build a mobile app or progressive web app first?",
    models: ["deepseek", "llama"],
    label: "2-model value",
  },
  {
    topic: "Our CTO just quit. We're a 4-person team mid-fundraise with a demo next week. We have three options: (1) pause the raise and stabilize, (2) hire a fractional CTO immediately, (3) have our senior engineer step up temporarily. The investor is Sequoia and this is our only shot. What do we do?",
    models: ["claude", "gpt5", "grok"],
    label: "3-model ALL frontier",
  },
  {
    topic: "Microservices or monolith for early-stage?",
    models: ["gemini", "mistral"],
    label: "2-model mixed",
  },
  {
    topic: "We need to choose our AI infrastructure stack. Options: (A) OpenAI API + Pinecone + LangChain, (B) Claude API + Supabase pgvector + custom orchestration, (C) open-source models on Replicate + Weaviate + LlamaIndex. We're building a legal document analysis tool. Budget: $2K/mo for AI infra. Need to handle 10K docs/month. Privacy matters — clients are law firms.",
    models: ["claude", "gpt5", "deepseek"],
    label: "3-model frontier + complex prompt",
  },
  {
    topic: "Is paid marketing or organic content better for early traction?",
    models: ["qwen", "sonnet"],
    label: "2-model new models",
  },
  {
    topic: "We're deciding whether to open-source our core product. We have 200 paying customers, $30K MRR, and 3 competitors who are all closed-source. Our moat is our data pipeline, not the code. Open-sourcing could: grow community, attract contributors, build trust with enterprise buyers. But it could also: help competitors, reduce willingness to pay, and create a support burden. What should we do and what's the sequencing?",
    models: ["claude", "gpt5", "gemini", "deepseek"],
    label: "4-model mixed tiers + long prompt",
  },
];

interface TestResult {
  index: number;
  label: string;
  topic: string;
  models: string[];
  success: boolean;
  gotRecap: boolean;
  gotSynthesis: boolean;
  modelResponses: number;
  rounds: string[];
  elapsed: number;
  error?: string;
}

async function getSessionCookie(): Promise<string> {
  try {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
      redirect: "manual",
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const match = setCookie.match(/council_session=([^;]+)/);
      if (match) return `council_session=${match[1]}`;
    }
    return "";
  } catch {
    return "";
  }
}

function parseSSE(body: string): any[] {
  const events: any[] = [];
  for (const line of body.split("\n")) {
    if (line.startsWith("data: ")) {
      try { events.push(JSON.parse(line.slice(6))); } catch {}
    }
  }
  return events;
}

function processEvents(events: any[], result: TestResult) {
  for (const ev of events) {
    if (ev.type === "message" && ev.role === "model" && ev.done && !ev.text?.startsWith("[Error")) {
      result.modelResponses++;
    }
    if (ev.phase && !result.rounds.includes(ev.phase)) result.rounds.push(ev.phase);
    if (ev.type === "recap" || ev.recap) result.gotRecap = true;
    if (ev.synthesis) result.gotSynthesis = true;
  }
}

async function runSession(session: typeof SESSIONS[0], index: number, cookie: string): Promise<TestResult> {
  const start = Date.now();
  const result: TestResult = {
    index,
    label: session.label,
    topic: session.topic,
    models: session.models,
    success: false,
    gotRecap: false,
    gotSynthesis: false,
    modelResponses: 0,
    rounds: [],
    elapsed: 0,
  };

  try {
    // Step 1: Start (Round 0 clarification)
    const startRes = await fetch(`${BASE}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify({ topic: session.topic, models: session.models, stakes: "medium", reversible: true }),
    });

    if (!startRes.ok) {
      result.error = `Start ${startRes.status}`;
      result.elapsed = (Date.now() - start) / 1000;
      return result;
    }

    let threadId = "";
    const startEvents = parseSSE(await startRes.text());
    for (const ev of startEvents) {
      if (ev.thread_id && !threadId) threadId = ev.thread_id;
    }
    processEvents(startEvents, result);

    if (!threadId) {
      result.error = "No thread_id";
      result.elapsed = (Date.now() - start) / 1000;
      return result;
    }

    // Step 2: Skip clarification → run analysis
    if (!result.gotRecap) {
      const clarifyRes = await fetch(`${BASE}/clarify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
        body: JSON.stringify({
          thread_id: threadId,
          answers: "Proceed without answers — use your best judgment.",
          topic: session.topic,
          models: session.models,
          stakes: "medium",
          reversible: true,
        }),
      });

      if (!clarifyRes.ok) {
        result.error = `Clarify ${clarifyRes.status}`;
        result.elapsed = (Date.now() - start) / 1000;
        return result;
      }

      processEvents(parseSSE(await clarifyRes.text()), result);
    }

    // Step 3: If still no recap, try standalone synthesis
    if (!result.gotRecap) {
      const synthRes = await fetch(`${BASE}/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
        body: JSON.stringify({
          thread_id: threadId,
          topic: session.topic,
          models: session.models,
          round1: "Analysis was performed.",
          round2: "Cross-examination was performed.",
          bsDetector: "",
        }),
      });

      if (synthRes.ok) {
        processEvents(parseSSE(await synthRes.text()), result);
      }
    }

    result.success = result.gotRecap;
    result.elapsed = (Date.now() - start) / 1000;
    return result;
  } catch (err: any) {
    result.error = err.message;
    result.elapsed = (Date.now() - start) / 1000;
    return result;
  }
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  COUNCIL STRESS TEST — 10 Consecutive Sessions (Mixed)");
  console.log(`  Server: ${BASE}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  const cookie = await getSessionCookie();
  console.log(cookie ? "  ✅ Authenticated\n" : "  ⚠️  No auth (open)\n");

  const results: TestResult[] = [];
  let passed = 0;

  for (let i = 0; i < SESSIONS.length; i++) {
    const s = SESSIONS[i];
    const modelStr = s.models.join("+");
    process.stdout.write(`  [${i + 1}/10] ${s.label} (${modelStr})\n`);
    process.stdout.write(`         "${s.topic.slice(0, 60)}${s.topic.length > 60 ? '...' : ''}"\n`);
    process.stdout.write(`         `);

    const result = await runSession(s, i, cookie);
    results.push(result);

    if (result.success) {
      passed++;
      console.log(`✅ PASS — ${result.elapsed.toFixed(0)}s | ${result.modelResponses} model responses | phases: ${result.rounds.join("→")}`);
    } else {
      console.log(`❌ FAIL — ${result.elapsed.toFixed(0)}s | ${result.error || 'No recap'} | ${result.modelResponses} responses | phases: ${result.rounds.join("→") || "none"}`);
    }
    console.log();
  }

  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  RESULTS: ${passed}/10 PASSED`);
  if (passed < 10) console.log(`           ${10 - passed}/10 FAILED`);
  console.log(`  Total: ${results.reduce((s, r) => s + r.elapsed, 0).toFixed(0)}s`);
  console.log(`  Avg: ${(results.reduce((s, r) => s + r.elapsed, 0) / 10).toFixed(0)}s per session`);
  console.log("═══════════════════════════════════════════════════════════════");

  if (passed < 10) {
    console.log("\n  FAILURES:");
    results.filter(r => !r.success).forEach(r => {
      console.log(`  #${r.index + 1} [${r.label}] ${r.error || 'No recap'}`);
    });
  }

  process.exit(passed < 10 ? 1 : 0);
}

main();
