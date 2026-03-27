import React from 'react';
import { FileText, FolderOpen } from 'lucide-react';

export const FileTree = ({ fs, path = '/', onFileSelect }) => {
    const node = fs[path];
    if (!node) return null;

    if (node.type === 'file') return (
        <div
            className="ml-4 text-emerald-400 flex items-center gap-2 cursor-pointer hover:bg-slate-800 p-1 rounded text-sm font-mono transition-colors"
            onClick={() => onFileSelect({ path, content: node.content })}
        >
            <FileText size={14} className="text-emerald-500"/> {path.split('/').pop() || '/'}
        </div>
    );

    return (
        <div className="ml-4 text-sm font-mono">
            <div className="text-blue-400 flex items-center gap-2 font-bold p-1">
                <FolderOpen size={14} className="text-blue-500"/> {path.split('/').pop() || '/'}
            </div>
            <div className="border-l border-slate-700 ml-2 pl-2 mt-1 space-y-1">
                {node.contents.map(child => (
                    <FileTree
                        key={child}
                        fs={fs}
                        path={path === '/' ? `/${child}` : `${path}/${child}`}
                        onFileSelect={onFileSelect}
                    />
                ))}
            </div>
        </div>
    );
};
