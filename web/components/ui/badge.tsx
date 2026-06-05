import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold leading-none tracking-wide transition-colors",
  {
    variants: {
      variant: {
        default: "bg-white/[0.08] text-white/70 border border-white/[0.10]",
        primary: "bg-amber-500/[0.15] text-amber-300 border border-amber-500/[0.25]",
        success: "bg-emerald-500/[0.12] text-emerald-400 border border-emerald-500/[0.20]",
        warning: "bg-amber-500/[0.12] text-amber-400 border border-amber-500/[0.20]",
        destructive: "bg-red-500/[0.12] text-red-400 border border-red-500/[0.20]",
        new: "bg-amber-600/[0.20] text-amber-300 border border-amber-500/[0.30]",
        outline: "border border-white/[0.12] text-white/60",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
