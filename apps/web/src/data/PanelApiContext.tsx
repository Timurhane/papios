import { createContext, useContext, type ReactNode } from 'react';
import type { PanelApi } from './types';

const Ctx = createContext<PanelApi | null>(null);

export function PanelApiProvider({ api, children }: { api: PanelApi; children: ReactNode }) {
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function usePanelApi(): PanelApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('usePanelApi must be used inside PanelApiProvider');
  return api;
}
