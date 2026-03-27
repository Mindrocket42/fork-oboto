import React from 'react';
import { Play, Square, Cpu, RefreshCcw, Activity } from 'lucide-react';

export const Header = ({ isRunning, isAstLoaded, systemStatus, onStart, onStop, onReset, taskEmpty }) => (
    <header className="bg-slate-900 border-b border-slate-800 p-4 flex justify-between items-center shadow-md z-10">
        <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
                <Cpu className="text-purple-500"/> LMScript Autonomous Agent
                <span className="text-xs bg-purple-900/50 text-purple-300 px-2 py-0.5 rounded ml-2">v2</span>
            </h1>
            <p className="text-xs text-slate-400 italic mt-1 flex items-center gap-2">
                <Activity size={12} className={isAstLoaded ? "text-green-400" : "text-amber-400"}/> 
                {systemStatus}
            </p>
        </div>
        <div className="flex gap-2">
            <button
                onClick={onReset}
                disabled={isRunning}
                className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded text-sm transition-colors"
            >
                <RefreshCcw size={14} /> Reset
            </button>
            {isRunning ? (
                <button
                    onClick={onStop}
                    className="flex items-center gap-2 px-4 py-1.5 bg-red-900/80 hover:bg-red-800 text-red-100 rounded text-sm font-bold shadow shadow-red-900/50 transition-colors"
                >
                    <Square size={14} /> Stop
                </button>
            ) : (
                <button
                    onClick={onStart}
                    disabled={taskEmpty}
                    className="flex items-center gap-2 px-4 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded text-sm font-bold shadow shadow-purple-600/50 transition-colors"
                >
                    <Play size={14} /> Start Execution
                </button>
            )}
        </div>
    </header>
);
