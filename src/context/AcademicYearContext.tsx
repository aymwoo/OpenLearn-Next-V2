import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { fetchSiteSettings } from '../services/sessionService';

export type AcademicYearValue = string | null;

export interface AcademicYearContextValue {
  academicYear: AcademicYearValue;
  setAcademicYear: (value: AcademicYearValue) => void;
  /** Value for API calls: 'all' becomes null. */
  apiAcademicYear: string | null;
  currentAcademicYear: string | null;
  loading: boolean;
}

const AcademicYearContext = createContext<AcademicYearContextValue | null>(null);

const STORAGE_KEY = 'openlearn_academic_year';

function readUrlYear(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const value = params.get('academicYear');
  return value ? value : null;
}

function readStoredYear(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredYear(value: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, value);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function AcademicYearProvider({ children }: { children: React.ReactNode }) {
  const [academicYear, setAcademicYearState] = useState<AcademicYearValue>(
    () => readUrlYear() || readStoredYear() || null,
  );
  const [currentAcademicYear, setCurrentAcademicYear] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetchSiteSettings();
        if (!mounted) return;
        if (res.ok && res.data) {
          const year = (res.data.currentAcademicYear as string) || null;
          setCurrentAcademicYear(year);
          if (!academicYear && year) {
            setAcademicYearState(year);
          }
        }
      } catch {
        // ignore; use URL/localStorage state
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setAcademicYear = (value: AcademicYearValue) => {
    const normalized = value === 'all' ? null : value;
    setAcademicYearState(normalized);
    writeStoredYear(normalized);

    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (normalized) url.searchParams.set('academicYear', normalized);
      else url.searchParams.delete('academicYear');
      window.history.replaceState({}, '', url.toString());
    }
  };

  const apiAcademicYear = academicYear === 'all' || academicYear === null ? null : academicYear;

  const value = useMemo(
    () => ({
      academicYear,
      setAcademicYear,
      apiAcademicYear,
      currentAcademicYear,
      loading,
    }),
    [academicYear, apiAcademicYear, currentAcademicYear, loading],
  );

  return <AcademicYearContext.Provider value={value}>{children}</AcademicYearContext.Provider>;
}

export function useAcademicYear(): AcademicYearContextValue {
  const ctx = useContext(AcademicYearContext);
  if (!ctx) throw new Error('useAcademicYear must be used within AcademicYearProvider');
  return ctx;
}

export function useOptionalAcademicYear(): AcademicYearContextValue | null {
  return useContext(AcademicYearContext);
}
