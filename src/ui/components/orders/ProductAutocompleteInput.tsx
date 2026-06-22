import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Package } from 'lucide-react'

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
    disabled
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
            <Input
                value={value}
                onChange={(e) => {
                    setJustSelected(false)
                    onChange(e.target.value)
                }}
                onFocus={() => setIsFocused(true)}
                placeholder={placeholder}
                disabled={disabled}
                className="flex-1"
            />
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
