import React, { useState, useMemo } from 'react';
import { Terminal as TerminalIcon, ChevronDown, ChevronRight, Copy, Check, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

interface TerminalToolCallProps {
  args: unknown;
  result?: unknown;
}

/** Parse the run_command args to extract command, cwd, and timeout */
function parseArgs(args: unknown): { command: string; cwd?: string; timeout?: number } {
  if (!args) return { command: '' };
  try {
    const obj = typeof args === 'string' ? JSON.parse(args) : args;
    if (obj && typeof obj === 'object') {
      return {
        command: (obj as Record<string, unknown>).command as string || '',
        cwd: (obj as Record<string, unknown>).cwd as string | undefined,
        timeout: (obj as Record<string, unknown>).timeout as number | undefined,
      };
    }
  } catch { /* ignore */ }
  return { command: String(args) };
}

/** Parse the result string into structured output */
function parseResult(result: unknown): { stdout: string; stderr: string; exitCode?: number; isError: boolean } {
  if (result === undefined || result === null) {
    return { stdout: '', stderr: '', isError: false };
  }

  const str = typeof result === 'string' ? result : JSON.stringify(result);

  // Check for error format: "Error (exit N): ..."
  const errorMatch = str.match(/^Error\s*\(exit\s+(\d+)\):\s*([\s\S]*)$/);
  if (errorMatch) {
    return {
      stdout: '',
      stderr: errorMatch[2].trim(),
      exitCode: parseInt(errorMatch[1], 10),
      isError: true,
    };
  }

  // Check for error format without exit code
  if (str.startsWith('Error:')) {
    return {
      stdout: '',
      stderr: str.slice(6).trim(),
      isError: true,
    };
  }

  // Parse STDOUT/STDERR sections
  let stdout = '';
  let stderr = '';

  const stdoutMatch = str.match(/STDOUT:\n([\s\S]*?)(?=\nSTDERR:|$)/);
  const stderrMatch = str.match(/STDERR:\n([\s\S]*)$/);

  if (stdoutMatch) {
    stdout = stdoutMatch[1].trimEnd();
  } else if (!str.includes('STDOUT:') && !str.includes('STDERR:')) {
    // Raw output without markers
    stdout = str;
  }

  if (stderrMatch) {
    stderr = stderrMatch[1].trimEnd();
  }

  return { stdout, stderr, isError: false };
}

const TerminalToolCall: React.FC<TerminalToolCallProps> = ({ args, result }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  const { command, cwd } = parseArgs(args);
  const parsed = useMemo(() => parseResult(result), [result]);
  const isPending = result === undefined || result === null;
  const hasOutput = parsed.stdout || parsed.stderr;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = [
      command && `$ ${command}`,
      parsed.stdout,
      parsed.stderr && `stderr: ${parsed.stderr}`,
    ].filter(Boolean).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="w-full bg-[#0c0c0c] border border-zinc-800/50 rounded-xl overflow-hidden shadow-lg shadow-black/20 my-2 font-mono transition-all duration-300 hover:border-zinc-700/40 animate-fade-in-up">
      {/* ── Terminal Title Bar ──────────────────────────────── */}
      <div
        className="flex items-center gap-2 px-3 py-2 bg-[#161616] border-b border-zinc-800/40 cursor-pointer select-none hover:bg-[#1a1a1a] transition-colors"
        onClick={() => setIsExpanded(e => !e)}
      >
        {/* Traffic lights */}
        <div className="flex items-center gap-1.5 mr-1">
          <div className={`w-2.5 h-2.5 rounded-full ${parsed.isError ? 'bg-rose-500/80' : isPending ? 'bg-amber-500/80' : 'bg-emerald-500/80'}`} />
          <div className={`w-2.5 h-2.5 rounded-full ${parsed.isError ? 'bg-rose-500/40' : 'bg-amber-500/50'}`} />
          <div className="w-2.5 h-2.5 rounded-full bg-zinc-700/60" />
        </div>

        <TerminalIcon size={12} className="text-zinc-500" />

        {/* Title / CWD */}
        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.12em] flex-1 truncate">
          {cwd ? cwd.split('/').pop() || 'terminal' : 'terminal'}
        </span>

        {/* Status badge */}
        {isPending ? (
          <span className="flex items-center gap-1 text-[9px] text-amber-500/80 font-semibold uppercase tracking-wider">
            <Loader2 size={10} className="animate-spin" /> Running
          </span>
        ) : parsed.isError ? (
          <span className="flex items-center gap-1 text-[9px] text-rose-400/80 font-semibold uppercase tracking-wider">
            <AlertTriangle size={10} /> Exit {parsed.exitCode ?? '!'}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[9px] text-emerald-500/70 font-semibold uppercase tracking-wider">
            <CheckCircle2 size={10} /> Done
          </span>
        )}

        {/* Copy button */}
        <button
          onClick={handleCopy}
          className="p-1 rounded hover:bg-zinc-700/40 text-zinc-600 hover:text-zinc-300 transition-colors ml-1"
          title="Copy output"
        >
          {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
        </button>

        {/* Expand/collapse */}
        <span className="text-zinc-600 transition-transform duration-200">
          {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      </div>

      {/* ── Terminal Body ──────────────────────────────────── */}
      {isExpanded && (
        <div className="px-4 py-3 space-y-1 text-[11.5px] leading-[1.7] max-h-[400px] overflow-y-auto custom-scrollbar">
          {/* Command prompt line */}
          {command && (
            <div className="flex gap-2 items-start">
              <span className="text-emerald-500/70 select-none shrink-0">$</span>
              <span className="text-emerald-300/90 break-all">{command}</span>
            </div>
          )}

          {/* CWD indicator if specified */}
          {cwd && (
            <div className="text-zinc-600 text-[10px] pl-4 -mt-0.5 mb-1">
              ↳ in {cwd}
            </div>
          )}

          {/* stdout */}
          {parsed.stdout && (
            <pre className="text-zinc-400 whitespace-pre-wrap break-words pl-4 mt-1">
              {parsed.stdout}
            </pre>
          )}

          {/* stderr */}
          {parsed.stderr && (
            <pre className={`whitespace-pre-wrap break-words pl-4 mt-1 ${parsed.isError ? 'text-rose-400/90' : 'text-amber-500/70'}`}>
              {parsed.stderr}
            </pre>
          )}

          {/* Pending cursor animation */}
          {isPending && (
            <div className="flex gap-2 items-center mt-1">
              <span className="text-emerald-500/70 select-none">$</span>
              <div className="w-1.5 h-4 bg-emerald-500/60 animate-pulse rounded-sm" />
            </div>
          )}

          {/* Empty result */}
          {!isPending && !hasOutput && (
            <div className="text-zinc-600 text-[10px] pl-4 italic mt-1">
              (no output)
            </div>
          )}
        </div>
      )}

      {/* ── Bottom glow for active/error ───────────────────── */}
      {isPending && (
        <div className="h-[1px] bg-gradient-to-r from-transparent via-amber-500/30 to-transparent" />
      )}
      {parsed.isError && !isPending && (
        <div className="h-[1px] bg-gradient-to-r from-transparent via-rose-500/30 to-transparent" />
      )}
    </div>
  );
};

export default TerminalToolCall;
