import React, { useState, useRef, useEffect, useCallback } from 'react';
import { User, ChevronUp, Plus, X, Check } from 'lucide-react';
import type { PersonaInfo } from '../../hooks/usePersona';

interface PersonaSelectorProps {
  personas: PersonaInfo[];
  activePersonaId: string | null;
  onSwitch: (personaId: string) => void;
  onCreate: (name: string, prompt: string) => void;
}

const PersonaSelector: React.FC<PersonaSelectorProps> = ({
  personas,
  activePersonaId,
  onSwitch,
  onCreate,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const activePersona = personas.find(p => p.id === activePersonaId);
  const displayName = activePersona?.name || 'No Persona';

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setShowNewDialog(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showNewDialog) {
          setShowNewDialog(false);
        } else {
          setIsOpen(false);
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, showNewDialog]);

  // Focus name input when dialog opens
  useEffect(() => {
    if (showNewDialog && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [showNewDialog]);

  const handleCreate = useCallback(() => {
    const trimmedName = newName.trim();
    if (!trimmedName) return;
    onCreate(trimmedName, newPrompt.trim());
    setNewName('');
    setNewPrompt('');
    setShowNewDialog(false);
    setIsOpen(false);
  }, [newName, newPrompt, onCreate]);

  const handleSelect = useCallback((personaId: string) => {
    onSwitch(personaId);
    setIsOpen(false);
  }, [onSwitch]);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(prev => !prev)}
        className="flex items-center gap-1 hover:bg-white/10 px-1 py-0.5 rounded transition-colors cursor-pointer"
        title={`Persona: ${displayName} — Click to change`}
      >
        <User size={11} />
        <span className="hidden sm:inline max-w-[100px] truncate">{displayName}</span>
        <ChevronUp size={9} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {isOpen && !showNewDialog && (
        <div className="
          absolute bottom-full left-0 mb-1 w-56 z-[99999]
          bg-[#111111] border border-zinc-800/60 rounded-xl shadow-2xl shadow-black/60
          overflow-hidden animate-fade-in
        ">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/40">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Personas
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowNewDialog(true);
              }}
              className="
                flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300
                transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-indigo-500/10
              "
              title="Create new persona"
            >
              <Plus size={11} />
              <span>New…</span>
            </button>
          </div>

          {/* "None" option */}
          <div className="py-1">
            {personas.length === 0 && (
              <div className="px-3 py-2 text-[11px] text-zinc-600 italic">
                No personas configured
              </div>
            )}

            {personas.map((persona) => {
              const active = persona.id === activePersonaId;
              return (
                <button
                  key={persona.id}
                  onClick={() => handleSelect(persona.id)}
                  className={`
                    w-full flex items-center gap-2 px-3 py-1.5 text-left cursor-pointer
                    transition-all duration-150
                    ${active
                      ? 'bg-indigo-500/10 text-indigo-300'
                      : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'}
                  `}
                >
                  <User size={12} className={active ? 'text-indigo-400' : 'text-zinc-600'} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-medium truncate">{persona.name}</div>
                    {persona.description && (
                      <div className="text-[9px] text-zinc-600 truncate mt-0.5">{persona.description}</div>
                    )}
                  </div>
                  {active && (
                    <Check size={12} className="text-indigo-400 shrink-0" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Footer hint */}
          <div className="px-3 py-1.5 border-t border-zinc-800/40 text-[9px] text-zinc-600">
            Persona applies to the current conversation
          </div>
        </div>
      )}

      {/* New Persona mini-dialog */}
      {isOpen && showNewDialog && (
        <div className="
          absolute bottom-full left-0 mb-1 w-72 z-[99999]
          bg-[#111111] border border-zinc-800/60 rounded-xl shadow-2xl shadow-black/60
          overflow-hidden animate-fade-in
        ">
          {/* Dialog header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/40">
            <span className="text-[11px] font-semibold text-zinc-300">New Persona</span>
            <button
              onClick={() => setShowNewDialog(false)}
              className="text-zinc-600 hover:text-zinc-300 transition-colors cursor-pointer p-0.5"
            >
              <X size={12} />
            </button>
          </div>

          {/* Form */}
          <div className="p-3 space-y-2.5">
            <div>
              <label className="block text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-1">
                Name
              </label>
              <input
                ref={nameInputRef}
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newName.trim()) {
                    handleCreate();
                  }
                }}
                placeholder="e.g. Code Reviewer"
                className="
                  w-full bg-zinc-900 text-zinc-100 text-[11px]
                  px-2.5 py-1.5 rounded-lg border border-zinc-700/50
                  focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/20
                  placeholder:text-zinc-700
                "
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-1">
                Persona Prompt
              </label>
              <textarea
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.metaKey && newName.trim()) {
                    handleCreate();
                  }
                }}
                placeholder="Describe how this persona should behave…"
                rows={3}
                className="
                  w-full bg-zinc-900 text-zinc-100 text-[11px] leading-relaxed
                  px-2.5 py-1.5 rounded-lg border border-zinc-700/50 resize-none
                  focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/20
                  placeholder:text-zinc-700
                "
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setShowNewDialog(false)}
                className="
                  text-[10px] px-3 py-1.5 rounded-lg text-zinc-500 hover:text-zinc-300
                  hover:bg-zinc-800/50 transition-colors cursor-pointer
                "
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newName.trim()}
                className="
                  text-[10px] px-3 py-1.5 rounded-lg font-medium
                  bg-indigo-600 text-white hover:bg-indigo-500 
                  disabled:opacity-40 disabled:cursor-not-allowed
                  transition-colors cursor-pointer
                "
              >
                Create & Activate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PersonaSelector;
