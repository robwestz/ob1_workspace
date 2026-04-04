'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Bot,
  Search,
  BookOpen,
  CheckCircle2,
  Wrench,
  ClipboardList,
  BarChart3,
  Eye,
  Shield,
  ShieldOff,
  AlertTriangle,
  Loader2,
  Zap,
  DollarSign,
  Hash,
  Settings,
  Plus,
  X,
} from 'lucide-react';
import { useApiContext } from '@/app/providers';
import type { AgentType, SpawnAgentRequest } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Agent Type Card Metadata (icons/descriptions for built-in types)
// ---------------------------------------------------------------------------

const TYPE_META: Record<
  string,
  { icon: React.ElementType; color: string; description: string }
> = {
  explore: {
    icon: Search,
    color: '#3B82F6',
    description:
      'Read-only codebase exploration and information gathering. Cannot modify files.',
  },
  plan: {
    icon: ClipboardList,
    color: '#8B5CF6',
    description:
      'Architecture planning and strategy formulation. Produces step-by-step implementation plans.',
  },
  verification: {
    icon: CheckCircle2,
    color: '#10B981',
    description:
      'Run tests, type checks, and linters. Validates changes without modifying source.',
  },
  guide: {
    icon: BookOpen,
    color: '#F59E0B',
    description:
      'User assistance and documentation. Explains concepts with code references.',
  },
  general_purpose: {
    icon: Wrench,
    color: '#EF4444',
    description:
      'Full-capability coding agent with read/write access. Implements code changes.',
  },
  statusline: {
    icon: BarChart3,
    color: '#6366F1',
    description:
      'Monitors and displays progress of other agents. Minimal tool access.',
  },
};

// ---------------------------------------------------------------------------
// Tool Multi-Select
// ---------------------------------------------------------------------------

const ALL_TOOLS = [
  'read_file',
  'write_file',
  'edit_file',
  'glob_search',
  'grep_search',
  'bash',
  'web_fetch',
  'web_search',
];

