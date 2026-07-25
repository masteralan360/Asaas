import { getBarcodeLabelPricePerUnit, getCode128BBarWidths, getCode128BModuleCount, formatBarcodeLabelPrice, type BarcodeLabelData } from '@/lib/barcodeLabel'

type BarcodeLabelTemplateProps = {
    labels: BarcodeLabelData[]
    showPrice?: boolean
}

function BarcodeGraphic({ value }: { value: string }) {
    const widths = getCode128BBarWidths(value)
    const moduleCount = getCode128BModuleCount(value)
    let cursor = 0

    return (
        <svg
            viewBox={`0 0 ${moduleCount} 100`}
            preserveAspectRatio="none"
            aria-label={`Barcode ${value}`}
            className="h-full w-full"
            role="img"
        >
            {widths.map((width, index) => {
                const x = cursor
                cursor += width
                return index % 2 === 0
                    ? <rect key={`${index}-${x}`} x={x} y="0" width={width} height="100" fill="black" />
                    : null
            })}
        </svg>
    )
}

export function BarcodeLabelTemplate({ labels, showPrice = true }: BarcodeLabelTemplateProps) {
    return (
        <div className="flex w-[35mm] flex-col gap-[3mm] bg-transparent text-black">
            {labels.map((label) => {
                const pricePerUnitLabel = getBarcodeLabelPricePerUnit(label.unit)

                return (
                    <section
                        key={label.id}
                        className="box-border flex h-[15mm] w-[35mm] shrink-0 flex-col overflow-hidden rounded-[0.7mm] border border-neutral-300 bg-white px-[1.4mm] py-[0.7mm] shadow-sm"
                        data-barcode-label
                    >
                        {showPrice ? (
                            <div className="shrink-0 leading-none">
                                <div className="text-[1.7mm] font-medium">Price</div>
                                <div className={pricePerUnitLabel ? 'mt-[0.25mm] text-[2.35mm] font-bold tracking-tight' : 'mt-[0.25mm] text-[2.7mm] font-bold tracking-tight'}>
                                    {formatBarcodeLabelPrice(label.price, label.currency, label.iqdDisplayPreference, label.unit)}
                                </div>
                            </div>
                        ) : null}
                        <div className={showPrice ? 'mt-[0.55mm] h-[5.35mm]' : 'mt-[0.25mm] h-[8.15mm]'}>
                            <BarcodeGraphic value={label.barcode} />
                        </div>
                        <div className="mt-[0.35mm] shrink-0 text-center font-mono text-[1.65mm] font-bold leading-none tracking-[0.06em]">
                            {label.displayValue}
                        </div>
                    </section>
                )
            })}
        </div>
    )
}
