"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "~/lib/utils";

const buttonVariants = cva(
  "[&_svg]:-mx-0.5 relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-medium text-base outline-none before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 sm:text-sm [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-9 px-[calc(--spacing(3)-1px)] text-foreground sm:h-8",
        icon:
          "size-8 rounded-md text-muted-foreground/70 before:rounded-[calc(var(--radius-md)-1px)] hover:text-foreground data-pressed:text-foreground hover:[&_svg:not([class*='opacity-'])]:opacity-100 data-pressed:[&_svg:not([class*='opacity-'])]:opacity-100 sm:size-8 [&_svg:not([class*='opacity-'])]:opacity-65",
        "icon-lg":
          "size-8 rounded-md text-muted-foreground/70 before:rounded-[calc(var(--radius-md)-1px)] hover:text-foreground data-pressed:text-foreground hover:[&_svg:not([class*='opacity-'])]:opacity-100 data-pressed:[&_svg:not([class*='opacity-'])]:opacity-100 sm:size-8 [&_svg:not([class*='opacity-'])]:opacity-65",
        "icon-sm":
          "size-8 rounded-md text-muted-foreground/70 before:rounded-[calc(var(--radius-md)-1px)] hover:text-foreground data-pressed:text-foreground hover:[&_svg:not([class*='opacity-'])]:opacity-100 data-pressed:[&_svg:not([class*='opacity-'])]:opacity-100 sm:size-8 [&_svg:not([class*='opacity-'])]:opacity-65",
        "icon-xl":
          "size-8 rounded-md text-muted-foreground/70 before:rounded-[calc(var(--radius-md)-1px)] hover:text-foreground data-pressed:text-foreground hover:[&_svg:not([class*='opacity-'])]:opacity-100 data-pressed:[&_svg:not([class*='opacity-'])]:opacity-100 sm:size-8 [&_svg:not([class*='opacity-'])]:opacity-65",
        "icon-xs":
          "size-5 rounded-md text-muted-foreground/70 before:rounded-[calc(var(--radius-md)-1px)] hover:text-foreground data-pressed:text-foreground hover:[&_svg:not([class*='opacity-'])]:opacity-100 data-pressed:[&_svg:not([class*='opacity-'])]:opacity-100 sm:size-5 [&_svg:not([class*='opacity-'])]:opacity-65",
        lg: "h-10 px-[calc(--spacing(3.5)-1px)] sm:h-9",
        sm: "h-8 gap-1.5 px-[calc(--spacing(2.5)-1px)] sm:h-7",
        xl: "h-11 px-[calc(--spacing(4)-1px)] text-lg sm:h-10 sm:text-base [&_svg:not([class*='size-'])]:size-5 sm:[&_svg:not([class*='size-'])]:size-4.5",
        xs: "h-7 gap-1 rounded-md px-[calc(--spacing(2)-1px)] text-sm before:rounded-[calc(var(--radius-md)-1px)] sm:h-6 sm:text-xs [&_svg:not([class*='size-'])]:size-4 sm:[&_svg:not([class*='size-'])]:size-3.5",
      },
      variant: {
        default:
          "not-disabled:inset-shadow-[0_1px_--theme(--color-white/16%)] border-primary bg-primary text-primary-foreground shadow-primary/24 shadow-xs [:active,[data-pressed]]:inset-shadow-[0_1px_--theme(--color-black/8%)] [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:bg-primary/90",
        destructive:
          "not-disabled:inset-shadow-[0_1px_--theme(--color-white/16%)] border-destructive bg-destructive text-white shadow-destructive/24 shadow-xs [:active,[data-pressed]]:inset-shadow-[0_1px_--theme(--color-black/8%)] [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:bg-destructive/90",
        "destructive-outline":
          "border-input bg-popover not-dark:bg-clip-padding text-destructive-foreground shadow-xs/5 not-disabled:not-active:not-data-pressed:before:shadow-[0_1px_--theme(--color-black/4%)] dark:bg-input/32 dark:not-disabled:before:shadow-[0_-1px_--theme(--color-white/2%)] dark:not-disabled:not-active:not-data-pressed:before:shadow-[0_-1px_--theme(--color-white/6%)] [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:border-destructive/32 [:hover,[data-pressed]]:bg-destructive/4",
        ghost:
          "border-transparent data-pressed:bg-accent [:hover,[data-pressed]]:bg-accent/60",
        link: "border-transparent underline-offset-4 [:hover,[data-pressed]]:underline",
        outline:
          "border-input bg-popover not-dark:bg-clip-padding text-foreground shadow-xs/5 not-disabled:not-active:not-data-pressed:before:shadow-[0_1px_--theme(--color-black/4%)] dark:bg-input/32 dark:not-disabled:before:shadow-[0_-1px_--theme(--color-white/2%)] dark:not-disabled:not-active:not-data-pressed:before:shadow-[0_-1px_--theme(--color-white/6%)] [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:bg-accent/50 dark:[:hover,[data-pressed]]:bg-input/64",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [:active,[data-pressed]]:bg-secondary/80 [:hover,[data-pressed]]:bg-secondary/90",
      },
    },
  },
);

interface ButtonProps extends useRender.ComponentProps<"button"> {
  variant?: VariantProps<typeof buttonVariants>["variant"];
  size?: VariantProps<typeof buttonVariants>["size"];
}

function Button({ className, variant, size, render, ...props }: ButtonProps) {
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] = render
    ? undefined
    : "button";

  const defaultProps = {
    className: cn(buttonVariants({ className, size, variant })),
    "data-slot": "button",
    type: typeValue,
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}

export { Button, buttonVariants };
