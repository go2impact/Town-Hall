# Town Hall

Multi-model AI decision engine for strategic pressure-testing, architecture review, and hard decisions. Runs structured analysis across top-tier models and produces a recommendation with confidence and clear caveats.

Not a chatbot. Not a debate club. A tool that gets to the right answer.

## Live

- App: `https://cowork-council.vercel.app`
- Repo: `go2impact/Town-Hall`

Technical slugs such as `cowork-council` still exist in package/deployment internals for continuity. Human-facing naming should now be `Town Hall`.

## How it works

1. **Round 1 — First Principles** (parallel): All selected models analyze the question independently
2. **Round 2 — Pressure Test** (sequential): Each model reviews others' analyses, updates their view, flags errors
3. **Round 3 — Synthesis**: Moderator produces a recommendation with confidence level and autonomy classification (AUTO-PROCEED / NOTIFY-HUMAN / HUMAN-REQUIRED)

## API

**POST `/api/ask`** — Programmatic endpoint for agent-to-agent calls

```json
{
  "question": "Should we use MCP or custom integrations for Zendesk?",
  "models": ["claude", "gemini", "gpt5"],
  "systemContext": "We're building a desktop AI agent for remote CX workers...",
  "sync": true
}
```

Returns the full recap when `sync: true`. Set `X-Api-Key` header if `COUNCIL_API_KEY` is configured.

**GET `/api/health`** — Check status and configured models

## Canonical Docs

This repo is now the canonical home for:
- the working Town Hall app
- Town Hall architecture references in `architecture/`
- preserved Town Hall discussion history in `discussions/`

Key references:
- `architecture/town-hall-rules.md`
- `architecture/town-hall-spec.md`
- `discussions/2026-03-11-new-analysis-we-built-this-town-hall-for-decision.md`
- `discussions/2026-03-11-town-hall-is-running-thread-20260311-225302-all-5.md`

## Run locally

```bash
npm install
cp .env.example .env  # Fill in your API keys
npm run dev
```

## Models

| Key | Model | Role |
|-----|-------|------|
| claude | Claude Opus 4.6 | Architect |
| gemini | Gemini 3.1 Pro | Context Keeper |
| gpt5 | GPT-5.4 Pro | Challenger |
| o3 | o3-Pro | Reasoning |
| deepseek | DeepSeek V3.2 | Logic Checker |
| haiku | Claude 3.5 Haiku | Fast Analyst |
| flash | Gemini Flash | Fast Context |
| gpt4o-mini | GPT-4o Mini | Fast General |

## Deploy

Works on any Node.js host. For production:

```bash
npm run build
NODE_ENV=production node --loader tsx server.ts
```
