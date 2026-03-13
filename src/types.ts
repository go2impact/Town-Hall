export interface Message {
  thread_id: string;
  role: 'model' | 'human' | 'system';
  name?: string;
  text: string;
  color?: string;
  round?: string;
  typing?: boolean;
  done?: boolean;
  recap?: string;
  confidence?: number;
  assumptions?: string[];
  phase?: 'blind_draft' | 'consensus_check' | 'targeted_debate' | 'synthesizing' | string;
  isConsensus?: 'unanimous' | 'additive' | 'divergent' | null;
  recommendation?: string;
  keyCaveat?: string;
  agentPayload?: any;
}

export interface Thread {
  id: string;
  topic: string;
  status: 'active' | 'complete' | 'saved';
  source: 'live' | 'file';
  created: string;
  isProtocol?: boolean;
  stakes?: 'low' | 'medium' | 'high';
  reversible?: boolean;
}

export const MODELS = {
  // Frontier tier — best-in-class reasoning
  'Claude Opus 4.6': { id: 'claude', color: '#5b9bf5', tier: 'frontier', description: 'Anthropic flagship. Excels at nuanced reasoning, coding, and precise writing.' },
  'GPT-5.4': { id: 'gpt5', color: '#a78bfa', tier: 'frontier', description: 'OpenAI frontier. Unified reasoning + coding, 1M context window.' },
  'Grok 4': { id: 'grok', color: '#1d9bf0', tier: 'frontier', description: 'xAI frontier. Trained differently — genuinely thinks differently.' },

  // Strong tier — near-frontier, great value
  'Gemini 3.1 Pro': { id: 'gemini', color: '#34d399', tier: 'strong', description: 'Google powerhouse. Massive context window, search grounding.' },
  'DeepSeek V3.2': { id: 'deepseek', color: '#fb923c', tier: 'strong', description: 'DeepSeek reasoning engine. Near-frontier quality at 1/50th the cost.' },
  'Llama 4 Maverick': { id: 'llama', color: '#3b82f6', tier: 'strong', description: 'Meta open-source. Strong reasoning, runs everywhere.' },
  'Mistral Large': { id: 'mistral', color: '#f97316', tier: 'strong', description: 'European frontier model. Multilingual, fast, precise.' },
  'Qwen3 235B': { id: 'qwen', color: '#ef4444', tier: 'strong', description: 'Alibaba reasoning model. 235B params, strong on logic and math.' },
  'Claude Sonnet 4.6': { id: 'sonnet', color: '#8b5cf6', tier: 'strong', description: 'Anthropic fast model. Opus-quality reasoning at 3x speed.' },
} as const;

export type ModelKey = keyof typeof MODELS;
