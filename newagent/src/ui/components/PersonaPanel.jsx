import React from 'react';
import { UserCircle } from 'lucide-react';

export const PersonaPanel = ({ persona, onChange, isRunning, isOpen, onToggle }) => (
    <div className="bg-slate-900 border-b border-slate-800">
        <button
            onClick={onToggle}
            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800/50 transition-colors"
        >
            <UserCircle size={16} className={isOpen ? "text-purple-400" : ""} /> 
            Agent Persona &amp; Preamble
            <span className="ml-auto text-xs">{isOpen ? "▲" : "▼"}</span>
        </button>
        {isOpen && (
            <div className="p-4 pt-0 bg-slate-900">
                <textarea
                    value={persona}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={isRunning}
                    className="w-full h-32 bg-black/50 border border-slate-700 rounded-lg p-3 text-slate-300 text-sm font-mono focus:outline-none focus:border-purple-500 resize-none"
                />
            </div>
        )}
    </div>
);
