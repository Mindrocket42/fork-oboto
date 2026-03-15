import { useState, useEffect, useCallback } from 'react';
import { wsService } from '../services/wsService';

export interface PersonaInfo {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
  isDefault: boolean;
}

export interface UsePersonaReturn {
  personas: PersonaInfo[];
  activePersonaId: string | null;
  switchPersona: (personaId: string) => void;
  createPersona: (name: string, prompt: string) => void;
  refreshPersonas: () => void;
}

export function usePersona(): UsePersonaReturn {
  const [personas, setPersonas] = useState<PersonaInfo[]>([]);
  const [activePersonaId, setActivePersonaId] = useState<string | null>(null);

  useEffect(() => {
    const unsubList = wsService.on('persona-list', (payload: unknown) => {
      const data = payload as { personas: PersonaInfo[]; activePersonaId: string | null };
      setPersonas(data.personas || []);
      setActivePersonaId(data.activePersonaId ?? null);
    });

    const unsubSwitched = wsService.on('persona-switched', () => {
      // persona-list broadcast already updates state
    });

    const unsubCreated = wsService.on('persona-created', () => {
      // persona-list broadcast already updates state
    });

    // Initial fetch
    wsService.listPersonas();

    return () => {
      unsubList();
      unsubSwitched();
      unsubCreated();
    };
  }, []);

  const switchPersona = useCallback((personaId: string) => {
    wsService.switchPersona(personaId);
  }, []);

  const createPersona = useCallback((name: string, prompt: string) => {
    wsService.createPersona(name, prompt);
  }, []);

  const refreshPersonas = useCallback(() => {
    wsService.listPersonas();
  }, []);

  return {
    personas,
    activePersonaId,
    switchPersona,
    createPersona,
    refreshPersonas,
  };
}
