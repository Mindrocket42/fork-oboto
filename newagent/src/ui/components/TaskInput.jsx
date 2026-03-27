import React from 'react';

export const TaskInput = ({ task, onChange, isRunning }) => (
    <div className="absolute bottom-0 left-0 right-0 p-4 bg-slate-900/95 backdrop-blur-sm border-t border-slate-800 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
        <div className="max-w-4xl mx-auto">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Assign New Task
            </label>
            <textarea 
                value={task}
                onChange={(e) => onChange(e.target.value)}
                disabled={isRunning}
                placeholder="Instruct the agent..."
                className="w-full bg-black/50 border border-slate-700 rounded-lg p-3 text-slate-200 font-sans focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 resize-none h-20 disabled:opacity-50 transition-all shadow-inner"
            />
        </div>
    </div>
);
