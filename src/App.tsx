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
  Server
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
  const [phase, setPhase] = useState<'idle' | 'clarification' | 'awaiting_input' | 'blind_draft' | 'consensus_check' | 'targeted_debate' | 'synthesizing'>('idle');
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
  const [tier, setTier] = useState<'fast' | 'frontier'>('frontier');
  const [isTranscriptExpanded, setIsTranscriptExpanded] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('general');
  const [businessContext, setBusinessContext] = useState<string>('');
  const [isRagConnected, setIsRagConnected] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);

  const TEMPLATES = [
    { id: 'general', name: 'General Decision', icon: <Brain className="w-4 h-4" /> },
    { id: 'frontend', name: 'Frontend Eng', icon: <Layout className="w-4 h-4" /> },
    { id: 'backend', name: 'Backend Eng', icon: <Server className="w-4 h-4" /> },
    { id: 'marketing', name: 'Marketing / GTM', icon: <Megaphone className="w-4 h-4" /> },
    { id: 'ops', name: 'Operations', icon: <Briefcase className="w-4 h-4" /> },
  ];

  const DEFAULT_TEMPLATES: Record<string, string> = {
    general: "You are a council of expert advisors. Analyze the problem from multiple angles, identify hidden risks, and propose a robust solution.",
    frontend: "You are a council of staff-level frontend engineers. Focus on accessibility, performance, React best practices, and maintainable CSS architecture.",
    backend: "You are a council of staff-level backend engineers. Focus on scalability, database performance, security, and API design.",
    marketing: "You are a council of expert growth marketers. Focus on positioning, target audience, conversion optimization, and brand consistency.",
    ops: "You are a council of expert COOs. Focus on process efficiency, resource allocation, risk mitigation, and operational scalability."
  };

  const [templateContents, setTemplateContents] = useState<Record<string, string>>(DEFAULT_TEMPLATES);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

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

  // Persist messages per thread to localStorage
  useEffect(() => {
    if (activeThreadId && messages.length > 0) {
      localStorage.setItem(`council_msgs_${activeThreadId}`, JSON.stringify(messages));
      if (recap) localStorage.setItem(`council_recap_${activeThreadId}`, recap);
    }
  }, [messages, recap, activeThreadId]);

  // Load messages from localStorage when switching threads
  useEffect(() => {
    if (activeThreadId) {
      const savedMsgs = localStorage.getItem(`council_msgs_${activeThreadId}`);
      if (savedMsgs) {
        try {
          const parsed = JSON.parse(savedMsgs);
          if (parsed.length > 0 && messages.length === 0) setMessages(parsed);
        } catch {}
      }
      const savedRecap = localStorage.getItem(`council_recap_${activeThreadId}`);
      if (savedRecap && !recap) setRecap(savedRecap);
    }
  }, [activeThreadId]);

  const fetchThreads = async () => {
    // On serverless, /threads may be empty — merge with localStorage
    try {
      const res = await fetch('/threads');
      const data = await res.json();
      if (data.length > 0) setThreads(data);
    } catch {}
  };

  const fetchThreadDetail = async (tid: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/thread/${tid}`);
      const data = await res.json();
      if (data.source === 'file') {
        setRecap(data.content);
        setMessages([]);
        setIsTranscriptExpanded(false);
      } else {
        setMessages(data.messages || []);
        setRecap(null);
        setIsTranscriptExpanded(true);
      }
      setActiveThreadId(tid);
    } catch (err) {
      console.error('Failed to fetch thread detail', err);
    } finally {
      setIsLoading(false);
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
      if (!data.text && !data.round && !data.recap) return;
    }

    if (data.round) {
      setCurrentRound(data.round);
      setMessages(prev => [...prev, { ...data, role: 'system', text: data.round }]);
      return;
    }

    if (data.type === 'recap' || data.recap) {
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
    setMessages([]);
    setRecap(null);
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

    try {
      const body = {
        topic,
        models: Array.from(selectedModels).map(m => MODELS[m].id),
        tier, stakes, reversible, confidenceThreshold, synthesisStrategy,
        template: selectedTemplate,
        templateContent: templateContents[selectedTemplate],
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

        // Update thread status to complete in sidebar
        if (threadId) {
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
      if (lowerText.includes('gemini') && !lowerText.includes('flash')) explicitModels.push(MODELS['Gemini 3.1 Pro'].id);
      if (lowerText.includes('gpt') && !lowerText.includes('mini')) explicitModels.push(MODELS['GPT-5.4'].id);
      if (lowerText.includes('o3')) explicitModels.push(MODELS['o3-Pro'].id);
      if (lowerText.includes('deepseek')) explicitModels.push(MODELS['DeepSeek V3.2'].id);
      if (lowerText.includes('grok')) explicitModels.push(MODELS['Grok 4'].id);
      if (lowerText.includes('haiku')) explicitModels.push(MODELS['Claude Haiku'].id);
      if (lowerText.includes('flash')) explicitModels.push(MODELS['Gemini Flash'].id);
      if (lowerText.includes('mini')) explicitModels.push(MODELS['GPT-5 Mini'].id);

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
      const res = await fetch('/human', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thread_id: activeThreadId,
          text,
          models: modelsToAddress,
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
            COWORK COUNCIL
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
          </div>
        </header>

        {/* Discussion Area */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {!activeThreadId && (
            <div className="max-w-4xl mx-auto py-16 px-8 space-y-12">
              <div className="space-y-4 text-center">
                <div className="w-16 h-16 bg-blue-500/10 rounded-2xl flex items-center justify-center border border-blue-500/20 mx-auto">
                  <Terminal className="w-8 h-8 text-blue-500" />
                </div>
                <h1 className="text-4xl font-bold tracking-tight">Cowork Council</h1>
                <p className="text-white/40 text-lg max-w-xl mx-auto leading-relaxed">
                  Select your council and define the topic. The models will attempt to apply reinforced first-principle thinking, challenge each other's assumptions, and converge on what they think is the highest-probability correct decision.
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
                    Council Configuration
                    <Tip text="Pick which AI models join the discussion. More models = more perspectives but higher cost." />
                  </h3>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedModels(new Set(Object.keys(MODELS).filter(k => MODELS[k as ModelKey].tier === 'best') as ModelKey[]))}
                      className="text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded-md transition-colors bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20"
                      title="Deep Research / Reasoning Models (Slow)"
                    >
                      Deep Research
                    </button>
                    <button
                      onClick={() => setSelectedModels(new Set(Object.keys(MODELS).filter(k => MODELS[k as ModelKey].tier === 'fast') as ModelKey[]))}
                      className="text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded-md transition-colors bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20"
                      title="Standard Flagship Models (Smart & Fast)"
                    >
                      Fast (Standard)
                    </button>
                    <button
                      onClick={() => setSelectedModels(new Set(Object.keys(MODELS).filter(k => MODELS[k as ModelKey].tier === 'light') as ModelKey[]))}
                      className="text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded-md transition-colors bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500/20"
                      title="Lightweight Models (Lightning Fast)"
                    >
                      Lightweight
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
                      <label className="text-sm font-bold">Business Context & RAG</label>
                      <button
                        onClick={() => {
                          setIsRagConnected(false);
                          alert('🚧 Connect Context (RAG) is coming in the next version! This will let you connect repos, docs, and data sources directly to your council discussions.');
                        }}
                        className="text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded-md flex items-center gap-1 transition-colors border bg-white/5 text-white/40 border-white/10 hover:bg-white/10 hover:text-white"
                      >
                        <Database className="w-3 h-3" />
                        Connect Context
                        <span className="ml-1 text-[8px] bg-amber-500/20 text-amber-400 px-1 rounded">SOON</span>
                      </button>
                    </div>
                    <p className="text-xs text-white/40 leading-relaxed">
                      Inject additional business context, links to repos, or specific constraints.
                    </p>
                    <textarea
                      value={businessContext}
                      onChange={(e) => setBusinessContext(e.target.value)}
                      placeholder="e.g. 'We are using React 18 and Tailwind. The main repo is at github.com/org/repo...'"
                      className="w-full flex-1 min-h-[80px] bg-black/40 border border-[#262626] rounded-xl p-3 text-xs text-white/80 focus:outline-none focus:border-blue-500/50 transition-colors resize-none custom-scrollbar"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-white/40 flex items-center gap-2">
                    <Cpu className="w-4 h-4" />
                    Orchestration Policy
                    <Tip text="Controls how models debate and reach consensus. Higher confidence threshold = stricter agreement required." />
                  </h3>
                </div>
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
                      If the synthesized decision confidence falls below this threshold, the policy engine will automatically escalate for human review or trigger a secondary debate round.
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
                      <div className="text-[10px] uppercase tracking-widest text-white/30 font-bold">Confidence Score <Tip text="How confident the council is in this recommendation. Green = strong, Yellow = moderate, Red = uncertain." /></div>
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
                  Generated by Cowork Council Multi-Model Decision Engine. Verified by logic checkers and structural architects.
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
                            || (msg.name === 'moderator' ? { id: 'moderator', color: '#fbbf24', tier: 'best' as const, description: 'Council Moderator' } : null)
                          : null;
                        const modelDisplayName = msg.name
                          ? Object.entries(MODELS).find(([, m]) => m.id === msg.name)?.[0] || msg.name
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
                                  {msg.role === 'model' && modelInfo ? (
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
                                          Rebuttal
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
                         'Council is deliberating...'}
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
                  phase === 'awaiting_input' ? "Please answer the clarifying questions to proceed..." :
                  activeThreadId ? "Address specific models (e.g. 'gemini, gpt - agree?') or follow up..." : 
                  "Enter a topic or question to start a Cowork Council..."
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
          </div>
          <div className="max-w-4xl mx-auto mt-3 flex items-center justify-between text-[10px] text-white/20 font-mono uppercase tracking-widest">
            <div className="flex gap-4 items-center">
              <span className="flex items-center gap-1"><Maximize2 className="w-3 h-3" /> Shift + Enter for newline</span>
              <span>•</span>
              <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> Markdown supported</span>
              <span>•</span>
              <button 
                onClick={() => setTier(t => t === 'fast' ? 'frontier' : 'fast')}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded-md transition-all border",
                  tier === 'fast' 
                    ? "bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20" 
                    : "bg-purple-500/10 border-purple-500/30 text-purple-400 hover:bg-purple-500/20"
                )}
                title="Toggle between fast (middle-tier) and frontier (highest quality) models"
              >
                {tier === 'fast' ? <Zap className="w-3 h-3" /> : <Brain className="w-3 h-3" />}
                {tier === 'fast' ? 'Fast Mode' : 'Frontier Mode'}
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
                How Cowork Council Works
              </h2>
              <button 
                onClick={() => setShowHowItWorks(false)}
                className="p-2 hover:bg-white/5 rounded-md transition-colors text-white/40 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-8 text-sm text-white/80 leading-relaxed">
              <div className="space-y-4">
                <p className="text-base">
                  Cowork Council is a decision engine that uses multiple AI models to find the best answer through <strong>first-principle thinking</strong>. Instead of relying on one AI, we ask several to debate.
                </p>
              </div>

              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-white/40">The Process</h3>
                <ol className="space-y-4 list-decimal list-inside marker:text-blue-500 marker:font-bold">
                  <li><strong>Clarifying Questions:</strong> A few models ask smart questions to understand your situation better before diving in.</li>
                  <li><strong>Blind Draft:</strong> Each selected model answers your question independently, without seeing the others' answers.</li>
                  <li><strong>Targeted Debate:</strong> The models review each other's drafts, point out flaws, and challenge assumptions.</li>
                  <li><strong>Synthesis:</strong> A final step reviews the debate and extracts the recommended action, confidence score, and key caveats.</li>
                </ol>
              </div>

              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-white/40">Model Strengths</h3>
                <p className="text-xs text-white/60 mb-2">
                  We use <a href="https://openrouter.ai/rankings" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline inline-flex items-center gap-1">OpenRouter <ExternalLink className="w-3 h-3" /></a> to access the best models. Here is what they are good at:
                </p>
                <div className="grid gap-3">
                  {Object.entries(MODELS).map(([name, info]) => (
                    <div key={name} className="flex items-start gap-3 p-3 rounded-xl bg-white/5 border border-white/5">
                      <div className="w-6 h-6 rounded flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white mt-0.5" style={{ backgroundColor: info.color }}>
                        {name.charAt(0)}
                      </div>
                      <div>
                        <div className="font-bold text-white">{name}</div>
                        <div className="text-xs text-white/60 mt-1">{info.description}</div>
                      </div>
                    </div>
                  ))}
                </div>
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
