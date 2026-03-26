import * as React from "react"
import { cn } from "@/lib/utils"
import { ChevronDown } from "lucide-react"

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[];
}

const SelectNative = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            "flex h-12 w-full appearance-none items-center justify-between rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm text-foreground shadow-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary focus:bg-black/40 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200",
            className
          )}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-card text-foreground">
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 opacity-50 pointer-events-none" />
      </div>
    )
  }
)
SelectNative.displayName = "SelectNative"

export { SelectNative }
