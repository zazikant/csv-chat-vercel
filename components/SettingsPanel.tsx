"use client";

import { useState } from "react";

interface Settings {
  provider: "openrouter" | "nvidia";
  apiKey: string;
  model: string;
}

interface Props {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
}

export default function SettingsPanel({ settings, onSettingsChange }: Props) {
  const [isOpen, setIsOpen] = useState(false);

  const handleChange = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500 hover:text-gray-700 transition-colors"
        title="Settings"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        Settings
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-80 bg-white rounded-xl shadow-lg border border-gray-200 p-4 z-50">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-800">Provider Settings</h3>
            <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-gray-600">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Provider</label>
              <div className="flex gap-2">
                <button
                  onClick={() => handleChange("provider", "openrouter")}
                  className={`flex-1 px-3 py-2 text-xs rounded-lg border transition-colors ${
                    settings.provider === "openrouter"
                      ? "bg-blue-50 border-blue-300 text-blue-700"
                      : "bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  OpenRouter
                </button>
                <button
                  onClick={() => handleChange("provider", "nvidia")}
                  className={`flex-1 px-3 py-2 text-xs rounded-lg border transition-colors ${
                    settings.provider === "nvidia"
                      ? "bg-green-50 border-green-300 text-green-700"
                      : "bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  NVIDIA
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">API Key</label>
              <input
                type="password"
                value={settings.apiKey}
                onChange={(e) => handleChange("apiKey", e.target.value)}
                placeholder={settings.provider === "openrouter" ? "sk-or-v1-..." : "nvapi-..."}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
              />
              <p className="text-xs text-gray-400 mt-1">
                {settings.provider === "openrouter" 
                  ? "Get key from openrouter.ai/keys"
                  : "Get key from build.nvidia.com → API key"}
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Model</label>
              <input
                type="text"
                value={settings.model}
                onChange={(e) => handleChange("model", e.target.value)}
                placeholder={settings.provider === "openrouter" 
                  ? "e.g., openai/gpt-4o, anthropic/claude-3.5-sonnet"
                  : "e.g., meta/llama-3.1-405b-instruct"}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
              />
              <p className="text-xs text-gray-400 mt-1">
                {settings.provider === "openrouter" 
                  ? "Browse models at openrouter.ai/models"
                  : "Browse models at build.nvidia.com/explore/ai-foundational-models"}
              </p>
            </div>

            <div className="pt-2 border-t border-gray-100">
              <p className="text-xs text-gray-400">
                Current: <span className="font-mono">{settings.model}</span>
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
