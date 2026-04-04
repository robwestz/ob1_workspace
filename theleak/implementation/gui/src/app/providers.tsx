'use client';

import React, { createContext, useContext, useMemo } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { OB1ApiClient } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

const SupabaseContext = createContext<SupabaseClient | null>(null);

export function useSupabase(): SupabaseClient {
  const client = useContext(SupabaseContext);
  if (!client) {
    throw new Error('useSupabase must be used within <Providers>');
  }
  return client;
}

// ---------------------------------------------------------------------------
// API Client
// ---------------------------------------------------------------------------

const ApiContext = createContext<OB1ApiClient | null>(null);

export function useApiContext(): OB1ApiClient {
  const client = useContext(ApiContext);
  if (!client) {
    throw new Error('useApiContext must be used within <Providers>');
  }
  return client;
}

// ---------------------------------------------------------------------------
// Provider tree
// ---------------------------------------------------------------------------

interface ProvidersProps {
  children: React.ReactNode;
  supabaseUrl: string;
  accessKey: string;
}

export function Providers({ children, supabaseUrl, accessKey }: ProvidersProps) {
  const supabase = useMemo(
    () =>
      createClient(supabaseUrl || 'https://placeholder.supabase.co', accessKey || 'placeholder', {
        auth: { persistSession: false },
      }),
    [supabaseUrl, accessKey],
  );

  const api = useMemo(
    () => new OB1ApiClient(supabaseUrl || 'https://placeholder.supabase.co', accessKey || 'placeholder'),
    [supabaseUrl, accessKey],
  );

  return (
    <SupabaseContext.Provider value={supabase}>
      <ApiContext.Provider value={api}>{children}</ApiContext.Provider>
    </SupabaseContext.Provider>
  );
}