function ToolSelect({
  label,
  selected,
  onChange,
  colorClass,
}: {
  label: string;
  selected: string[];
  onChange: (tools: string[]) => void;
  colorClass: string;
}) {
  const [inputValue, setInputValue] = useState('');

  const addTool = (tool: string) => {
    if (!selected.includes(tool)) {
      onChange([...selected, tool]);
    }
    setInputValue('');
  };

  const removeTool = (tool: string) => {
    onChange(selected.filter((t) => t !== tool));
  };

  const suggestions = ALL_TOOLS.filter(
    (t) => !selected.includes(t) && t.includes(inputValue.toLowerCase()),
  );

  return (
    <div>
      <label className="block text-sm font-medium text-slate-400 mb-2">{label}</label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {selected.map((tool) => (
          <span
            key={tool}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-mono ${colorClass}`}
          >
            {tool}
            <button
              onClick={() => removeTool(tool)}
              className="hover:text-white transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="relative">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Type to add tool..."
          className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
        />
        {inputValue && suggestions.length > 0 && (
          <div className="absolute z-10 mt-1 w-full bg-slate-800 border border-slate-700/50 rounded-lg shadow-xl overflow-hidden">
            {suggestions.map((tool) => (
              <button
                key={tool}
                onClick={() => addTool(tool)}
                className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-slate-700/60 font-mono transition-colors"
              >
                {tool}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slider Input
// ---------------------------------------------------------------------------

function SliderInput({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
  icon: Icon,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  unit: string;
  icon: React.ElementType;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="flex items-center gap-1.5 text-sm font-medium text-slate-400">
          <Icon className="w-3.5 h-3.5" />
          {label}
        </label>
        <span className="text-sm font-mono font-semibold text-slate-200">
          {unit === '$' ? `$${value.toFixed(2)}` : `${value} ${unit}`}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 bg-slate-800 rounded-full appearance-none cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:shadow-lg
          [&::-webkit-slider-thumb]:shadow-blue-500/30 [&::-webkit-slider-thumb]:cursor-pointer
          [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
          [&::-moz-range-thumb]:bg-blue-500 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
      />
      <div className="flex justify-between text-xs text-slate-600 mt-1">
        <span>{unit === '$' ? `$${min}` : `${min}`}</span>
        <span>{unit === '$' ? `$${max}` : `${max}`}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function SpawnAgentPage() {
  const router = useRouter();
  const api = useApiContext();

  const [types, setTypes] = useState<AgentType[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [taskPrompt, setTaskPrompt] = useState('');
  const [maxTurns, setMaxTurns] = useState(50);
  const [maxTokens, setMaxTokens] = useState(100000);
  const [maxUsd, setMaxUsd] = useState(1.0);
  const [allowedTools, setAllowedTools] = useState<string[]>([]);
  const [deniedTools, setDeniedTools] = useState<string[]>([]);
  const [spawning, setSpawning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch available types
  useEffect(() => {
    api.coordinator
      .listTypes()
      .then((res) => {
        setTypes(res.agent_types);
        setLoadingTypes(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load agent types');
        setLoadingTypes(false);
      });
  }, [api]);

  // When type is selected, pre-populate tool restrictions
  useEffect(() => {
    if (!selectedType) return;
    const t = types.find((at) => at.name === selectedType);
    if (t) {
      setAllowedTools(t.allowed_tools);
      setDeniedTools(t.denied_tools);
      setMaxTurns(t.max_iterations);
    }
  }, [selectedType, types]);

  const handleSpawn = async () => {
    if (!selectedType || !taskPrompt.trim()) return;

    setSpawning(true);
    setError(null);

    try {
      const result = await api.coordinator.spawn({
        agent_type: selectedType,
        task_prompt: taskPrompt.trim(),
        metadata: {
          allowed_tools: allowedTools,
          denied_tools: deniedTools,
          budget: {
            max_turns: maxTurns,
            max_tokens: maxTokens,
            max_usd: maxUsd,
          },
        },
      });
      router.push(`/agents/${result.run_id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to spawn agent');
      setSpawning(false);
    }
  };

  const selectedTypeData = types.find((t) => t.name === selectedType);
  const meta = selectedType ? TYPE_META[selectedType] : null;

  return (
    <div className="min-h-screen p-6 md:p-8 max-w-4xl mx-auto space-y-6 animate-fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/agents"
          className="text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Agent Monitor
        </Link>
        <span className="text-slate-700">/</span>
        <span className="text-slate-400">Spawn Agent</span>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <Zap className="w-6 h-6 text-blue-400" />
          Spawn New Agent
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Choose an agent type, define the task, and configure budget limits
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-sm text-red-300">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-400 hover:text-red-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Step 1: Agent Type Selection */}
      <div className="glass-panel p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
          <Bot className="w-4 h-4" />
          1. Select Agent Type
        </h2>

        {loadingTypes ? (
          <div className="flex items-center gap-2 py-8 justify-center text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading agent types...
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {types.map((t) => {
              const typeMeta = TYPE_META[t.name];
              const Icon = typeMeta?.icon ?? Bot;
              const color = t.color ?? typeMeta?.color ?? '#6366F1';
              const isSelected = selectedType === t.name;

              return (
                <button
                  key={t.id}
                  onClick={() => setSelectedType(t.name)}
                  className={`relative text-left p-4 rounded-xl border transition-all duration-200 ${
                    isSelected
                      ? 'border-blue-500/50 bg-blue-500/10 shadow-lg shadow-blue-500/10'
                      : 'border-slate-700/50 bg-slate-800/40 hover:bg-slate-800/60 hover:border-slate-600/50'
                  }`}
                >
                  {isSelected && (
                    <div className="absolute top-3 right-3">
                      <CheckCircle2 className="w-5 h-5 text-blue-400" />
                    </div>
                  )}
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
                    style={{ backgroundColor: `${color}15` }}
                  >
                    <Icon className="w-5 h-5" style={{ color }} />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-200 mb-1">
                    {t.display_name}
                  </h3>
                  <p className="text-xs text-slate-500 leading-relaxed line-clamp-3">
                    {t.description || typeMeta?.description || 'Custom agent type'}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px] font-mono"
                      style={{ backgroundColor: `${color}15`, color }}
                    >
                      {t.name}
                    </span>
                    <span className="text-[10px] text-slate-600">
                      {t.permission_mode.replace(/_/g, ' ')}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Step 2: Task Description */}
      <div className="glass-panel p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
          <ClipboardList className="w-4 h-4" />
          2. Task Description
        </h2>
        <textarea
          value={taskPrompt}
          onChange={(e) => setTaskPrompt(e.target.value)}
          placeholder="Describe the task for the agent. Be specific about what you want it to accomplish..."
          rows={5}
          className="w-full bg-slate-800/60 border border-slate-700/50 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-slate-600 resize-y focus:outline-none focus:ring-1 focus:ring-blue-500/30 transition-colors"
        />
        <div className="flex justify-end mt-1">
          <span className="text-xs text-slate-600">
            {taskPrompt.length} characters
          </span>
        </div>
      </div>

      {/* Step 3: Budget Limits */}
      <div className="glass-panel p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
          <DollarSign className="w-4 h-4" />
          3. Budget Limits
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <SliderInput
            label="Max Turns"
            value={maxTurns}
            onChange={setMaxTurns}
            min={5}
            max={200}
            step={5}
            unit="turns"
            icon={Hash}
          />
          <SliderInput
            label="Max Tokens"
            value={maxTokens}
            onChange={setMaxTokens}
            min={10000}
            max={1000000}
            step={10000}
            unit="tokens"
            icon={Settings}
          />
          <SliderInput
            label="Max Cost"
            value={maxUsd}
            onChange={setMaxUsd}
            min={0.1}
            max={50}
            step={0.1}
            unit="$"
            icon={DollarSign}
          />
        </div>
      </div>

      {/* Step 4: Tool Restrictions */}
      <div className="glass-panel p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
          <Shield className="w-4 h-4" />
          4. Tool Restrictions
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <ToolSelect
            label="Allowed Tools"
            selected={allowedTools}
            onChange={setAllowedTools}
            colorClass="bg-emerald-500/10 text-emerald-400"
          />
          <ToolSelect
            label="Denied Tools"
            selected={deniedTools}
            onChange={setDeniedTools}
            colorClass="bg-red-500/10 text-red-400"
          />
        </div>
        {selectedTypeData && (
          <p className="mt-3 text-xs text-slate-600">
            Defaults from {selectedTypeData.display_name} type. Modify as needed.
          </p>
        )}
      </div>

      {/* Spawn Button */}
      <div className="flex items-center justify-between pt-2">
        <Link
          href="/agents"
          className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
        >
          Cancel
        </Link>
        <button
          onClick={handleSpawn}
          disabled={!selectedType || !taskPrompt.trim() || spawning}
          className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-blue-600/20 disabled:shadow-none"
        >
          {spawning ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Spawning...
            </>
          ) : (
            <>
              <Zap className="w-4 h-4" />
              Spawn Agent
            </>
          )}
        </button>
      </div>

      {/* Preview */}
      {selectedType && taskPrompt.trim() && (
        <div className="glass-panel p-5 border-blue-500/20">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
            Spawn Preview
          </h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-slate-500">Type:</span>{' '}
              <span className="text-slate-300 font-mono">{selectedType}</span>
            </div>
            <div>
              <span className="text-slate-500">Budget:</span>{' '}
              <span className="text-slate-300 font-mono">
                {maxTurns} turns / ${maxUsd.toFixed(2)}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Allowed:</span>{' '}
              <span className="text-slate-300 font-mono">
                {allowedTools.length} tools
              </span>
            </div>
            <div>
              <span className="text-slate-500">Denied:</span>{' '}
              <span className="text-slate-300 font-mono">
                {deniedTools.length} tools
              </span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-700/30">
            <span className="text-xs text-slate-500">Task:</span>
            <p className="text-sm text-slate-300 mt-1 line-clamp-3">{taskPrompt}</p>
          </div>
        </div>
      )}
    </div>
  );
}
