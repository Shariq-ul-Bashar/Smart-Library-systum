import React, { createContext, useContext, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  mode: ThemeMode;
  resolvedTheme: 'light' | 'dark';
  setMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'qivora-theme';

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    try {
      const saved = (localStorage.getItem(STORAGE_KEY) || localStorage.getItem('sharixa-theme')) as ThemeMode | null;
      if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
    } catch {
      // ignore storage errors
    }
    return 'system';
  });

  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() =>
    mode === 'system' ? getSystemTheme() : mode
  );

  useEffect(() => {
    const apply = (targetMode: ThemeMode) => {
      const resolved = targetMode === 'system' ? getSystemTheme() : targetMode;
      setResolvedTheme(resolved);
      const root = document.documentElement;
      if (resolved === 'dark') {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    };

    apply(mode);

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => {
      if (mode === 'system') apply('system');
    };
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [mode]);

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  };

  const toggleTheme = () => {
    setMode(resolvedTheme === 'dark' ? 'light' : 'dark');
  };

  return (
    <ThemeContext.Provider value={{ mode, resolvedTheme, setMode, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
