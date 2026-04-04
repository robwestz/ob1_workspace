'use client';

import React, { useState, useCallback } from 'react';
import { ChevronDown, ChevronUp, Save, Settings } from 'lucide-react';
import type { NightRunConfig } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface NightRunConfigPanelProps {
  config: NightRunConfig;
  onChange: (config: NightRunConfig) => void;
  onSave: (config: NightRunConfig) => void;
  saving?: boolean;
}

// ---------------------------------------------------------------------------
// Model options
// ---------------------------------------------------------------------------

const MODEL_OPTIONS: Array<{ value: NightRunConfig['model']; label: string; costHint: string }> = [
  { value: 'haiku', label: 'Haiku', costHint: 'Fastest, lowest cost' },
  { value: 'sonnet', label: 'Sonnet', costHint: 'Balanced speed & quality' },
  { value: 'opus', label: 'Opus', costHint: 'Highest quality, highest cost' },
];

// ---------------------------------------------------------------------------
// Slider component
// ---------------------------------------------------------------------------

function ConfigSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  formatValue,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  formatValue?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const displayValue = formatValue ? formatValue(value) : `${value}${unit ?? ''}`;
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-slate-300">{label}</label>
        <span className="text-sm font-mono text-blue-400">{displayValue}</span>
      </div>
      <div className="relative">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full h-2 rounded-full appearance-none cursor-pointer
                     bg-slate-700 accent-blue-500
                     [&::-webkit-slider-thumb]:appearance-none
                     [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4
                     [&::-webkit-slider-thumb]:rounded-full
                     [&::-webkit-slider-thumb]:bg-blue-500
                     [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(59,130,246,0.5)]
                     [&::-webkit-slider-thumb]:cursor-pointer
                     [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4
                     [&::-moz-range-thumb]:rounded-full
                     [&::-moz-range-thumb]:bg-blue-500
                     [&::-moz-range-thumb]:border-0
                     [&::-moz-range-thumb]:cursor-pointer"
          style={{
            background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${percentage}%, #334155 ${percentage}%, #334155 100%)`,
          }}
        />
        <div className="flex justify-between mt-1">
          <span className="text-xs text-slate-500">
            {formatValue ? formatValue(min) : `${min}${unit ?? ''}`}
          </span>
          <span className="text-xs text-slate-500">
            {formatValue ? formatValue(max) : `${max}${unit ?? ''}`}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NightRunConfigPanel
// ---------------------------------------------------------------------------

export default function NightRunConfigPanel({
  config,
  onChange,
  onSave,
  saving = false,
}: NightRunConfigPanelProps) {
  const [expanded, setExpanded] = useState(false);

  const handleChange = useCallback(
    <K extends keyof NightRunConfig>(key: K, value: NightRunConfig[K]) => {
      onChange({ ...config, [key]: value });
    },
    [config, onChange],
  );

  return (
    <div className="glass-panel overflow-hidden">
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-3.5
                   hover:bg-slate-800/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Settings className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-medium text-slate-200">Night Run Configuration</span>
          <div className="flex items-center gap-2 ml-3">
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-400">
              ${config.total_budget_usd}
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-400">
              {config.max_duration_hours}h
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-400">
              {config.model}
            </span>
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-slate-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-500" />
        )}
      </button>

      {/* Collapsible body */}
      {expanded && (
        <div className="px-5 pb-5 pt-2 border-t border-slate-700/50 space-y-5 animate-fade-in">
          {/* Budget slider */}
          <ConfigSlider
            label="Total Budget"
            value={config.total_budget_usd}
            min={1}
            max={50}
            step={1}
            formatValue={(v) => `$${v.toFixed(0)}`}
            onChange={(v) => handleChange('total_budget_usd', v)}
          />

          {/* Duration slider */}
          <ConfigSlider
            label="Max Duration"
            value={config.max_duration_hours}
            min={1}
            max={12}
            step={1}
            unit="h"
            onChange={(v) => handleChange('max_duration_hours', v)}
          />

          {/* Concurrency slider */}
          <ConfigSlider
            label="Max Concurrent Agents"
            value={config.max_concurrent_agents}
            min={1}
            max={5}
            step={1}
            onChange={(v) => handleChange('max_concurrent_agents', v)}
          />

          {/* Model selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Model</label>
            <div className="grid grid-cols-3 gap-2">
              {MODEL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleChange('model', opt.value)}
                  className={`
                    flex flex-col items-center gap-1 px-3 py-2.5 rounded-lg border text-sm
                    transition-all duration-150
                    ${
                      config.model === opt.value
                        ? 'border-blue-500/50 bg-blue-500/10 text-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.15)]'
                        : 'border-slate-700 bg-slate-800/40 text-slate-400 hover:border-slate-600 hover:text-slate-300'
                    }
                  `}
                >
                  <span className="font-medium">{opt.label}</span>
                  <span className="text-xs text-slate-500">{opt.costHint}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Save button */}
          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={() => onSave(config)}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg
                         bg-slate-700 hover:bg-slate-600 text-slate-200
                         disabled:opacity-50 disabled:cursor-not-allowed
                         transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Saving...' : 'Save Config'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
