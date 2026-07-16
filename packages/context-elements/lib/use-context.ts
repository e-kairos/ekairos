"use client";

import {
  useContext as useContextBase,
  type ContextValue,
  type UseContextOptions as BaseUseContextOptions,
} from "@ekairos/events/react";

export type UseContextOptions = BaseUseContextOptions;
export type { ContextValue };

export function useContext(db: unknown, options: UseContextOptions): ContextValue {
  return useContextBase(db, options);
}
