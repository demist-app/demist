import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08080E] disabled:pointer-events-none disabled:opacity-40 active:scale-[0.97] cursor-pointer [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-amber-600 text-white hover:bg-amber-500 shadow-[0_0_20px_rgba(217,119,6,0.3)] hover:shadow-[0_0_28px_rgba(217,119,6,0.45)]",
        secondary:
          "bg-white/[0.06] text-white/80 border border-white/[0.09] hover:bg-white/[0.10] hover:text-white hover:border-white/[0.15]",
        ghost:
          "text-white/60 hover:bg-white/[0.06] hover:text-white",
        outline:
          "border border-white/[0.12] text-white/70 hover:bg-white/[0.05] hover:text-white hover:border-white/[0.20]",
        destructive:
          "bg-red-500/[0.10] text-red-400 border border-red-500/[0.20] hover:bg-red-500/[0.18] hover:border-red-500/[0.35]",
        link:
          "text-amber-400 underline-offset-4 hover:underline hover:text-amber-300 p-0 h-auto",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-11 px-6 text-[15px]",
        xl: "h-13 px-8 text-base",
        icon: "h-9 w-9",
        "icon-sm": "h-8 w-8 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
