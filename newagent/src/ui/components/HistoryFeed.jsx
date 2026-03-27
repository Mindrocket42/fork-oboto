import React from 'react';
import { Cpu, Terminal, AlertCircle, Zap } from 'lucide-react';

const UserMessage = ({ item }) => (
    <div className="flex flex-col">
        <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)]"/> 
            <span className="text-blue-400 font-bold text-xs tracking-wider uppercase">User Task</span>
        </div>
        <div className="text-slate-200">{item.content}</div>
    </div>
);

const AgentMessage = ({ item }) => (
    <div className="flex flex-col font-mono text-sm">
        <div className="flex items-center gap-2 mb-3">
            <Cpu size={16} className="text-purple-400"/> 
            <span className="text-purple-400 font-bold uppercase tracking-wider text-xs">Agent Cognitive Process</span>
        </div>
        <div className="mb-2 pl-4 border-l-2 border-indigo-500/50 text-indigo-300">
            <span className="font-bold mr-2 uppercase text-xs">Reflection:</span> 
            {item.reflection}
        </div>
        <div className="mb-4 pl-4 border-l-2 border-purple-500/30 text-slate-400">
            <span className="font-bold mr-2 uppercase text-xs text-slate-500">Reasoning:</span> 
            {item.reasoning}
        </div>
        <div className="pl-4 border-l-2 border-green-500/30 space-y-1">
            <span className="font-bold mr-2 uppercase text-xs text-slate-500 block mb-1">
                Batch Execution ({item.commands.length}):
            </span> 
            {item.commands.map((cmd, idx) => (
                <div key={idx} className="text-green-300 bg-green-950/50 px-2 py-0.5 rounded border border-green-900/50 inline-block mr-2 break-all">
                    {cmd}
                </div>
            ))}
        </div>
    </div>
);

const SystemMessage = ({ item }) => (
    <div className="flex flex-col font-mono text-sm">
        <div className="flex items-center gap-2 mb-3">
            <Terminal size={16} className="text-slate-500"/> 
            <span className="text-slate-500 font-bold uppercase tracking-wider text-xs">System Feedback</span>
        </div>
        
        {item.error ? (
            <div className="text-red-400 flex items-start gap-2 bg-red-950/20 p-2 rounded border border-red-900/30">
                <AlertCircle size={16} className="mt-0.5 shrink-0"/> 
                <div>{item.error}</div>
            </div>
        ) : (
            <div className="text-slate-300 bg-black/40 p-2 rounded border border-slate-800 whitespace-pre-wrap">
                {item.output}
            </div>
        )}
    </div>
);

export const HistoryFeed = React.forwardRef(({ history, isRunning }, ref) => (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-48 scroll-smooth bg-slate-950">
        {history.map((item, i) => (
            <div key={i} className={`p-4 rounded-lg border shadow-sm transition-all
                ${item.type === 'agent' ? 'border-purple-500/30 bg-purple-900/10' : 
                  item.type === 'system' ? 'border-slate-800 bg-slate-900/50' : 
                  'border-blue-500/30 bg-blue-900/10'}`}
            >
                {item.type === 'user' && <UserMessage item={item} />}
                {item.type === 'agent' && <AgentMessage item={item} />}
                {item.type === 'system' && <SystemMessage item={item} />}
            </div>
        ))}
        
        {isRunning && (
            <div className="flex items-center gap-3 text-purple-400 bg-purple-900/5 p-4 rounded-lg border border-purple-500/20">
                <Zap size={18} className="animate-pulse" /> 
                <span className="text-sm font-mono animate-pulse">Agent is reflecting and determining next batch of actions...</span>
            </div>
        )}
        <div ref={ref} />
    </div>
));

HistoryFeed.displayName = 'HistoryFeed';
