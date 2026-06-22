import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Package } from 'lucide-react'

import type { Product } from '@/local-db'
import { Input } from '@/ui/components'
import { cn } from '@/lib/utils'
import { platformService } from '@/services/platformService'

interface ProductAutocompleteInputProps {
    value: string
    onChange: (value: string) => void
    onSelectProduct: (product: Product) => void
    products: Product[]
    placeholder?: string
    className?: string
    disabled?: boolean
    hasSelection?: boolean
}

function getDisplayImageUrl(url?: string): string {
    if (!url) return ''
    if (url.startsWith('http')) return url
    if (url.startsWith('data:')) return url
    return platformService.convertFileSrc(url)
}

function ProductThumbnail({ url, name }: { url?: string; name: string }) {
    const [loadError, setLoadError] = useState(false)

    if (!url || loadError) {
        return (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-muted/40">
                <Package className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="h-7 w-7 shrink-0 overflow-hidden rounded bg-muted/30">
            <img
                src={getDisplayImageUrl(url)}
                alt={name}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
                onError={() => setLoadError(true)}
            />
        </div>
    )
}

export function ProductAutocompleteInput({
    value,
    onChange,
    onSelectProduct,
    products,
    placeholder,
    className,
    disabled,
    hasSelection
}: ProductAutocompleteInputProps) {
    const [isFocused, setIsFocused] = useState(false)
    const [justSelected, setJustSelected] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    const query = value.trim().toLowerCase()

    const filtered = useMemo(() => {
        if (!query || query.length < 1) return []
        return products
            .filter((p) =>
                p.name.toLowerCase().includes(query) ||
                (p.sku && p.sku.toLowerCase().includes(query))
            )
            .slice(0, 8)
    }, [products, query])

    const showDropdown = isFocused && !justSelected && filtered.length > 0

    const handleSelect = useCallback((product: Product) => {
        setJustSelected(true)
        onChange(product.name)
        onSelectProduct(product)
    }, [onChange, onSelectProduct])

    useEffect(() => {
        if (justSelected) {
            const timeout = setTimeout(() => setJustSelected(false), 200)
            return () => clearTimeout(timeout)
        }
    }, [justSelected])

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsFocused(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    return (
        <div ref={containerRef} className={cn('relative w-full', className)}>
            <div className="relative">
                <Input
                    value={value}
                    onChange={(e) => {
                        setJustSelected(false)
                        onChange(e.target.value)
                    }}
                    onFocus={() => setIsFocused(true)}
                    placeholder={placeholder}
                    disabled={disabled}
                    className={cn(
                        'flex-1 pr-20',
                        hasSelection && 'border-green-500/50 bg-green-50/30 dark:bg-green-950/10'
                    )}
                />
                {hasSelection && (
                    <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[11px] font-medium text-green-600 dark:text-green-400">
                            <Check className="h-3 w-3" />
                            Linked
                        </span>
                    </div>
                )}
            </div>
            {showDropdown ? (
                <div className="absolute left-0 right-0 top-full z-[100] mt-1 max-h-56 overflow-y-auto rounded-xl border bg-popover shadow-lg">
                    {filtered.map((product) => (
                        <button
                            key={product.id}
                            type="button"
                            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus:bg-accent focus:outline-none"
                            onMouseDown={(e) => {
                                e.preventDefault()
                                handleSelect(product)
                            }}
                        >
                            <ProductThumbnail url={product.imageUrl} name={product.name} />
                            <div className="min-w-0 flex-1">
                                <div className="truncate font-medium">{product.name}</div>
                                {product.sku ? (
                                    <div className="truncate text-xs text-muted-foreground">SKU: {product.sku}</div>
                                ) : null}
                            </div>
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    )
}
