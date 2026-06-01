"use client";

import { memo } from "react";

import { cn } from "@/lib/utils";

type OrbLogoProps = {
  size?: number;
  className?: string;
  ariaHidden?: boolean;
};

export const OrbLogo = memo(function OrbLogo({
  size = 32,
  className,
  ariaHidden = false,
}: OrbLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={ariaHidden}
      className={cn("block text-foreground", className)}
    >
      <rect
        x="7.5"
        y="7.5"
        width="17"
        height="17"
        rx="1.5"
        transform="rotate(45 16 16)"
        stroke="currentColor"
        strokeWidth="2"
      />
      <rect
        x="10.75"
        y="10.75"
        width="10.5"
        height="10.5"
        rx="1"
        transform="rotate(45 16 16)"
        stroke="currentColor"
        strokeWidth="2"
      />
      <rect
        x="14.25"
        y="14.25"
        width="3.5"
        height="3.5"
        rx="0.5"
        transform="rotate(45 16 16)"
        fill="currentColor"
      />
    </svg>
  );
});
