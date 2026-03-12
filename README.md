# Cowork Council

Multi-model AI decision engine. Runs structured analysis across top-tier models (Claude Opus, Gemini Pro, GPT-5, o3, DeepSeek) and produces scored recommendations with confidence levels and autonomy classification.

Not a chatbot. Not a debate club. A tool that gets to the right answer.

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
