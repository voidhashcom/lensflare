import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Ported from `apps/web/src/lib/utils.ts` so class-composition behaves identically across apps. */
export function cn(...inputs: Array<ClassValue>): string {
  return twMerge(clsx(inputs));
}
