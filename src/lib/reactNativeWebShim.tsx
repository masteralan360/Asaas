import type { CSSProperties, ImgHTMLAttributes } from 'react'

type NativeImageSource = {
    uri?: string
}

type NativeStyle = CSSProperties | Array<CSSProperties | false | null | undefined> | false | null | undefined

function flattenNativeStyle(style: NativeStyle): CSSProperties {
    if (!style) {
        return {}
    }

    if (Array.isArray(style)) {
        return style.reduce<CSSProperties>((merged, item) => ({
            ...merged,
            ...flattenNativeStyle(item)
        }), {})
    }

    return style
}

type NativeImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'style'> & {
    source?: NativeImageSource
    style?: NativeStyle
}

export function Image({ source, style, ...props }: NativeImageProps) {
    return (
        <img
            alt=""
            {...props}
            src={source?.uri}
            style={{ display: 'block', ...flattenNativeStyle(style) }}
        />
    )
}
