"use client";

import { useContext, type ContextValue, type UseContextOptions } from "./use-context";

export type UseContextDomainOptions = UseContextOptions;

export function useContextDomain(
  db: unknown,
  options: UseContextDomainOptions,
): ContextValue {
  return useContext(db, options);
}
