import React from 'react';
import { HardDrive, Database, BrainCircuit } from 'lucide-react';
import { FileTree } from './FileTree.jsx';

export const RightPanel = ({
    activeTab,
    onTabChange,
    fsState,
    selectedFile,
    onFileSelect,
    volMemList,
    involMemList,
    isTransformersLoaded,
}) => (
    <div className="w-[420px] bg-slate-900 flex flex-col shadow-[-10px_0_30px_rgba(0,0,0,0.3)] z-20 border-l border-slate-800">
        {/* Tab Bar */}
        <div className="flex bg-slate-950 border-b border-slate-800">
            <button
                onClick={() => onTabChange('vfs')}
                className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors ${activeTab === 'vfs' ? 'bg-slate-800 text-blue-400 border-b-2 border-blue-500' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-900'}`}
            >
                <HardDrive size={14}/> VFS
            </button>
            <button
                onClick={() => onTabChange('vol_mem')}
                className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors ${activeTab === 'vol_mem' ? 'bg-slate-800 text-amber-400 border-b-2 border-amber-500' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-900'}`}
            >
                <Database size={14}/> Voluntary
            </button>
            <button
                onClick={() => onTabChange('invol_mem')}
                className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors ${activeTab === 'invol_mem' ? 'bg-slate-800 text-purple-400 border-b-2 border-purple-500' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-900'}`}
            >
                <BrainCircuit size={14}/> Involuntary
            </button>
        </div>
        
        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-900">
            {activeTab === 'vfs' && (
                <div className="p-4">
                    <FileTree fs={fsState} onFileSelect={onFileSelect} />
                </div>
            )}

            {activeTab === 'vol_mem' && (
                <div className="p-4 space-y-3">
                    <div className="text-xs text-slate-500 mb-4 italic">
                        Voluntary memory (Embeddings: {isTransformersLoaded ? 'Semantic' : 'Lexical'}).
                    </div>
                    {volMemList.length === 0 ? (
                        <div className="text-slate-600 text-sm text-center mt-10">Memory Bank Empty</div>
                    ) : (
                        volMemList.map(mem => (
                            <div key={mem.id} className="bg-slate-950 p-3 rounded border border-slate-800 font-mono text-xs">
                                <div className="text-slate-500 mb-1 flex justify-between">
                                    <span>ID: {mem.id}</span>
                                    <span>{new Date(mem.createdAt).toLocaleTimeString()}</span>
                                </div>
                                <div className="text-amber-300">{mem.text}</div>
                            </div>
                        ))
                    )}
                </div>
            )}

            {activeTab === 'invol_mem' && (
                <div className="p-4 space-y-3">
                    <div className="text-xs text-slate-500 mb-4 italic">
                        Automatically capturing context.
                    </div>
                    {involMemList.length === 0 ? (
                        <div className="text-slate-600 text-sm text-center mt-10">No Impressions Yet</div>
                    ) : (
                        [...involMemList].reverse().map(mem => (
                            <div key={mem.id} className="bg-slate-950 p-3 rounded border border-slate-800 font-mono text-xs">
                                <div className="text-slate-500 mb-1">ID: {mem.id}</div>
                                <div className="text-purple-300">{mem.text}</div>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
        
        {/* File Preview */}
        <div className={`transition-all duration-300 flex flex-col border-t border-slate-800 bg-slate-950 ${selectedFile && activeTab === 'vfs' ? 'h-1/2' : 'h-0 border-transparent overflow-hidden'}`}>
            {selectedFile && activeTab === 'vfs' && (
                <>
                    <div className="p-2 bg-slate-900 text-xs font-mono text-emerald-400 flex justify-between items-center border-b border-slate-800">
                        <span className="truncate pr-4">{selectedFile.path}</span>
                        <button onClick={() => onFileSelect(null)} className="text-slate-500 hover:text-white transition-colors">✖</button>
                    </div>
                    <pre className="flex-1 p-3 overflow-y-auto text-xs font-mono text-slate-300 whitespace-pre-wrap">
                        {selectedFile.content}
                    </pre>
                </>
            )}
        </div>
    </div>
);
