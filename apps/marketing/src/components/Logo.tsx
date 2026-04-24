import type { SVGProps } from "react";

import { cn } from "../lib/utils";
import { LOGO_PATH } from "../lib/logoPath";

/** Full Lensflare wordmark (flare symbol + type). Renders in `currentColor`. */
export function Logo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={cn("h-auto w-full", className)}
      fill="none"
      viewBox="0 0 2100 412"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d={LOGO_PATH} fill="currentColor" />
    </svg>
  );
}
