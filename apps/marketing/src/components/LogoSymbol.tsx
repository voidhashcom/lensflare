import type { SVGProps } from "react";

import { cn } from "../lib/utils";
import { LOGO_PATH } from "../lib/logoPath";

/** Lensflare flare symbol (no wordmark). Same path string, tighter viewBox. */
export function LogoSymbol({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={cn("h-auto w-full", className)}
      fill="none"
      viewBox="0 0 374 412"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d={LOGO_PATH} fill="currentColor" />
    </svg>
  );
}
