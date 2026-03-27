# Cowork.ai — Town Hall: Multi-Model Orchestration Spec

**Version:** 0.1 (draft)
**Last Updated:** 2026-03-11
**Status:** Design — not yet implemented
**Origin:** Scott's insight: "If we put every copilot in a room... have a debate forum and then checking and reviewing... real orchestration."

---

## The Problem

A single AI model working alone makes systematic errors:
- Context hallucinations (loses track of what was said 50K tokens ago)
- Style drift (1200-line Python files because it can't maintain separation of concerns across sessions)
- Confirmation bias (doesn't challenge its own design decisions)
- No review loop (ships first-draft code with no second opinion)

Human teams solve this with code review, architecture discussions, and design critiques. The town hall brings that dynamic to AI agents.

---

## The Concept

Multiple AI models/agents participate in structured discussions about product decisions, code reviews, and architecture design. Each model brings different strengths:

| Model | Strength | Role |
|-------|----------|------|
| Claude Opus/Sonnet | Deep reasoning, nuance, code quality | Lead architect, code reviewer |
| Gemini 2.5 Pro | Long context (1M tokens), breadth | Context keeper, doc reviewer |
| DeepSeek R1 | Reasoning chains, logic verification | Logic checker, assumption challenger |
| GPT-4o | Broad knowledge, fast iteration | Brainstormer, alternative approaches |
| o3 | Math/logic, structured reasoning | Spec validator, edge case finder |

Each model costs different amounts, runs at different speeds, and has different failure modes. The orchestrator maximizes value per dollar.

---

## Architecture

```
                    ┌──────────────────┐
                    │   Orchestrator   │
                    │  (Python daemon) │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
        ┌─────┴─────┐  ┌────┴────┐  ┌─────┴─────┐
        │  Claude    │  │ Gemini  │  │ DeepSeek  │
        │  (API)     │  │ (API)   │  │ (local)   │
        └───────────┘  └─────────┘  └───────────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                    ┌────────┴─────────┐
                    │   Discussion     │
                    │   Store (SQLite) │
                    └──────────────────┘
                             │
                    ┌────────┴─────────┐
                    │   Slack / UI     │
                    │   (human reads)  │
                    └──────────────────┘
```

### Key Principle: All Discussion in Natural Language

Every model interaction is a readable conversation. No binary protocols, no encoded state. A human (Scott) can read the entire discussion in Slack or the UI and participate at any point. This is a core product principle — humans must be able to read and participate in agent conversations.

---

## Discussion Types

### 1. Code Review
```
Trigger: New commit or PR
Participants: Claude (reviewer), Gemini (context checker), DeepSeek (logic)

Flow:
1. Orchestrator reads the diff
2. Claude: "Here's what I see in this change..."
3. DeepSeek: "The logic assumes X but doesn't handle Y..."
4. Gemini (with full repo context): "This conflicts with the pattern in file Z..."
5. Orchestrator: Synthesize feedback, post to Slack/PR
```

### 2. Architecture Discussion
```
Trigger: New feature request or design question
Participants: All models

Flow:
1. Orchestrator frames the question with context from cowork-brain docs
2. Each model proposes an approach
3. Models critique each other's proposals
4. Orchestrator synthesizes into options with tradeoffs
5. Post to Slack for human decision
```

### 3. Bug Investigation
```
Trigger: Error report or failing test
Participants: Claude (debugger), DeepSeek (logic trace)

Flow:
1. Orchestrator provides error context + relevant code
2. Claude: Root cause hypothesis
3. DeepSeek: Verify logic chain, identify assumptions
4. If disagreement: escalate to Gemini with broader context
5. Propose fix, run tests, report
```

### 4. Documentation Review
```
Trigger: Doc update or strategy change
Participants: Gemini (long context), Claude (writing quality)

Flow:
1. Gemini reads full doc set (can handle 1M tokens)
2. Identifies inconsistencies, outdated info, gaps
3. Claude rewrites/improves specific sections
4. Post changes for human review
```

---

## Orchestrator Design

### State Machine per Discussion
```
IDLE → FRAMING → ROUND_1 → ROUND_2 → ... → SYNTHESIS → REVIEW → DONE
```

- **FRAMING**: Orchestrator prepares context, assigns roles, sets the question
- **ROUND_N**: Each participant responds in turn (or parallel where independent)
- **SYNTHESIS**: Orchestrator combines perspectives into actionable output
- **REVIEW**: Human reviews and approves/modifies
- **DONE**: Decision logged, action taken

### Cost Control
- Each discussion has a budget ($X max)
- Local models (DeepSeek) are free — use them first for initial analysis
- Expensive models (Opus) only called when cheaper models disagree or the question warrants it
- Orchestrator tracks cost in real time, can downgrade models mid-discussion

### Model Routing
```python
# Cheap analysis first
initial_analysis = await deepseek.analyze(context)  # $0 (local)

# If confident, done
if initial_analysis.confidence > 0.9:
    return initial_analysis

# Escalate to mid-tier for verification
verification = await gemini_flash.verify(context, initial_analysis)  # ~$0.01

# If disagreement, bring in the big guns
if verification.disagrees:
    resolution = await claude_sonnet.resolve(context, initial_analysis, verification)  # ~$0.05
```

---

## Implementation Plan

### Phase 1: Two-Agent Code Review (MVP)
- Claude reviews code, DeepSeek verifies logic
- Results posted to Slack #ai-comms
- No orchestrator — simple Python script with two API calls
- Prove the concept works

### Phase 2: Orchestrator Daemon
- Python daemon that manages discussions
- SQLite store for discussion history
- Slack integration for I/O
- Support 3+ models
- Cost tracking per discussion

### Phase 3: Integration with Cowork.ai
- Town hall becomes a feature in the desktop app
- Workers can watch AI agents discuss their ticket responses
- "Get a second opinion" button on any AI output
- MCP browser shows the multi-model discussion

### Phase 4: Self-Improvement Loop
- Town hall reviews its own output quality
- A/B test: single-model vs town-hall output
- Track which discussions produced better outcomes
- Optimize model selection based on task type

---

## What This Enables for Scott

Right now: One Claude session working alone, making the same class of errors repeatedly.

With town hall:
- Code gets reviewed by multiple perspectives before commit
- Architecture decisions get stress-tested by different reasoning styles
- Bugs get investigated from multiple angles simultaneously
- Documentation stays consistent across a growing doc set
- The product builds faster because errors are caught earlier

The town hall doesn't replace the builder — it makes the builder's output better on the first try.

---

## Open Questions

1. **Latency**: Sequential multi-model discussions could take minutes. Is that acceptable for code review? (Probably yes — human code review takes hours.)
2. **Consensus vs. democracy**: When models disagree, who wins? Options: confidence-weighted, cost-weighted, human breaks ties.
3. **Context sharing**: How much context does each model get? Full repo? Just the diff? The entire cowork-brain doc set?
4. **Discussion format**: Structured JSON rounds or freeform natural language? (Lean toward structured with natural language content.)
5. **Slack vs. custom UI**: Start with Slack (already works, both agents post there), build custom UI in Cowork.ai later.

---

## Relation to Existing Infrastructure

- **Pro (MacBook)**: Runs orchestrator daemon, has Claude Code, can call all cloud APIs
- **Mini (Mac Mini)**: Runs CUA for visual tasks, has DeepSeek local via Ollama (if RAM allows — currently tight)
- **dispatch.sh**: Already dispatches tasks Pro→Mini. Town hall could dispatch visual verification tasks to CUA.
- **Slack #ai-comms**: Already exists as agent communication channel. Town hall discussions live here.

---

*v0.1 — 2026-03-11*
*Draft spec. Will evolve as Phase 1 proves the concept.*
