import { Progress } from "@/ui/components/ui/progress"

export function ProgressWithLabel({
    value,
    label,
    details
}: {
    value: number
    label?: string
    details?: string
}) {
    return (
        <div className="w-full max-w-sm space-y-2">
            <div className="flex justify-between text-sm">
                <span className="font-medium text-foreground">{label}</span>
                <span className="text-muted-foreground">{value}%</span>
            </div>
            <Progress value={value} />
            {details && (
                <p className="text-xs text-muted-foreground text-center pt-2">
                    {details}
                </p>
            )}
        </div>
    )
}
