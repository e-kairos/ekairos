"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  Excalidraw,
  Footer,
  MainMenu,
  Sidebar,
  WelcomeScreen,
  restoreElements,
} from "@excalidraw/excalidraw";

type ExcalidrawApi = {
  updateScene?: (scene: { appState?: Record<string, unknown>; elements?: unknown[] }) => void;
};

type CanvasProps = {
  children?: ReactNode;
  elements?: unknown[];
  appState?: Record<string, unknown>;
  excalidrawAPI?: (api: ExcalidrawApi) => void;
  gridModeEnabled?: boolean;
  onChange?: (...args: unknown[]) => void;
  theme?: "light" | "dark";
  UIOptions?: Record<string, unknown>;
  viewModeEnabled?: boolean;
  zenModeEnabled?: boolean;
};

export const Canvas = ({
  appState,
  children,
  elements = [],
  excalidrawAPI,
  gridModeEnabled = false,
  onChange = () => {},
  theme = "light",
  UIOptions,
  viewModeEnabled = true,
  zenModeEnabled = true,
  ...props
}: CanvasProps) => {
  const [api, setApi] = useState<ExcalidrawApi | null>(null);
  const restoredElements = useMemo(() => restoreElements(elements, null), [elements]);
  const initialData = useMemo(
    () => ({
      appState: {
        viewBackgroundColor: "var(--sidebar)",
        ...appState,
      },
      elements: restoredElements,
    }),
    [appState, restoredElements],
  );
  const handleExcalidrawAPI = useCallback(
    (nextApi: ExcalidrawApi) => {
      setApi(nextApi);
      excalidrawAPI?.(nextApi);
    },
    [excalidrawAPI],
  );

  useEffect(() => {
    api?.updateScene?.({
      appState: initialData.appState,
      elements: restoredElements,
    });
  }, [api, initialData.appState, restoredElements]);

  return (
    <Excalidraw
      excalidrawAPI={handleExcalidrawAPI}
      gridModeEnabled={gridModeEnabled}
      initialData={initialData}
      onChange={onChange}
      theme={theme}
      UIOptions={UIOptions}
      viewModeEnabled={viewModeEnabled}
      zenModeEnabled={zenModeEnabled}
      {...props}
    >
      {children ?? (
        <>
          <Sidebar name="custom">{null}</Sidebar>
          <Footer>{null}</Footer>
          <MainMenu>{null}</MainMenu>
          <WelcomeScreen>{null}</WelcomeScreen>
        </>
      )}
    </Excalidraw>
  );
};
