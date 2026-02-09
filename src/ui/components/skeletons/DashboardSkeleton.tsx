

export function DashboardSkeleton() {
    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Header Skeleton */}
            <div className="flex flex-col gap-2">
                <div className="h-8 w-48 bg-muted rounded-md animate-pulse" />
                <div className="h-4 w-64 bg-muted/50 rounded-md animate-pulse" />
            </div>

            {/* Stats Grid Skeleton */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="p-6 rounded-xl border bg-card text-card-foreground shadow-sm space-y-2">
                        <div className="h-4 w-24 bg-muted rounded animate-pulse" />
                        <div className="h-8 w-32 bg-muted rounded animate-pulse" />
                        <div className="h-3 w-40 bg-muted/50 rounded animate-pulse" />
                    </div>
                ))}
            </div>

            {/* Charts Section Skeleton */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                {/* Main Chart */}
                <div className="col-span-4 rounded-xl border bg-card p-6 shadow-sm">
                    <div className="mb-6 space-y-2">
                        <div className="h-5 w-32 bg-muted rounded animate-pulse" />
                        <div className="h-4 w-48 bg-muted/50 rounded animate-pulse" />
                    </div>
                    <div className="h-[300px] w-full bg-muted/20 rounded-lg animate-pulse flex items-end justify-between px-4 pb-4 gap-2">
                        {[...Array(12)].map((_, i) => (
                            <div
                                key={i}
                                className="bg-muted/40 rounded-t w-full"
                                style={{ height: `${Math.random() * 60 + 20}%` }}
                            />
                        ))}
                    </div>
                </div>

                {/* Recent Sales/Activity Skeleton */}
                <div className="col-span-3 rounded-xl border bg-card p-6 shadow-sm">
                    <div className="mb-6 space-y-2">
                        <div className="h-5 w-40 bg-muted rounded animate-pulse" />
                        <div className="h-4 w-56 bg-muted/50 rounded animate-pulse" />
                    </div>
                    <div className="space-y-6">
                        {[...Array(5)].map((_, i) => (
                            <div key={i} className="flex items-center gap-4">
                                <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
                                <div className="space-y-2 flex-1">
                                    <div className="h-4 w-32 bg-muted rounded animate-pulse" />
                                    <div className="h-3 w-20 bg-muted/50 rounded animate-pulse" />
                                </div>
                                <div className="h-4 w-16 bg-muted rounded animate-pulse" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}
