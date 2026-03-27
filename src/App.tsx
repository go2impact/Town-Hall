import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  MessageSquare, 
  Plus, 
  Send, 
  History, 
  Save, 
  ChevronRight, 
  Loader2, 
  Terminal,
  ShieldCheck,
  Cpu,
  Brain,
  Scale,
  Search,
  Download,
  FileText,
  Filter,
  CheckCircle2,
  X,
  Settings2,
  Maximize2,
  Minimize2,
  Zap,
  AlertTriangle,
  Copy,
  HelpCircle,
  Database,
  BookOpen,
  Code,
  Layout,
  Megaphone,
  Briefcase,
  ExternalLink,
  Link,
  Server,
  RefreshCw
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { format } from 'date-fns';
import { cn } from './lib/utils';
import { Message, Thread, MODELS, ModelKey } from './types';

// Inline tooltip component
function Tip({ text }: { text: string }) {
  return (
    <span className="group/tip relative inline-flex items-center ml-1 cursor-help">
      <HelpCircle className="w-3 h-3 text-white/20 hover:text-white/50 transition-colors" />
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 rounded-lg bg-[#1a1a1a] border border-white/10 text-[10px] text-white/70 leading-relaxed whitespace-nowrap opacity-0 group-hover/tip:opacity-100 transition-opacity pointer-events-none z-50 shadow-xl max-w-xs">
        {text}
      </span>
    </span>
  );
}

export default function App() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'clarification' | 'awaiting_clarification' | 'awaiting_input' | 'blind_draft' | 'consensus_check' | 'targeted_debate' | 'synthesizing' | 'quality_check'>('idle');
  const [currentRound, setCurrentRound] = useState<string | null>(null);
  const [recap, setRecap] = useState<string | null>(null);
  const [finalConfidence, setFinalConfidence] = useState<number | null>(null);
  const [isConsensus, setIsConsensus] = useState<'unanimous' | 'additive' | 'divergent' | null>(null);
  const [recommendation, setRecommendation] = useState<string | null>(null);
  const [keyCaveat, setKeyCaveat] = useState<string | null>(null);
  const [nextStep, setNextStep] = useState<string | null>(null);
  const [elapsedTime, setElapsedTime] = useState<string | null>(null);
  const [estimatedCost, setEstimatedCost] = useState<string | null>(null);
  const [liveCost, setLiveCost] = useState<number>(0);
  const [liveElapsed, setLiveElapsed] = useState<number>(0);
  const [agentPayload, setAgentPayload] = useState<any | null>(null);
  const [stakes, setStakes] = useState<'low' | 'medium' | 'high'>('medium');
  const [reversible, setReversible] = useState<boolean>(true);
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(80);
  const [synthesisStrategy, setSynthesisStrategy] = useState<'majority' | 'weighted_consensus' | 'debate_to_consensus'>('debate_to_consensus');
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedModels, setSelectedModels] = useState<Set<ModelKey>>(new Set(Object.keys(MODELS) as ModelKey[]));
  const [filterModel, setFilterModel] = useState<ModelKey | 'all'>('all');
  const [protocols, setProtocols] = useState<Set<string>>(new Set());
  const [showProtocolsOnly, setShowProtocolsOnly] = useState(false);
  const [tier, setTier] = useState<'strong' | 'frontier'>('frontier');
  const [isTranscriptExpanded, setIsTranscriptExpanded] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('general');
  const [businessContext, setBusinessContext] = useState<string>('');
  const [isRagConnected, setIsRagConnected] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [showAdvancedControls, setShowAdvancedControls] = useState(false);

  const TEMPLATES = [
    { id: 'general', name: 'General Decision', icon: <Brain className="w-4 h-4" /> },
    { id: 'frontend', name: 'Frontend Eng', icon: <Layout className="w-4 h-4" /> },
    { id: 'backend', name: 'Backend Eng', icon: <Server className="w-4 h-4" /> },
    { id: 'marketing', name: 'Marketing / GTM', icon: <Megaphone className="w-4 h-4" /> },
    { id: 'ops', name: 'Operations', icon: <Briefcase className="w-4 h-4" /> },
  ];

  const DEFAULT_TEMPLATES: Record<string, string> = {
    general: "You are participating in a town hall of expert advisors. Analyze the problem from multiple angles, identify hidden risks, and propose a robust solution.",
    frontend: "You are participating in a town hall of staff-level frontend engineers. Focus on accessibility, performance, React best practices, and maintainable CSS architecture.",
    backend: "You are participating in a town hall of staff-level backend engineers. Focus on scalability, database performance, security, and API design.",
    marketing: "You are participating in a town hall of expert growth marketers. Focus on positioning, target audience, conversion optimization, and brand consistency.",
    ops: "You are participating in a town hall of expert COOs. Focus on process efficiency, resource allocation, risk mitigation, and operational scalability."
  };

  const [templateContents, setTemplateContents] = useState<Record<string, string>>(DEFAULT_TEMPLATES);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const discussionAreaRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recapReceivedRef = useRef(false);
  const messagesRef = useRef(messages);
  messagesRef.current = messages; // Always keep ref in sync

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const resetThreadView = () => {
    setMessages([]);
    setRecap(null);
    recapReceivedRef.current = false;
    setCurrentRound(null);
    setPhase('idle');
    setFinalConfidence(null);
    setIsConsensus(null);
    setRecommendation(null);
    setKeyCaveat(null);
    setNextStep(null);
    setElapsedTime(null);
    setEstimatedCost(null);
    setLiveCost(0);
    setLiveElapsed(0);
    setAgentPayload(null);
    setIsTranscriptExpanded(true);
  };

  const applyThreadSummary = (summary: any) => {
    if (!summary || typeof summary !== 'object') return;
    if (summary.finalConfidence !== undefined) setFinalConfidence(summary.finalConfidence);
    if (summary.isConsensus !== undefined) setIsConsensus(summary.isConsensus);
    if (summary.recommendation !== undefined) setRecommendation(summary.recommendation);
    if (summary.keyCaveat !== undefined) setKeyCaveat(summary.keyCaveat);
    if (summary.nextStep !== undefined) setNextStep(summary.nextStep);
    if (summary.elapsedTime !== undefined) setElapsedTime(summary.elapsedTime);
    if (summary.estimatedCost !== undefined) setEstimatedCost(summary.estimatedCost);
    if (summary.liveCost !== undefined) setLiveCost(summary.liveCost);
    if (summary.liveElapsed !== undefined) setLiveElapsed(summary.liveElapsed);
    if (summary.agentPayload !== undefined) setAgentPayload(summary.agentPayload);
  };

  const hydrateThreadFromLocal = (tid: string) => {
    let restored = false;

    const savedMsgs = localStorage.getItem(`council_msgs_${tid}`);
    if (savedMsgs) {
      try {
        setMessages(JSON.parse(savedMsgs));
        restored = true;
      } catch {}
    }

    const savedRecap = localStorage.getItem(`council_recap_${tid}`);
    if (savedRecap) {
      setRecap(savedRecap);
      setIsTranscriptExpanded(false);
      restored = true;
    }

    const savedSummary = localStorage.getItem(`council_summary_${tid}`);
    if (savedSummary) {
      try {
        applyThreadSummary(JSON.parse(savedSummary));
        restored = true;
      } catch {}
    }

    const savedPhase = localStorage.getItem(`council_phase_${tid}`);
    if (savedPhase === 'awaiting_clarification') {
      setPhase('awaiting_clarification');
      setIsLoading(false);
      setIsTyping(false);
      restored = true;
    } else if (savedPhase && savedPhase !== 'idle') {
      setPhase('idle');
      restored = true;
    }

    return restored;
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  // When recap arrives, scroll to the top so user sees the Decision Summary card
  useEffect(() => {
    if (recap) {
      discussionAreaRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [recap]);

  // Load threads from localStorage (serverless has no persistent memory)
  useEffect(() => {
    const saved = localStorage.getItem('council_threads');
    if (saved) {
      try { setThreads(JSON.parse(saved)); } catch {}
    }
    const savedProtocols = localStorage.getItem('townhall_protocols');
    if (savedProtocols) setProtocols(new Set(JSON.parse(savedProtocols)));
  }, []);

  // Save threads to localStorage whenever they change
  useEffect(() => {
    if (threads.length > 0) {
      localStorage.setItem('council_threads', JSON.stringify(threads));
    }
  }, [threads]);

  // Persist messages + phase per thread to localStorage
  useEffect(() => {
    if (activeThreadId && messages.length > 0) {
      localStorage.setItem(`council_msgs_${activeThreadId}`, JSON.stringify(messages));
      if (recap) localStorage.setItem(`council_recap_${activeThreadId}`, recap);
    }
  }, [messages, recap, activeThreadId]);

  useEffect(() => {
    if (!activeThreadId) return;

    const hasSummary =
      finalConfidence !== null ||
      isConsensus !== null ||
      !!recommendation ||
      !!keyCaveat ||
      !!nextStep ||
      !!elapsedTime ||
      !!estimatedCost ||
      liveCost > 0 ||
      liveElapsed > 0 ||
      !!agentPayload;

    if (!hasSummary) return;

    localStorage.setItem(`council_summary_${activeThreadId}`, JSON.stringify({
      finalConfidence,
      isConsensus,
      recommendation,
      keyCaveat,
      nextStep,
      elapsedTime,
      estimatedCost,
      liveCost,
      liveElapsed,
      agentPayload,
    }));
  }, [
    activeThreadId,
    finalConfidence,
    isConsensus,
    recommendation,
    keyCaveat,
    nextStep,
    elapsedTime,
    estimatedCost,
    liveCost,
    liveElapsed,
    agentPayload,
  ]);

  // Persist phase per thread so clarification survives refresh/tab sleep
  useEffect(() => {
    if (activeThreadId && phase !== 'idle') {
      localStorage.setItem(`council_phase_${activeThreadId}`, phase);
    }
  }, [phase, activeThreadId]);

  // Load messages from localStorage when switching threads
  useEffect(() => {
    if (activeThreadId) {
      hydrateThreadFromLocal(activeThreadId);
    }
  }, [activeThreadId]);

  const fetchThreads = async () => {
    // On serverless, /threads may be empty — merge with localStorage
    try {
      const res = await fetch('/threads');
      const data = await res.json();
      if (data.length > 0) {
        setThreads(prev => {
          const merged = new Map(prev.map(thread => [thread.id, thread]));
          for (const thread of data) {
            merged.set(thread.id, { ...merged.get(thread.id), ...thread, source: 'live' });
          }
          return Array.from(merged.values()).sort((a, b) => +new Date(b.created) - +new Date(a.created));
        });
      }
    } catch {}
  };

  const fetchThreadDetail = async (tid: string) => {
    setIsLoading(true);
    resetThreadView();
    setActiveThreadId(tid);
    const restoredFromLocal = hydrateThreadFromLocal(tid);

    try {
      const res = await fetch(`/thread/${tid}`);
      if (!res.ok) {
        if (!restoredFromLocal) {
          throw new Error(`Thread lookup failed: ${res.status}`);
        }
        return;
      }

      const data = await res.json();

      if (data.source === 'file') {
        setRecap(data.content);
        setMessages([]);
        setIsTranscriptExpanded(false);
        return;
      }

      if (data.summary) applyThreadSummary(data.summary);

      if (data.messages) setMessages(data.messages);
      if (data.recap) {
        setRecap(data.recap);
        setIsTranscriptExpanded(false);
      } else {
        setRecap(null);
        setIsTranscriptExpanded(true);
      }
    } catch (err) {
      console.error('Failed to fetch thread detail', err);
      if (!restoredFromLocal) {
        setActiveThreadId(null);
        resetThreadView();
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-save completed session to cloud (Vercel Blob)
  const saveToCloud = async (threadId: string) => {
    try {
      const currentMessages = messagesRef.current;
      const threadList = JSON.parse(localStorage.getItem('council_threads') || '[]');
      const thread = threadList.find((t: any) => t.id === threadId);
      const savedRecap = localStorage.getItem(`council_recap_${threadId}`);

      const res = await fetch(`/save/${threadId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thread: thread || { id: threadId, status: 'complete' },
          messages: currentMessages,
          recap: savedRecap || '',
          summary: {
            finalConfidence,
            isConsensus,
            recommendation,
            keyCaveat,
            nextStep,
            elapsedTime,
            estimatedCost,
            liveCost,
            liveElapsed,
            agentPayload,
          },
        }),
      });
      const result = await res.json();
      if (result.success) {
        console.log(`[Cloud] Saved thread ${threadId} → ${result.url}`);
      } else {
        console.warn(`[Cloud] Save failed:`, result.error);
      }
    } catch (err) {
      console.warn('[Cloud] Auto-save failed:', err);
    }
  };

  // Process an SSE data event from the stream
  const processSSEData = (data: any) => {
    if (data.ping) return;

    if (data.type === 'thread_created') {
      // First event — thread ID
      return;
    }

    if (data.type === 'cost_update') {
      setLiveCost(data.totalCost || 0);
      setLiveElapsed(data.elapsed || 0);
      return;
    }

    if (data.typing !== undefined) {
      setIsTyping(data.typing);
      return;
    }

    if (data.phase !== undefined) {
      setPhase(data.phase);
      // When clarification round ends, stop loading — user needs to respond
      if (data.phase === 'awaiting_clarification') {
        setIsLoading(false);
        setIsTyping(false);
      }
      if (!data.text && !data.round && !data.recap) return;
    }

    if (data.round) {
      setCurrentRound(data.round);
      setMessages(prev => [...prev, { ...data, role: 'system', text: data.round }]);
      return;
    }

    // Status messages (type: "status") render as dividers, not as model/moderator messages
    if (data.type === 'status' && data.text) {
      setMessages(prev => [...prev, { ...data, role: 'system', text: data.text }]);
      return;
    }

    if (data.type === 'recap' || data.recap) {
      recapReceivedRef.current = true;
      setRecap(data.text || data.recap);
      if (data.confidence !== undefined) setFinalConfidence(data.confidence > 1 ? data.confidence / 100 : data.confidence);
      if (data.isConsensus !== undefined) setIsConsensus(data.isConsensus);
      if (data.recommendation !== undefined) setRecommendation(data.recommendation);
      if (data.keyCaveat !== undefined) setKeyCaveat(data.keyCaveat);
      if (data.nextStep !== undefined) setNextStep(data.nextStep);
      if (data.elapsedTime !== undefined) setElapsedTime(data.elapsedTime);
      if (data.estimatedCost !== undefined) setEstimatedCost(data.estimatedCost);
      if (data.agentPayload !== undefined) setAgentPayload(data.agentPayload);
      setIsTranscriptExpanded(false);
      // Auto-save to cloud on completion
      if (data.threadId || activeThreadId) {
        setTimeout(() => saveToCloud(data.threadId || activeThreadId!), 1000);
      }
      return;
    }

    if (data.done && data.phase === 'complete') {
      setIsTyping(false);
      setIsLoading(false);
      return;
    }

    if (data.text) {
      setMessages(prev => {
        const last = prev[prev.length - 1];
        // If same model sent a non-done message, replace it (streaming update)
        if (last && last.name === data.name && last.role === data.role && !last.done) {
          return [...prev.slice(0, -1), {
            ...last,
            text: data.text, // Replace, not append (server sends full text each time)
            done: data.done,
            phase: data.phase || last.phase,
            confidence: data.confidence !== undefined ? data.confidence : last.confidence,
            assumptions: data.assumptions || last.assumptions
          }];
        }
        return [...prev, data];
      });
    }
  };

  // Read SSE events from a fetch Response stream
  const readSSEStream = async (response: Response) => {
    const reader = response.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Parse SSE frames
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            processSSEData(data);
          } catch {}
        }
      }
    }
    // Process any remaining buffer
    if (buffer.startsWith('data: ')) {
      try {
        const data = JSON.parse(buffer.slice(6));
        processSSEData(data);
      } catch {}
    }
  };

  const handleStart = async () => {
    if (!inputText.trim()) return;
    const topic = inputText.trim();
    setIsLoading(true);
    setMessages([{ thread_id: '', role: 'human' as const, text: topic, done: true }]);
    setRecap(null);
    recapReceivedRef.current = false;
    setIsTranscriptExpanded(true);
    setPhase('blind_draft');
    setInputText('');
    setLiveCost(0);
    setLiveElapsed(0);
    setElapsedTime(null);
    setEstimatedCost(null);

    // Abort any previous stream
    if (abortRef.current) abortRef.current.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    let startThreadId: string | null = null;
    try {
      const body = {
        topic,
        models: Array.from(selectedModels).map(m => MODELS[m].id),
        tier, stakes, reversible, confidenceThreshold, synthesisStrategy,
        template: selectedTemplate,
        templateContent: templateContents[selectedTemplate],
        systemContext: businessContext || undefined, // Wire businessContext → systemContext for server
        businessContext, isRagConnected,
      };

      const res = await fetch('/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abort.signal,
      });

      // Read thread_id from first event, then set it
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream')) {
        // Clone the response so we can peek at the first event
        // Actually just process the whole stream — thread_created will come first
        let threadId: string | null = null;

        const reader = res.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === 'thread_created' && data.thread_id) {
                  threadId = data.thread_id;
                  startThreadId = threadId;
                  setActiveThreadId(threadId);
                  // Add thread to sidebar
                  setThreads(prev => [{
                    id: threadId!,
                    topic,
                    status: 'active' as const,
                    source: 'live' as const,
                    created: new Date().toISOString(),
                  }, ...prev]);
                } else {
                  processSSEData(data);
                }
              } catch {}
            }
          }
        }

        // Update thread status — only mark complete if we're past clarification
        if (threadId && phase !== 'awaiting_clarification') {
          setThreads(prev => prev.map(t =>
            t.id === threadId ? { ...t, status: 'complete' as const } : t
          ));
        }
      } else {
        // Fallback: JSON response (local dev)
        const data = await res.json();
        setActiveThreadId(data.thread_id);
        setThreads(prev => [{
          id: data.thread_id,
          topic,
          status: 'active' as const,
          source: 'live' as const,
          created: new Date().toISOString(),
        }, ...prev]);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Failed to start thread', err);
      }
    } finally {
      setIsLoading(false);
      // If stream ended without recap, try standalone synthesis with fresh 300s budget
      if (!recapReceivedRef.current && startThreadId) {
        await attemptSynthesisRecovery(startThreadId);
      }
    }
  };

  const handleHumanMessage = async () => {
    if (!inputText.trim() || !activeThreadId) return;
    const text = inputText;
    setInputText('');
    setMessages(prev => [...prev, { thread_id: activeThreadId, role: 'human', text }]);

    const lowerText = text.toLowerCase();
    const mentionsAll = lowerText.includes('all') || lowerText.includes('everyone') || lowerText.includes("y'all");

    let modelsToAddress = Array.from(selectedModels).map(m => MODELS[m].id) as string[];

    if (!mentionsAll) {
      const explicitModels: string[] = [];
      if (lowerText.includes('claude') || lowerText.includes('opus')) explicitModels.push(MODELS['Claude Opus 4.6'].id);
      if (lowerText.includes('gemini')) explicitModels.push(MODELS['Gemini 3.1 Pro'].id);
      if (lowerText.includes('gpt')) explicitModels.push(MODELS['GPT-5.4'].id);
      if (lowerText.includes('deepseek')) explicitModels.push(MODELS['DeepSeek V3.2'].id);
      if (lowerText.includes('grok')) explicitModels.push(MODELS['Grok 4'].id);
      if (lowerText.includes('llama')) explicitModels.push(MODELS['Llama 4 Maverick'].id);
      if (lowerText.includes('mistral')) explicitModels.push(MODELS['Mistral Large'].id);
      if (lowerText.includes('qwen')) explicitModels.push(MODELS['Qwen3 235B'].id);
      if (lowerText.includes('sonnet')) explicitModels.push(MODELS['Claude Sonnet 4.6'].id);

      if (explicitModels.length > 0) {
        modelsToAddress = explicitModels;
        const newSelected = new Set<ModelKey>();
        Object.entries(MODELS).forEach(([key, info]) => {
          if (explicitModels.includes(info.id)) newSelected.add(key as ModelKey);
        });
        setSelectedModels(newSelected);
      }
    } else {
      setSelectedModels(new Set(Object.keys(MODELS) as ModelKey[]));
      modelsToAddress = Object.values(MODELS).map(m => m.id);
    }

    try {
      // Send topic + recent messages for serverless reconstruction
      const activeThread = threads.find(t => t.id === activeThreadId);
      const recentMsgs = messages.filter(m => m.done && m.text && m.text.length > 10).slice(-20);
      const res = await fetch('/human', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thread_id: activeThreadId,
          topic: activeThread?.topic || '',
          text,
          models: modelsToAddress,
          systemContext: businessContext || undefined,
          previousMessages: recentMsgs,
          tier
        }),
      });

      // Read SSE stream from follow-up response
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream')) {
        await readSSEStream(res);
      }
    } catch (err) {
      console.error('Failed to send human message', err);
    }
  };

  // ── Auto-synthesize: if stream dies before recap, call /synthesize with its own 300s budget ──
  const attemptSynthesisRecovery = async (threadId: string) => {
    if (recapReceivedRef.current) return; // Already got recap

    // First check if we already have a complete synthesis message (recap event lost)
    const currentMessages = messagesRef.current; // use ref for fresh state
    const synthMsg = [...currentMessages].reverse().find(m => (m as any).synthesis === true);
    if (synthMsg?.text && synthMsg.text.length > 200) {
      // Synthesis completed but recap event was lost — just promote it
      recapReceivedRef.current = true;
      setRecap(synthMsg.text);
      setPhase('idle');
      return;
    }

    // Extract round data from messages to feed standalone synthesis endpoint
    const modelMsgs = currentMessages.filter(m => m.role === 'model' && m.done && m.text && !m.text.startsWith('[Error'));
    const statusMsgs = currentMessages.filter(m => m.role === 'system');

    // Find phase boundaries
    const r1Start = statusMsgs.findIndex(m => m.text?.includes('Round 1'));
    const r2Start = statusMsgs.findIndex(m => m.text?.includes('Round 2'));
    const bsStart = statusMsgs.findIndex(m => m.text?.includes('Quality check'));
    const synthStart = statusMsgs.findIndex(m => m.text?.includes('Synthesis'));

    // Collect round 1 model responses (messages between R1 and R2 status markers)
    let round1Text = '';
    let round2Text = '';
    let bsText = '';

    // Simple approach: use message names and positions
    const r1Models = modelMsgs.filter(m => {
      const idx = currentMessages.indexOf(m);
      const r2StatusIdx = currentMessages.findIndex(m2 => m2.role === 'system' && m2.text?.includes('Round 2'));
      return r2StatusIdx > 0 ? idx < r2StatusIdx : false;
    });
    round1Text = r1Models.map(m => `**${m.name}:** ${m.text}`).join('\n\n');

    const r2Models = modelMsgs.filter(m => {
      const idx = currentMessages.indexOf(m);
      const r2StatusIdx = currentMessages.findIndex(m2 => m2.role === 'system' && m2.text?.includes('Round 2'));
      const bsStatusIdx = currentMessages.findIndex(m2 => m2.role === 'system' && (m2.text?.includes('Quality check') || m2.text?.includes('Synthesis')));
      return r2StatusIdx > 0 && idx > r2StatusIdx && (bsStatusIdx > 0 ? idx < bsStatusIdx : true);
    });
    round2Text = r2Models.map(m => `**${m.name}:** ${m.text}`).join('\n\n');

    const bsMsg = modelMsgs.find(m => m.name === 'bs-detector');
    bsText = bsMsg?.text && !bsMsg.text.startsWith('[') ? bsMsg.text : '';

    if (!round1Text) {
      // No round data — can't synthesize
      setPhase('idle');
      return;
    }

    console.log('[Council] Rounds complete but synthesis missing/truncated — calling /synthesize endpoint');

    // Call /synthesize with its own fresh 300s budget
    try {
      setIsLoading(true);
      setPhase('synthesizing');
      const activeThread = threads.find(t => t.id === threadId);
      const res = await fetch('/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thread_id: threadId,
          topic: activeThread?.topic || '',
          models: Array.from(selectedModels).map(m => MODELS[m].id),
          round1: round1Text,
          round2: round2Text,
          bsDetector: bsText,
        }),
      });

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream')) {
        await readSSEStream(res);
      }
    } catch (err: any) {
      console.error('[Council] Synthesis recovery failed:', err);
    } finally {
      setIsLoading(false);
      if (!recapReceivedRef.current) {
        // Last-ditch: check if synthesis message arrived this time
        setMessages(prev => {
          const s = [...prev].reverse().find(m => (m as any).synthesis === true);
          if (s?.text && s.text.length > 100) {
            recapReceivedRef.current = true;
            setRecap(s.text);
          }
          setPhase('idle');
          return prev;
        });
      }
    }
  };

  // Detect if a thread died mid-stream and can be resumed
  const threadIsStalled = activeThreadId && messages.length > 0 && !recap && !isLoading && phase === 'idle';

  // Resume a stalled/failed thread — re-runs analysis from where it left off
  const handleResume = () => {
    if (!activeThreadId) return;
    // Find any human answers from the clarification phase
    const humanMsgs = messages.filter(m => m.role === 'human' && m.done);
    const lastAnswer = humanMsgs.length > 0 ? humanMsgs[humanMsgs.length - 1].text : '';
    handleClarify(lastAnswer || undefined);
  };

  // Handle clarifying question answers (or skip)
  const handleClarify = async (answers?: string) => {
    if (!activeThreadId) return;
    setIsLoading(true);
    setPhase('blind_draft');
    recapReceivedRef.current = false;

    // If user provided answers, show them in the chat
    if (answers) {
      setMessages(prev => [...prev, { thread_id: activeThreadId, role: 'human', text: answers, done: true }]);
    }

    // Abort any previous stream
    if (abortRef.current) abortRef.current.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    try {
      // Send full context — serverless can't remember the thread from /start
      const activeThread = threads.find(t => t.id === activeThreadId);
      const res = await fetch('/clarify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thread_id: activeThreadId,
          topic: activeThread?.topic || '',
          models: Array.from(selectedModels).map(m => MODELS[m].id),
          systemContext: businessContext || undefined,
          answers: answers || '',
        }),
        signal: abort.signal,
      });

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream')) {
        await readSSEStream(res);
      }

      // Update thread status to complete + clear stored phase
      setThreads(prev => prev.map(t =>
        t.id === activeThreadId ? { ...t, status: 'complete' as const } : t
      ));
      localStorage.removeItem(`council_phase_${activeThreadId}`);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Failed to resume after clarification', err);
      }
    } finally {
      setIsLoading(false);
      // If stream ended without recap, try standalone synthesis with fresh 300s budget
      if (!recapReceivedRef.current && activeThreadId) {
        await attemptSynthesisRecovery(activeThreadId);
      }
    }
  };

  const handleSave = async () => {
    if (!activeThreadId) return;
    try {
      await fetch(`/save/${activeThreadId}`, { method: 'POST' });
      fetchThreads();
    } catch (err) {
      console.error('Failed to save thread', err);
    }
  };

  const toggleProtocol = (tid: string) => {
    const newProtocols = new Set(protocols);
    if (newProtocols.has(tid)) newProtocols.delete(tid);
    else newProtocols.add(tid);
    setProtocols(newProtocols);
    localStorage.setItem('townhall_protocols', JSON.stringify(Array.from(newProtocols)));
  };

  const downloadMarkdown = () => {
    if (!recap && !messages.length) return;
    const content = recap || messages.map(m => `### ${m.name || m.role}\n${m.text}\n`).join('\n---\n');
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `townhall-${activeThreadId || 'export'}.md`;
    a.click();
  };

  const filteredThreads = useMemo(() => {
    return threads.filter(t => {
      const matchesSearch = t.topic.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesProtocol = showProtocolsOnly ? protocols.has(t.id) : true;
      return matchesSearch && matchesProtocol;
    });
  }, [threads, searchQuery, showProtocolsOnly, protocols]);

  const filteredMessages = useMemo(() => {
    if (filterModel === 'all') return messages;
    return messages.filter(m => m.role === 'system' || m.role === 'human' || m.name === filterModel);
  }, [messages, filterModel]);

  const groupedMessages = useMemo(() => {
    const groups: { type: 'linear' | 'grid', messages: Message[] }[] = [];
    let currentGroup: { type: 'linear' | 'grid', messages: Message[] } | null = null;

    filteredMessages.forEach(msg => {
      if (msg.role === 'model' && msg.phase === 'blind_draft') {
        if (currentGroup?.type === 'grid') {
          currentGroup.messages.push(msg);
        } else {
          if (currentGroup) groups.push(currentGroup);
          currentGroup = { type: 'grid', messages: [msg] };
        }
      } else {
        if (currentGroup?.type === 'linear') {
          currentGroup.messages.push(msg);
        } else {
          if (currentGroup) groups.push(currentGroup);
          currentGroup = { type: 'linear', messages: [msg] };
        }
      }
    });
    if (currentGroup) groups.push(currentGroup);
    return groups;
  }, [filteredMessages]);

  const toggleModelSelection = (model: ModelKey) => {
    const newSet = new Set(selectedModels);
    if (newSet.has(model)) {
      if (newSet.size > 1) newSet.delete(model);
    } else {
      newSet.add(model);
    }
    setSelectedModels(newSet);
  };

  return (
    <div className="flex h-screen bg-[#0a0a0a] text-[#ededed] overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-80 border-r border-[#262626] bg-[#121212] flex flex-col z-20">
        <div className="p-4 border-b border-[#262626] flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-lg tracking-tight">
            <Terminal className="w-5 h-5 text-blue-500" />
            TOWN HALL
          </div>
          <button 
            onClick={() => {
              setActiveThreadId(null);
              setMessages([]);
              setRecap(null);
              setIsTranscriptExpanded(true);
            }}
            className="p-1.5 hover:bg-white/5 rounded-md transition-colors text-white/60 hover:text-white"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>

        <div className="p-3 space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
            <input 
              type="text"
              placeholder="Search history..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-black/40 border border-[#262626] rounded-md py-1.5 pl-9 pr-3 text-sm focus:outline-none focus:border-blue-500/50 transition-colors"
            />
          </div>
          <button 
            onClick={() => setShowProtocolsOnly(!showProtocolsOnly)}
            className={cn(
              "w-full flex items-center justify-between px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all border",
              showProtocolsOnly 
                ? "bg-blue-500/10 border-blue-500/30 text-blue-400" 
                : "bg-white/5 border-white/5 text-white/40 hover:text-white/60"
            )}
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-3.5 h-3.5" />
              Approved Only
            </div>
            {showProtocolsOnly && <X className="w-3 h-3" />}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {filteredThreads.map((thread) => (
            <button
              key={thread.id}
              onClick={() => fetchThreadDetail(thread.id)}
              className={cn(
                "w-full text-left p-4 border-b border-[#262626] hover:bg-white/5 transition-colors group relative",
                activeThreadId === thread.id && "bg-white/5"
              )}
            >
              {activeThreadId === thread.id && <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500" />}
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-widest text-white/40 font-mono">
                  {thread.id}
                </span>
                <div className="flex gap-1">
                  {protocols.has(thread.id) && <ShieldCheck className="w-3 h-3 text-blue-400" />}
                  <span className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded font-mono",
                    thread.status === 'active' ? "bg-green-500/20 text-green-400" :
                    thread.status === 'complete' ? "bg-blue-500/20 text-blue-400" :
                    "bg-white/10 text-white/60"
                  )}>
                    {thread.status}
                  </span>
                </div>
              </div>
              <div className="text-sm font-medium line-clamp-2 group-hover:text-white transition-colors">
                {thread.topic}
              </div>
              <div className="mt-2 text-[10px] text-white/30 flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <History className="w-3 h-3" />
                  {format(new Date(thread.created), 'MMM d, HH:mm')}
                </div>
                {thread.source === 'file' && <FileText className="w-3 h-3" />}
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative min-w-0 bg-[#0a0a0a]">
        {/* Header */}
        <header className="h-14 border-b border-[#262626] flex items-center justify-between px-6 bg-[#0a0a0a]/80 backdrop-blur-md z-10">
          <div className="flex items-center gap-4 min-w-0">
            {activeThreadId ? (
              <>
                <div className="flex items-center gap-2 text-white/40 text-sm font-mono">
                  <ChevronRight className="w-4 h-4" />
                  {activeThreadId}
                </div>
                <h2 className="text-sm font-semibold truncate max-w-md">
                  {threads.find(t => t.id === activeThreadId)?.topic || "Discussion"}
                </h2>
                <div className="flex items-center gap-2 ml-2">
                  <span className={cn(
                    "text-[10px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider border",
                    (threads.find(t => t.id === activeThreadId)?.stakes || stakes) === 'low' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                    (threads.find(t => t.id === activeThreadId)?.stakes || stakes) === 'medium' ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                    "bg-rose-500/10 text-rose-400 border-rose-500/20"
                  )}>
                    {(threads.find(t => t.id === activeThreadId)?.stakes || stakes) === 'low' ? '🟢 LOW' :
                     (threads.find(t => t.id === activeThreadId)?.stakes || stakes) === 'medium' ? '🟡 MEDIUM' : '🔴 HIGH'}
                  </span>
                  <span className={cn(
                    "text-[10px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider border",
                    (threads.find(t => t.id === activeThreadId)?.reversible ?? reversible)
                      ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                      : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                  )}>
                    {(threads.find(t => t.id === activeThreadId)?.reversible ?? reversible) ? 'REVERSIBLE' : 'IRREVERSIBLE'}
                  </span>
                </div>
              </>
            ) : (
              <h2 className="text-sm font-semibold">New Discussion</h2>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            {activeThreadId && (
              <>
                <div className="flex items-center gap-1 bg-white/5 rounded-lg p-0.5 border border-white/10 mr-2">
                  <button 
                    onClick={() => setFilterModel('all')}
                    className={cn(
                      "p-1.5 rounded-md transition-all",
                      filterModel === 'all' ? "bg-white/10 text-white" : "text-white/40 hover:text-white/60"
                    )}
                    title="Show all models"
                  >
                    <Filter className="w-3.5 h-3.5" />
                  </button>
                  {Object.entries(MODELS).map(([name, info]) => (
                    <button
                      key={name}
                      onClick={() => setFilterModel(name as ModelKey)}
                      className={cn(
                        "w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold transition-all",
                        filterModel === name ? "ring-1 ring-offset-1 ring-offset-black" : "opacity-40 hover:opacity-100"
                      )}
                      style={{ 
                        backgroundColor: info.color,
                        '--tw-ring-color': info.color
                      } as React.CSSProperties}
                      title={`Filter by ${name}`}
                    >
                      {name.charAt(0)}
                    </button>
                  ))}
                </div>

                <button 
                  onClick={downloadMarkdown}
                  className="p-2 hover:bg-white/5 rounded-md text-white/40 hover:text-white transition-colors"
                  title="Download Markdown"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  onClick={handleSave}
                  className="p-2 hover:bg-white/5 rounded-md text-white/40 hover:text-white transition-colors"
                  title="Save to Disk"
                >
                  <Save className="w-4 h-4" />
                </button>
              </>
            )}
            <button
              onClick={() => setShowHowItWorks(true)}
              className="p-2 hover:bg-white/5 rounded-md text-white/40 hover:text-white transition-colors"
              title="Methodology — How Town Hall Works"
            >
              <BookOpen className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Discussion Area */}
        <div ref={discussionAreaRef} className="flex-1 overflow-y-auto custom-scrollbar">
          {!activeThreadId && (
            <div className="max-w-4xl mx-auto py-16 px-8 space-y-12">
              <div className="space-y-4 text-center">
                <div className="w-16 h-16 bg-blue-500/10 rounded-2xl flex items-center justify-center border border-blue-500/20 mx-auto">
                  <Terminal className="w-8 h-8 text-blue-500" />
                </div>
                <h1 className="text-4xl font-bold tracking-tight">Town Hall</h1>
                <p className="text-white/40 text-lg max-w-xl mx-auto leading-relaxed">
                  Select your models and define the topic. The Town Hall will pressure-test the question from multiple angles and converge on the highest-probability correct decision it can defend.
                </p>
                <button 
                  onClick={() => setShowHowItWorks(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-medium text-white/80 transition-colors mt-4"
                >
                  <HelpCircle className="w-4 h-4 text-blue-400" />
                  How does this work?
                </button>
              </div>

              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-white/40 flex items-center gap-2">
                    <Settings2 className="w-4 h-4" />
                    Town Hall Configuration
                    <Tip text="Pick which AI models join the discussion. More models = more perspectives but higher cost." />
                  </h3>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedModels(new Set(Object.keys(MODELS).filter(k => MODELS[k as ModelKey].tier === 'frontier') as ModelKey[]))}
                      className="text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded-md transition-colors bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20"
                      title="Frontier models — Claude, GPT-5.4, Grok 4"
                    >
                      Frontier
                    </button>
                    <button
                      onClick={() => setSelectedModels(new Set(Object.keys(MODELS).filter(k => MODELS[k as ModelKey].tier === 'strong') as ModelKey[]))}
                      className="text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded-md transition-colors bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20"
                      title="Strong models at great value — Gemini Pro, DeepSeek"
                    >
                      Value
                    </button>
                    <button
                      onClick={() => setSelectedModels(new Set(Object.keys(MODELS) as ModelKey[]))}
                      className="text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded-md transition-colors bg-white/5 text-white/60 border border-white/10 hover:bg-white/10 hover:text-white"
                    >
                      All
                    </button>
                    <button
                      onClick={() => setSelectedModels(new Set())}
                      className="text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded-md transition-colors bg-white/5 text-white/60 border border-white/10 hover:bg-white/10 hover:text-white"
                    >
                      Clear
                    </button>
                    <div className="text-[10px] text-white/20 font-mono ml-2 border-l border-white/10 pl-4">
                      {selectedModels.size} MODELS ACTIVE
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {(Object.keys(MODELS) as ModelKey[]).map((key) => {
                    const info = MODELS[key];
                    const isSelected = selectedModels.has(key);
                    return (
                      <button
                        key={key}
                        onClick={() => toggleModelSelection(key)}
                        className={cn(
                          "p-4 rounded-2xl border text-left transition-all duration-300 group relative overflow-hidden",
                          isSelected 
                            ? "bg-white/[0.03] border-white/20" 
                            : "bg-transparent border-white/5 opacity-40 grayscale hover:grayscale-0 hover:opacity-70"
                        )}
                      >
                        {isSelected && (
                          <div 
                            className="absolute top-0 left-0 w-1 h-full" 
                            style={{ backgroundColor: info.color }} 
                          />
                        )}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold text-white" style={{ backgroundColor: info.color }}>
                              {key.charAt(0)}
                            </div>
                            <span className="text-sm font-bold">{key}</span>
                          </div>
                          {isSelected && <CheckCircle2 className="w-4 h-4 text-blue-500" />}
                        </div>
                        <p className="text-xs text-white/40 leading-relaxed mt-3">
                          {info.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-white/40 flex items-center gap-2">
                    <BookOpen className="w-4 h-4" />
                    Context & Guardrails
                    <Tip text="Templates set the expertise lens. Business context gives models background info about your situation." />
                  </h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4 p-6 rounded-2xl border border-white/10 bg-white/[0.02]">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-bold">Discussion Template</label>
                      <button
                        onClick={() => setShowTemplateEditor(true)}
                        className="text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded-md flex items-center gap-1 transition-colors bg-white/5 text-white/40 border border-white/10 hover:bg-white/10 hover:text-white"
                      >
                        <Settings2 className="w-3 h-3" />
                        Edit
                      </button>
                    </div>
                    <p className="text-xs text-white/40 leading-relaxed">
                      Loads backend markdown templates to provide specific guardrails and instructions for the models.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {TEMPLATES.map(template => (
                        <button
                          key={template.id}
                          onClick={() => setSelectedTemplate(template.id)}
                          className={cn(
                            "flex items-center gap-2 px-3 py-2 rounded-xl text-xs transition-all border",
                            selectedTemplate === template.id
                              ? "bg-blue-500/10 border-blue-500/30 text-blue-400"
                              : "bg-white/5 border-transparent text-white/60 hover:bg-white/10 hover:text-white"
                          )}
                        >
                          {template.icon}
                          {template.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4 p-6 rounded-2xl border border-white/10 bg-white/[0.02] flex flex-col">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-bold">Context for the Town Hall</label>
                    </div>
                    <p className="text-xs text-white/40 leading-relaxed">
                      Paste architecture docs, repo details, constraints, or any background the models should know.
                      This gets injected into every model's prompt — more context = better recommendations.
                    </p>
                    <textarea
                      value={businessContext}
                      onChange={(e) => setBusinessContext(e.target.value)}
                      placeholder={"Paste context here — architecture docs, tech stack, constraints, business situation...\n\nExample:\n- We're a 2-person startup, pre-revenue\n- Stack: React 18, Node, Postgres on Railway\n- Main repo: github.com/org/repo\n- Key constraint: $500/mo infrastructure budget"}
                      className="w-full flex-1 min-h-[140px] bg-black/40 border border-[#262626] rounded-xl p-3 text-xs text-white/80 focus:outline-none focus:border-blue-500/50 transition-colors resize-y custom-scrollbar font-mono"
                    />
                    <div className="text-[10px] text-white/20 font-mono">
                      {businessContext.length > 0 ? `${businessContext.length} chars` : 'No context provided — models will work with the question alone'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <button
                  onClick={() => setShowAdvancedControls(prev => !prev)}
                  className="w-full flex items-center justify-between p-4 rounded-2xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.04] transition-colors text-left"
                >
                  <div className="space-y-1">
                    <div className="text-xs font-bold uppercase tracking-[0.2em] text-white/40 flex items-center gap-2">
                      <Cpu className="w-4 h-4" />
                      Advanced Controls
                    </div>
                    <p className="text-sm text-white/55">
                      Draft orchestration knobs for internal tuning. Safe to ignore for normal Town Hall use.
                    </p>
                  </div>
                  <ChevronRight className={cn("w-5 h-5 text-white/40 transition-transform", showAdvancedControls && "rotate-90")} />
                </button>

                {showAdvancedControls && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4 p-6 rounded-2xl border border-white/10 bg-white/[0.02]">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-bold">Synthesis Strategy <Tip text="How models reach a final answer. 'Debate until agree' runs the most thorough analysis." /></label>
                      </div>
                      <div className="space-y-2">
                        {(['majority', 'weighted_consensus', 'debate_to_consensus'] as const).map(strategy => (
                          <button
                            key={strategy}
                            onClick={() => setSynthesisStrategy(strategy as any)}
                            className={cn(
                              "w-full text-left px-4 py-3 rounded-xl text-sm transition-all border",
                              synthesisStrategy === strategy
                                ? "bg-blue-500/10 border-blue-500/30 text-blue-400"
                                : "bg-white/5 border-transparent text-white/60 hover:bg-white/10 hover:text-white"
                            )}
                          >
                            {strategy === 'majority' && "Find the most common agreement"}
                            {strategy === 'weighted_consensus' && "Weighted Consensus (Quality over Confidence)"}
                            {strategy === 'debate_to_consensus' && "Debate until they all agree"}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-4 p-6 rounded-2xl border border-white/10 bg-white/[0.02]">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-bold">Escalation Confidence Threshold <Tip text="If the AI's confidence in its answer is below this %, it flags the decision for your review." /></label>
                        <span className="text-sm font-mono text-blue-400">{confidenceThreshold}%</span>
                      </div>
                      <p className="text-xs text-white/40 leading-relaxed">
                        This is still a draft operator control. It is not the main Town Hall experience.
                      </p>
                      <input
                        type="range"
                        min="50"
                        max="99"
                        value={confidenceThreshold}
                        onChange={(e) => setConfidenceThreshold(parseInt(e.target.value))}
                        className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500"
                      />
                      <div className="flex justify-between text-[10px] font-mono text-white/30">
                        <span>50% (Lenient)</span>
                        <span>99% (Strict)</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeThreadId && recap && (
            <div className="max-w-4xl mx-auto py-16 px-8 space-y-12 animate-in fade-in zoom-in-95 duration-700">
              <div className="flex items-center gap-6">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-blue-500/30 to-blue-500/50" />
                <div className="flex flex-col items-center gap-2">
                  <ShieldCheck className="w-10 h-10 text-blue-500" />
                  <div className="text-xs font-bold uppercase tracking-[0.4em] text-blue-400">DECISION SUMMARY</div>
                </div>
                <div className="h-px flex-1 bg-gradient-to-l from-transparent via-blue-500/30 to-blue-500/50" />
              </div>

              <div className="bg-white/[0.02] border border-blue-500/20 rounded-[2.5rem] p-12 shadow-2xl shadow-blue-500/5 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-5">
                  <Terminal className="w-32 h-32" />
                </div>
                
                {/* Top Card */}
                <div className="space-y-8 mb-12">
                  <div className="space-y-2">
                    <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Recommended Action</h3>
                    <p className="text-2xl font-semibold text-white">{recommendation || "Pending recommendation..."}</p>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                    <div className="space-y-1">
                      <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Agreement State <Tip text="Unanimous = all agree. Additive = mostly agree with additions. Divergent = significant disagreements." /></div>
                      <div className={cn(
                        "text-sm font-bold flex items-center gap-2",
                        isConsensus === 'unanimous' ? "text-emerald-400" : 
                        isConsensus === 'additive' ? "text-blue-400" : 
                        isConsensus === 'divergent' ? "text-amber-400" : "text-white/40"
                      )}>
                        {isConsensus === 'unanimous' ? <><CheckCircle2 className="w-4 h-4" /> UNANIMOUS</> :
                         isConsensus === 'additive' ? <><Plus className="w-4 h-4" /> ADDITIVE</> :
                         isConsensus === 'divergent' ? <><Scale className="w-4 h-4" /> DIVERGENT</> :
                         "UNDERDETERMINED"}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Human Approval</div>
                      <div className="text-sm font-bold text-white">
                        {stakes === 'high' || !reversible ? 'REQUIRED' : 'OPTIONAL'}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Stakes</div>
                      <div className="text-sm font-bold text-white uppercase">
                        {stakes}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Reversibility</div>
                      <div className="text-sm font-bold text-white uppercase">
                        {reversible ? 'REVERSIBLE' : 'IRREVERSIBLE'}
                      </div>
                    </div>
                  </div>

                  {nextStep && (
                    <div className="space-y-2 pt-6 border-t border-white/10">
                      <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Next Step</h3>
                      <p className="text-sm text-white/90">{nextStep}</p>
                    </div>
                  )}

                  {keyCaveat && (
                    <div className="space-y-2 p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                      <h3 className="text-[10px] uppercase tracking-widest text-amber-500/60 font-bold flex items-center gap-2">
                        <AlertTriangle className="w-3 h-3" />
                        Key Risk / Assumption
                      </h3>
                      <p className="text-sm text-amber-500/90">{keyCaveat}</p>
                    </div>
                  )}

                  <div className="flex items-center gap-4 text-[10px] font-mono text-white/30 pt-4">
                    <span>ELAPSED: {elapsedTime || `${liveElapsed.toFixed(0)}s`}</span>
                    <span>COST: {estimatedCost || `$${liveCost.toFixed(3)}`}</span>
                  </div>
                </div>

                {/* Then: Why, Key assumptions, Evidence, etc. */}
                <div className="markdown-body prose-invert max-w-none border-t border-white/10 pt-8">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {recap}
                  </ReactMarkdown>
                </div>

                {/* Agent Payload */}
                {agentPayload && (
                  <div className="mt-8 pt-8 border-t border-white/10">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Structured Agent Payload</h3>
                      <button 
                        onClick={() => navigator.clipboard.writeText(JSON.stringify(agentPayload, null, 2))}
                        className="text-[10px] uppercase tracking-widest text-blue-400 hover:text-blue-300 font-bold flex items-center gap-1"
                      >
                        <Copy className="w-3 h-3" /> Copy JSON
                      </button>
                    </div>
                    <pre className="p-4 bg-black/50 rounded-xl text-xs font-mono text-white/60 overflow-x-auto">
                      {JSON.stringify(agentPayload, null, 2)}
                    </pre>
                  </div>
                )}

                <div className="mt-16 pt-10 border-t border-white/10 flex flex-wrap justify-between items-end gap-8">
                  <div className="flex items-center gap-8">
                    <div className="space-y-2">
                      <div className="text-[10px] uppercase tracking-widest text-white/30 font-bold">Confidence Score <Tip text="How confident the Town Hall is in this recommendation. Green = strong, Yellow = moderate, Red = uncertain." /></div>
                      <div className="flex items-center gap-3">
                        {finalConfidence !== null ? (
                          <>
                            <div className="h-2 w-32 bg-white/5 rounded-full overflow-hidden">
                              <div 
                                className={cn(
                                  "h-full transition-all duration-1000",
                                  finalConfidence >= 0.8 ? "bg-emerald-500" :
                                  finalConfidence >= 0.5 ? "bg-amber-500" : "bg-rose-500"
                                )} 
                                style={{ width: `${finalConfidence * 100}%` }} 
                              />
                            </div>
                            <div className={cn(
                              "text-lg font-mono font-bold",
                              finalConfidence >= 0.8 ? "text-emerald-400" :
                              finalConfidence >= 0.5 ? "text-amber-400" : "text-rose-400"
                            )}>
                              {Math.round(finalConfidence * 100)}%
                            </div>
                          </>
                        ) : (
                          <div className="flex items-center gap-3">
                            <div className="h-2 w-32 bg-white/5 rounded-full overflow-hidden">
                              <div className="h-full w-full bg-white/20" />
                            </div>
                            <div className="text-xs font-mono font-bold text-white/40">
                              UNAVAILABLE
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex gap-3">
                    <button 
                      onClick={() => toggleProtocol(activeThreadId)}
                      className={cn(
                        "px-6 py-3 rounded-2xl text-sm font-bold transition-all flex items-center gap-2 border",
                        protocols.has(activeThreadId)
                          ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400"
                          : "bg-blue-600 hover:bg-blue-500 border-blue-500 text-white shadow-lg shadow-blue-900/20"
                      )}
                    >
                      <ShieldCheck className="w-4 h-4" />
                      {protocols.has(activeThreadId) ? "Decision Approved" : "Approve Decision"}
                    </button>
                    <button 
                      onClick={() => alert('Decision posted to #ai-comms')}
                      className="px-6 py-3 bg-[#4A154B]/20 hover:bg-[#4A154B]/40 border border-[#4A154B]/50 text-[#E01E5A] rounded-2xl text-sm font-bold transition-all flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.523-2.522v-2.522h2.523zM15.165 17.688a2.527 2.527 0 0 1-2.523-2.523 2.526 2.526 0 0 1 2.523-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.52h-6.313z"/>
                      </svg>
                      Post to Slack
                    </button>
                    <button 
                      onClick={downloadMarkdown}
                      className="px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-2xl text-sm font-bold transition-all flex items-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      Export .md
                    </button>
                  </div>
                </div>
              </div>
              
              <div className="text-center space-y-2 pb-20">
                <p className="text-[10px] text-white/20 uppercase tracking-widest font-mono">
                  This document is a permanent record of consensus reached on {format(new Date(), 'yyyy-MM-dd HH:mm:ss')}
                </p>
                <p className="text-[10px] text-white/10 max-w-lg mx-auto">
                  Generated by the Town Hall multi-model decision engine.
                </p>
              </div>
            </div>
          )}

          {activeThreadId && (
            <div className="max-w-5xl mx-auto px-8 pb-8">
              {recap && (
                <button
                  onClick={() => setIsTranscriptExpanded(!isTranscriptExpanded)}
                  className="w-full py-4 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest text-white/40 hover:text-white/80 transition-colors border-t border-white/10"
                >
                  {isTranscriptExpanded ? 'Hide Full Transcript' : 'View Full Transcript'}
                  <ChevronRight className={cn("w-4 h-4 transition-transform", isTranscriptExpanded ? "rotate-90" : "")} />
                </button>
              )}
              
              {(!recap || isTranscriptExpanded) && (
                <div className="space-y-4 mt-8">
                  {groupedMessages.map((group, gi) => (
                    <div key={gi} className={group.type === 'grid' ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" : "space-y-4"}>
                      {group.messages.map((msg, i) => {
                        if (msg.role === 'system') {
                          return (
                            <div key={i} className="flex items-center gap-4 py-4 sticky top-0 z-10 bg-[#0a0a0a]/80 backdrop-blur-sm col-span-full">
                              <div className="h-px flex-1 bg-white/10" />
                              <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/40 bg-white/5 px-4 py-1.5 rounded-full border border-white/10 shadow-xl">
                                {msg.text}
                              </div>
                              <div className="h-px flex-1 bg-white/10" />
                            </div>
                          );
                        }

                        const modelInfo = msg.name
                          ? MODELS[msg.name as keyof typeof MODELS]
                            || Object.values(MODELS).find(m => m.id === msg.name)
                            || (msg.name === 'moderator' ? { id: 'moderator', color: '#fbbf24', tier: 'frontier' as const, description: 'Synthesis' } : null)
                            || (msg.name === 'bs-detector' ? { id: 'bs-detector', color: '#f43f5e', tier: 'frontier' as const, description: 'Quality Check' } : null)
                          : null;
                        const modelDisplayName = msg.name
                          ? (msg.name === 'bs-detector' ? '⚡ BS Detector' :
                             msg.name === 'moderator' ? '📋 Synthesis' :
                             Object.entries(MODELS).find(([, m]) => m.id === msg.name)?.[0] || msg.name)
                          : null;

                        return (
                          <div key={i} className={cn(
                            "group animate-in fade-in slide-in-from-bottom-4 duration-500",
                            "w-full"
                          )}>
                            <div className={cn(
                              "flex flex-col transition-all duration-300",
                              group.type === 'grid' 
                                ? "border-t-2 pt-4 px-4 pb-4 bg-white/[0.01] hover:bg-white/[0.02] h-full" 
                                : msg.role === 'human'
                                  ? "border-l-2 border-blue-500 pl-4 py-2 bg-blue-500/5"
                                  : "border-l-2 pl-4 py-2 bg-white/[0.01] hover:bg-white/[0.02]"
                            )}
                            style={msg.role === 'model' && modelInfo ? { 
                              [group.type === 'grid' ? 'borderTopColor' : 'borderLeftColor']: modelInfo.color 
                            } : {}}
                            >
                              <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-3">
                                  {msg.role === 'human' ? (
                                    <span className="text-xs font-mono font-bold uppercase tracking-wider text-blue-400">
                                      YOU
                                    </span>
                                  ) : msg.role === 'model' && modelInfo ? (
                                    <>
                                      <span className="text-xs font-mono font-bold uppercase tracking-wider" style={{ color: modelInfo.color }}>
                                        {modelDisplayName || msg.name}
                                      </span>
                                      {msg.confidence !== undefined && (
                                        <span className="text-[10px] font-mono text-white/40">
                                          CONF: {Math.round(msg.confidence > 1 ? msg.confidence : msg.confidence * 100)}%
                                        </span>
                                      )}
                                      {msg.phase === 'clarification' && (
                                        <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-500/80 border border-purple-500/20">
                                          Clarifying Qs
                                        </span>
                                      )}
                                      {msg.phase === 'blind_draft' && (
                                        <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/5 text-white/40 border border-white/10">
                                          Blind Pass
                                        </span>
                                      )}
                                      {msg.phase === 'targeted_debate' && (
                                        <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500/80 border border-amber-500/20">
                                          Cross-exam
                                        </span>
                                      )}
                                      {msg.phase === 'quality_check' && (
                                        <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-500/80 border border-rose-500/20">
                                          BS Check
                                        </span>
                                      )}
                                    </>
                                  ) : (
                                    <span className="text-xs font-mono font-bold uppercase tracking-wider text-blue-400">
                                      MODERATOR
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="markdown-body text-sm">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {msg.text}
                                </ReactMarkdown>
                              </div>
                              
                              {msg.assumptions && msg.assumptions.length > 0 && (
                                <div className="mt-4 pt-3 border-t border-white/5">
                                  <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-2">Assumptions</div>
                                  <ul className="space-y-1">
                                    {msg.assumptions.map((assumption, idx) => (
                                      <li key={idx} className="text-xs text-white/50 flex items-start gap-2 font-mono">
                                        <span className="text-white/20 mt-0.5">→</span>
                                        <span>{assumption}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}

                  {isTyping && (
                    <div className="flex items-center gap-4 text-white/40 py-4">
                      <div className="flex gap-1">
                        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" />
                      </div>
                      <span className="text-[10px] font-mono uppercase tracking-[0.2em]">
                        {phase === 'clarification' ? 'Seeking Clarification...' :
                         phase === 'awaiting_input' ? 'Awaiting Human Input...' :
                         phase === 'blind_draft' ? 'Drafting (Blind)...' :
                         phase === 'consensus_check' ? 'Checking Consensus...' :
                         phase === 'targeted_debate' ? 'Targeted Debate...' :
                         phase === 'synthesizing' ? 'Synthesizing...' :
                         'Town Hall is deliberating...'}
                      </span>
                    </div>
                  )}
                  <div ref={messagesEndRef} className="h-20" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-6 border-t border-[#262626] bg-[#0a0a0a]/80 backdrop-blur-md">
          <div className="max-w-4xl mx-auto space-y-4">
            {!activeThreadId && (
              <div className="flex items-center gap-4 text-xs font-mono">
                <div className="flex items-center gap-2 bg-white/5 rounded-lg p-1 border border-white/10">
                  <span className="px-2 text-white/40 flex items-center">STAKES:<Tip text="How important is this decision? High stakes = more scrutiny." /></span>
                  {(['low', 'medium', 'high'] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => setStakes(s)}
                      className={cn(
                        "px-3 py-1 rounded-md uppercase transition-all",
                        stakes === s 
                          ? s === 'low' ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" 
                            : s === 'medium' ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                            : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                          : "text-white/40 hover:text-white/80 border border-transparent"
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setReversible(!reversible)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all uppercase",
                    reversible 
                      ? "bg-blue-500/20 text-blue-400 border-blue-500/30" 
                      : "bg-rose-500/20 text-rose-400 border-rose-500/30"
                  )}
                >
                  {reversible ? "REVERSIBLE" : "IRREVERSIBLE"}
                </button>
              </div>
            )}
            {isLoading && (
              <div className="flex items-center justify-center gap-6 py-2 text-[11px] font-mono text-white/40">
                {(liveCost > 0 || liveElapsed > 0) && (
                  <>
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      {liveElapsed.toFixed(0)}s elapsed
                    </span>
                    <span className="text-emerald-400/70">${liveCost.toFixed(3)} spent</span>
                  </>
                )}
                <button
                  onClick={() => {
                    if (abortRef.current) abortRef.current.abort();
                    setIsLoading(false);
                    setIsTyping(false);
                    // If we have any messages, we can offer to view partial results
                    if (messages.length > 0) {
                      setRecap(null); // No synthesis yet
                      setIsTranscriptExpanded(true);
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20 transition-colors"
                >
                  <X className="w-3 h-3" />
                  Interrupt
                  <Tip text="Stops the discussion. You'll see partial results and can ask follow-up questions." />
                </button>
              </div>
            )}
            {/* Resume button — shown when a thread died mid-stream */}
            {threadIsStalled && (
              <div className="mb-3 p-4 rounded-xl border border-orange-500/30 bg-orange-500/5">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-orange-400" />
                  <span className="text-sm font-medium text-orange-300">This session appears to have stalled or timed out</span>
                </div>
                <p className="text-xs text-white/50 mb-3">The analysis didn't finish — this can happen if the server timed out or the connection dropped. You can resume from where it left off.</p>
                <div className="flex gap-3">
                  <button
                    onClick={handleResume}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500/20 border border-orange-500/40 text-orange-300 hover:bg-orange-500/30 transition-all text-sm font-medium"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    Resume Analysis
                  </button>
                  <button
                    onClick={() => {
                      const activeThread = threads.find(t => t.id === activeThreadId);
                      if (activeThread) {
                        setInputText(activeThread.topic);
                        setActiveThreadId(null);
                        setMessages([]);
                        setRecap(null);
                        setPhase('idle');
                      }
                    }}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white/50 hover:bg-white/10 hover:text-white/70 transition-all text-sm"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Start Over
                  </button>
                </div>
              </div>
            )}
            {/* Clarification answer prompt — shown after Round 0, survives refresh */}
            {phase === 'awaiting_clarification' && (() => {
              // Extract clarification questions from messages so user can see them without scrolling
              const clarificationMsgs = messages.filter(m => m.role === 'model' && m.phase === 'clarification' && m.done && m.text);
              return (
              <div className="mb-3 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <span className="text-sm font-medium text-amber-300">Answer clarifying questions to improve the analysis</span>
                </div>
                {/* Pinned questions summary — so user can see them even after long delay or refresh */}
                {clarificationMsgs.length > 0 && (
                  <div className="mb-3 max-h-48 overflow-y-auto custom-scrollbar rounded-lg bg-[#0a0a0a] border border-[#262626] p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-white/40 uppercase tracking-wider">Questions from the Town Hall</span>
                      <button
                        onClick={() => {
                          const allQs = clarificationMsgs.map(m => `[${(m as any).name || 'Model'}]\n${m.text}`).join('\n\n---\n\n');
                          navigator.clipboard.writeText(allQs);
                        }}
                        className="flex items-center gap-1 text-xs text-white/30 hover:text-white/60 transition-colors"
                        title="Copy all questions"
                      >
                        <Copy className="w-3 h-3" />
                        Copy
                      </button>
                    </div>
                    {clarificationMsgs.map((m, i) => (
                      <div key={i} className="mb-2 last:mb-0">
                        <span className="text-xs font-medium text-amber-400/70">{(m as any).name || 'Model'}:</span>
                        <div className="text-xs text-white/60 mt-0.5 whitespace-pre-wrap leading-relaxed">{m.text}</div>
                        {i < clarificationMsgs.length - 1 && <div className="border-t border-white/5 mt-2" />}
                      </div>
                    ))}
                  </div>
                )}
                <textarea
                  rows={3}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (inputText.trim()) handleClarify(inputText.trim());
                    }
                  }}
                  placeholder="Type your answers here... (or skip to proceed without answering)"
                  className="w-full bg-[#0a0a0a] border border-[#262626] rounded-xl py-3 px-4 text-sm focus:outline-none focus:border-amber-500/50 transition-all resize-none custom-scrollbar mb-3"
                  autoFocus
                />
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      if (inputText.trim()) {
                        handleClarify(inputText.trim());
                        setInputText('');
                      }
                    }}
                    disabled={!inputText.trim() || isLoading}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 disabled:opacity-30 transition-all text-sm font-medium"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Submit Answers & Continue
                  </button>
                  <button
                    onClick={() => {
                      setInputText('');
                      handleClarify();
                    }}
                    disabled={isLoading}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white/50 hover:bg-white/10 hover:text-white/70 transition-all text-sm"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                    Skip — Proceed without answers
                  </button>
                </div>
              </div>
              );
            })()}
            {phase !== 'awaiting_clarification' && (
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-blue-600/20 to-purple-600/20 rounded-[1.5rem] blur opacity-0 group-focus-within:opacity-100 transition duration-500" />
              <textarea
                rows={1}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    activeThreadId ? handleHumanMessage() : handleStart();
                  }
                }}
                placeholder={
                  activeThreadId ? "Address specific models (e.g. 'gemini, gpt - agree?') or follow up..." :
                  "Enter a topic or question to start a Town Hall..."
                }
                className="w-full bg-[#121212] border border-[#262626] rounded-2xl py-4 pl-5 pr-14 text-sm focus:outline-none focus:border-blue-500/50 transition-all resize-none custom-scrollbar relative z-10"
              />
              <button
                onClick={activeThreadId ? handleHumanMessage : handleStart}
                disabled={!inputText.trim() || isLoading}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-white/5 disabled:text-white/20 text-white rounded-xl transition-all z-20 shadow-lg shadow-blue-600/20"
              >
                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              </button>
            </div>
            )}
          </div>
          <div className="max-w-4xl mx-auto mt-3 flex items-center justify-between text-[10px] text-white/20 font-mono uppercase tracking-widest">
            <div className="flex gap-4 items-center">
              <span className="flex items-center gap-1"><Maximize2 className="w-3 h-3" /> Shift + Enter for newline</span>
              <span>•</span>
              <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> Markdown supported</span>
              <span>•</span>
              <button
                onClick={() => setTier(t => t === 'strong' ? 'frontier' : 'strong')}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded-md transition-all border",
                  tier === 'strong'
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
                    : "bg-purple-500/10 border-purple-500/30 text-purple-400 hover:bg-purple-500/20"
                )}
                title="Toggle between value (Gemini + DeepSeek) and frontier (Claude, GPT-5.4, Grok) models"
              >
                {tier === 'strong' ? <Zap className="w-3 h-3" /> : <Brain className="w-3 h-3" />}
                {tier === 'strong' ? 'Value Mode' : 'Frontier Mode'}
              </button>
            </div>
            {activeThreadId && (
              <div className="flex items-center gap-2">
                <span className="text-white/30 mr-1">Addressing:</span>
                <button 
                  onClick={() => setSelectedModels(new Set(Object.keys(MODELS) as ModelKey[]))}
                  className={cn(
                    "px-2 py-1 rounded transition-all",
                    selectedModels.size === Object.keys(MODELS).length ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"
                  )}
                >
                  All
                </button>
                {Object.entries(MODELS).map(([name, info]) => {
                  const isSelected = selectedModels.has(name as ModelKey);
                  return (
                    <button
                      key={name}
                      onClick={() => toggleModelSelection(name as ModelKey)}
                      className={cn(
                        "px-2 py-1 rounded transition-all border",
                        isSelected ? "bg-white/10" : "border-transparent opacity-40 hover:opacity-80"
                      )}
                      style={{ 
                        borderColor: isSelected ? info.color + '40' : 'transparent',
                        color: isSelected ? info.color : undefined
                      }}
                    >
                      {name.split(' ')[0]}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* How It Works Modal */}
      {showHowItWorks && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#121212] border border-[#262626] rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-[#121212] border-b border-[#262626] p-6 flex items-center justify-between z-10">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-blue-500" />
                How Town Hall Works
              </h2>
              <button 
                onClick={() => setShowHowItWorks(false)}
                className="p-2 hover:bg-white/5 rounded-md transition-colors text-white/40 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-8 text-sm text-white/80 leading-relaxed">
              {/* What this IS */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-emerald-500/80">What This Is</h3>
                <p className="text-base">
                  A <strong>recommendation engine</strong> that consults multiple frontier AI models simultaneously. Each model gives its honest, unbiased analysis — then they cross-examine each other's work.
                </p>
                <p className="text-sm text-white/60">
                  The value comes from <strong>genuine model diversity</strong> — Claude, GPT-5.4, Grok, Gemini, and DeepSeek are trained on different data, with different architectures, by different teams. They genuinely think differently. When these independently-trained systems converge on the same answer, you can trust it. When they diverge, you know the problem is genuinely hard.
                </p>
                <p className="text-xs text-white/40">
                  Multi-agent debate is one of the most validated approaches in current AI research. Du et al. (2023, MIT) showed debate reduces factual hallucinations and improves mathematical reasoning. Liang et al. (2023) demonstrated divergent thinking among diverse agents outperforms homogeneous groups. This isn't a novelty — it's applied epistemology.
                </p>
              </div>

              {/* What this IS NOT */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-rose-500/80">What This Is NOT</h3>
                <p className="text-xs text-white/40 mb-2 italic">If you're contributing to this project, read this section carefully. These are load-bearing design decisions backed by peer-reviewed research, not stylistic preferences.</p>
                <ul className="space-y-3 text-sm text-white/60">
                  <li className="flex gap-2"><span className="text-rose-500 mt-0.5">✕</span> <div><strong>Not roleplay.</strong> Models are not assigned characters, personas, or viewpoints. No "Architect," "Contrarian," or "Devil's Advocate." A controlled study at ICLR 2025 found that assigning angel/devil personas to debate agents "significantly underperforms almost any other baseline." Roles constrain the intelligence you're paying for.</div></li>
                  <li className="flex gap-2"><span className="text-rose-500 mt-0.5">✕</span> <div><strong>Not a panel show.</strong> Model diversity is the dominant driver of debate quality — not structural parameters or role assignment. The "Can LLM Agents Really Debate?" study (2025) showed that weaker models capitulate to incorrect majorities 96.4% of the time when given social roles. We eliminate that by design.</div></li>
                  <li className="flex gap-2"><span className="text-rose-500 mt-0.5">✕</span> <div><strong>Not forced consensus.</strong> "Talk Isn't Always Cheap" (ICML 2025) found that multi-agent debate can <em>decrease</em> accuracy when models shift from correct answers to incorrect ones to achieve agreement. If models genuinely disagree, we report gridlock honestly. Disagreement is signal, not failure.</div></li>
                  <li className="flex gap-2"><span className="text-rose-500 mt-0.5">✕</span> <div><strong>Not a vote.</strong> "Peacemaker or Troublemaker" (2025) showed centralized synthesis by a single judge is more resilient to sycophancy than decentralized voting. Our synthesizer reads the full debate trajectory fresh — it doesn't count heads.</div></li>
                </ul>
              </div>

              {/* The Process */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-blue-500/80">The Process</h3>
                <ol className="space-y-5">
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs font-bold">0</span>
                    <div><strong>Clarifying Questions</strong><br/><span className="text-white/50">Models ask smart questions to understand your situation before committing to analysis. This reduces assumption-driven errors.</span></div>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs font-bold">1</span>
                    <div><strong>Independent Analysis</strong><br/><span className="text-white/50">Each model answers independently — blind to other models' answers. Every model gets the identical unbiased prompt. No anchoring effects, no conformity bias. This is the most critical step.</span></div>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs font-bold">2</span>
                    <div><strong>Cross-Examination</strong><br/><span className="text-white/50">Models review each other's work and must cite specific claims they're challenging. Each model is explicitly instructed: "Do NOT change your position just because other models disagree. Only update if you see NEW evidence or logic." Research shows 1-2 rounds of debate is optimal — more rounds increase conformity without improving accuracy (FREE-MAD, 2025).</span></div>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center text-xs font-bold">⚡</span>
                    <div><strong>Quality Check (BS Detector)</strong><br/><span className="text-white/50">A separate structural pass — not a participant, not a role. Scans for: groupthink (all models suspiciously agreeing), lazy agreement (positions changing without new evidence), inflated confidence scores, and vague hedging. Model identities are anonymized in this pass to prevent authority bias. Inspired by FREE-MAD's anti-conformity mechanism.</span></div>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-xs font-bold">✓</span>
                    <div><strong>Synthesis</strong><br/><span className="text-white/50">A different model (never the quality checker) reads the full debate trajectory fresh and extracts the answer — not a balanced summary, the actual recommendation. Reports gridlock honestly when models can't resolve disagreement. Confidence scored 0-100 with specific conditions that would change it.</span></div>
                  </li>
                </ol>
              </div>

              {/* Independence Guarantees */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-amber-500/80">Independence Guarantees</h3>
                <p className="text-xs text-white/40 mb-2">How we prevent the #1 failure mode in multi-agent systems: groupthink and sycophancy.</p>
                <ul className="space-y-2 text-xs text-white/60">
                  <li className="flex gap-2"><span className="text-amber-500">→</span> <strong>Identical base prompt.</strong> Every model gets the same instructions. No model is primed to agree or disagree.</li>
                  <li className="flex gap-2"><span className="text-amber-500">→</span> <strong>Anti-conformity prompting.</strong> Models are explicitly told to stand their ground. Position changes require citing the new evidence that changed their mind (FREE-MAD, 2025).</li>
                  <li className="flex gap-2"><span className="text-amber-500">→</span> <strong>Anonymized quality check.</strong> The BS detector sees arguments stripped of model identity markers, forcing evaluation by argument quality rather than model authority (Identity Bias in LLM Debate, 2025).</li>
                  <li className="flex gap-2"><span className="text-amber-500">→</span> <strong>Separate synthesis judge.</strong> The synthesizer never participated in the debate and never ran the quality check. Fresh eyes, no anchoring (Peacemaker or Troublemaker, 2025).</li>
                  <li className="flex gap-2"><span className="text-amber-500">→</span> <strong>Gridlock is valid.</strong> Confidence auto-drops to 35 if synthesis detects unresolved disagreement. We don't manufacture consensus.</li>
                </ul>
              </div>

              {/* The Models */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-white/40">The Models</h3>
                <p className="text-xs text-white/60 mb-2">
                  All models via <a href="https://openrouter.ai/rankings" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline inline-flex items-center gap-1">OpenRouter <ExternalLink className="w-3 h-3" /></a>. Every model gets the same unbiased prompt. No roles, no characters — just intelligence.
                </p>
                <div className="grid gap-3">
                  {Object.entries(MODELS).map(([name, info]) => (
                    <div key={name} className="flex items-start gap-3 p-3 rounded-xl bg-white/5 border border-white/5">
                      <div className="w-6 h-6 rounded flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white mt-0.5" style={{ backgroundColor: info.color }}>
                        {name.charAt(0)}
                      </div>
                      <div>
                        <div className="font-bold text-white">{name} <span className="text-[10px] font-normal text-white/30 uppercase">{info.tier}</span></div>
                        <div className="text-xs text-white/60 mt-1">{info.description}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Research */}
              <div className="space-y-3 border-t border-white/10 pt-6">
                <h3 className="text-xs font-bold uppercase tracking-widest text-white/30">Research & References</h3>
                <ul className="space-y-1.5 text-[11px] text-white/30">
                  <li>Du et al. (2023) — "Improving Factuality and Reasoning in LLMs through Multi-Agent Debate" — MIT</li>
                  <li>Liang et al. (2023) — "Encouraging Divergent Thinking in Multi-Agent Debate" — NeurIPS</li>
                  <li>ICLR 2025 — "Multi-Agent Debate: Angel/Devil Persona Study" — Controlled evaluation of role assignment</li>
                  <li>FREE-MAD (2025) — Anti-conformity mechanism, trajectory scoring, single-round optimal depth</li>
                  <li>"Talk Isn't Always Cheap" (2025) — ICML — When debate decreases accuracy via sycophantic agreement</li>
                  <li>"Peacemaker or Troublemaker" (2025) — Centralized judging vs. decentralized voting resilience</li>
                  <li>"Can LLM Agents Really Debate?" (2025) — 96.4% capitulation rate of weaker models in social pressure</li>
                  <li>ConfidenceCal (2024) — IEEE BigDIA — Hidden confidence calibration prevents cascading over-confidence</li>
                  <li>Identity Bias Anonymization (2025) — Response anonymization as sycophancy mitigation</li>
                </ul>
                <p className="text-[10px] text-white/20 mt-2">
                  This is an open-source project. If you're forking or contributing, please read the research before adding roles, personas, or forced-consensus mechanisms. They have been tried. They underperform.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Template Editor Modal */}
      {showTemplateEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#121212] border border-[#262626] rounded-2xl max-w-2xl w-full shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex-none bg-[#121212] border-b border-[#262626] p-6 flex items-center justify-between z-10 rounded-t-2xl">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Settings2 className="w-5 h-5 text-blue-500" />
                Edit Template: {TEMPLATES.find(t => t.id === selectedTemplate)?.name}
              </h2>
              <button 
                onClick={() => setShowTemplateEditor(false)}
                className="p-2 hover:bg-white/5 rounded-md transition-colors text-white/40 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6">
              <p className="text-xs text-white/40 mb-4">
                Customize the system prompt and guardrails for this template. This will be injected into the models' context.
              </p>
              <textarea
                value={templateContents[selectedTemplate]}
                onChange={(e) => setTemplateContents(prev => ({ ...prev, [selectedTemplate]: e.target.value }))}
                className="w-full h-64 bg-black/40 border border-[#262626] rounded-xl p-4 text-sm text-white/80 focus:outline-none focus:border-blue-500/50 transition-colors resize-none custom-scrollbar font-mono"
              />
            </div>
            
            <div className="flex-none p-6 border-t border-[#262626] flex justify-end">
              <button
                onClick={() => setShowTemplateEditor(false)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-colors text-sm font-medium"
              >
                Save & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
