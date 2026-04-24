import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "../../lib/utils";

/**
 * Sharp-edged button primitive. No shadows, no rounded corners, no soft hover
 * lift — brutalist by intent. Variants differ by border weight and fill only,
 * so every CTA reads as a typographic block rather than a floating chip.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-medium transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:ring-foreground disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap border uppercase tracking-[0.08em]",
  {
    variants: {
      variant: {
        primary:
          "bg-foreground text-background border-foreground hover:bg-background hover:text-foreground",
        brand:
          "bg-brand text-brand-foreground border-brand hover:brightness-110 hover:bg-brand/95",
        outline:
          "bg-background text-foreground border-foreground hover:bg-foreground hover:text-background",
        ghost:
          "bg-transparent text-foreground border-transparent hover:border-foreground",
      },
      size: {
        sm: "h-9 px-4 text-[0.72rem]",
        md: "h-11 px-5 text-[0.78rem]",
        lg: "h-12 px-6 text-[0.82rem]",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

type AnchorProps = ComponentPropsWithoutRef<"a"> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, children, ...props }: AnchorProps): ReactNode {
  return (
    <a className={cn(buttonVariants({ variant, size }), className)} {...props}>
      {children}
    </a>
  );
}
