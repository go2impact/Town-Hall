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
  // Deep Research / Reasoning Models (Slow but thorough)
  'o3-Pro': { id: 'o3', color: '#ef4444', tier: 'best', description: 'OpenAI reasoning specialist. Deep planning and complex logic.' },
  'DeepSeek V3.2': { id: 'deepseek', color: '#fb923c', tier: 'fast', description: 'DeepSeek logic checker. Verifies reasoning and finds hidden assumptions.' },

  // Standard Flagship Models (Smart but fast - ~30s)
  'Claude Opus 4.6': { id: 'claude', color: '#5b9bf5', tier: 'best', description: 'Anthropic flagship. Architect — coding, writing, nuanced reasoning.' },
  'Gemini 3.1 Pro': { id: 'gemini', color: '#34d399', tier: 'fast', description: 'Google advanced engine. Context Keeper — massive context, search.' },
  'GPT-5.4 Pro': { id: 'gpt5', color: '#a78bfa', tier: 'fast', description: 'OpenAI frontier model. Challenger — pressure-tests every claim.' },

  // Lightweight Models (Lightning fast)
  'Claude 3.5 Haiku': { id: 'haiku', color: '#60a5fa', tier: 'light', description: 'Anthropic fast model. High-speed, low-cost analysis.' },
  'Gemini Flash': { id: 'flash', color: '#10b981', tier: 'light', description: 'Google fast model. Quick multimodal processing.' },
  'GPT-4o Mini': { id: 'gpt4o-mini', color: '#c084fc', tier: 'light', description: 'OpenAI fast model. Quick general tasks.' },
} as const;

export type ModelKey = keyof typeof MODELS;
