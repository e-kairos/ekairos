"use client";

import type { ReactNode } from "react";
import {
  Artifact,
  ArtifactActions,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from "@/components/ai-elements/artifact";
import { cn } from "@/lib/utils";

export type MessageArtifactProps = {
  actionCallId?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
};

export function MessageArtifact({
  actionCallId,
  actions,
  children,
  className,
  contentClassName,
  description,
  eyebrow = "Artifact",
  title,
}: MessageArtifactProps) {
  return (
    <Artifact
      className={cn(
        "overflow-hidden rounded-md border-border/70 bg-muted/20 shadow-none",
        className
      )}
      data-artifact-eyebrow={typeof eyebrow === "string" ? eyebrow : undefined}
      data-artifact-title={typeof title === "string" ? title : undefined}
      data-ek-artifact-anchor={actionCallId || undefined}
      data-has-actions={actions ? "true" : "false"}
      data-has-description={description ? "true" : "false"}
      data-message-artifact
    >
      <ArtifactHeader className="gap-3 border-border/70 bg-muted/35 px-3 py-2">
        <div className="grid min-w-0 gap-0.5">
          {eyebrow ? (
            <span className="text-[10px] font-semibold uppercase tracking-normal text-muted-foreground">
              {eyebrow}
            </span>
          ) : null}
          <ArtifactTitle className="truncate text-sm">{title}</ArtifactTitle>
          {description ? (
            <ArtifactDescription className="truncate text-xs">
              {description}
            </ArtifactDescription>
          ) : null}
        </div>
        {actions ? (
          <ArtifactActions className="shrink-0">{actions}</ArtifactActions>
        ) : null}
      </ArtifactHeader>
      <ArtifactContent className={cn("p-3", contentClassName)}>
        {children}
      </ArtifactContent>
    </Artifact>
  );
}
