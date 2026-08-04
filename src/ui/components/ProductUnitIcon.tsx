import { BottleWine, Box, Boxes, CircleDot, Cylinder, Droplets, Package, Ruler, Scale, ShoppingBag, SquareDashed, Weight } from 'lucide-react'

export function ProductUnitIcon({ unit }: { unit: string }) {
    const className = 'h-4 w-4 text-primary/70'

    switch (unit) {
        case 'pcs':
            return <CircleDot className={className} />
        case 'Kg':
            return <Weight className={className} />
        case 'gram':
            return <Scale className={className} />
        case 'liter':
            return <Droplets className={className} />
        case 'bottle':
            return <BottleWine className={className} />
        case 'can':
            return <Cylinder className={className} />
        case 'box':
            return <Box className={className} />
        case 'pack':
            return <Package className={className} />
        case 'carton':
            return <Boxes className={className} />
        case 'bag':
            return <ShoppingBag className={className} />
        case 'm²':
            return <SquareDashed className={className} />
        case 'Meter':
            return <Ruler className={className} />
        default:
            return <Ruler className={className} />
    }
}