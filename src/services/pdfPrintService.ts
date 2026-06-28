interface PrintPdfBlobOptions {
    title?: string
}

export async function printPdfBlob(pdfBlob: Blob, { title = 'Receipt' }: PrintPdfBlobOptions = {}) {
    const pdfUrl = URL.createObjectURL(pdfBlob)
    const iframe = document.createElement('iframe')

    iframe.title = title
    iframe.src = pdfUrl
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    iframe.style.opacity = '0'

    document.body.appendChild(iframe)

    await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
            reject(new Error('Timed out while loading the receipt PDF for printing.'))
        }, 10_000)

        iframe.onload = () => {
            window.clearTimeout(timeout)

            try {
                iframe.contentWindow?.focus()
                iframe.contentWindow?.print()
                resolve()
            } catch (error) {
                reject(error)
            }
        }
    })

    window.setTimeout(() => {
        iframe.remove()
        URL.revokeObjectURL(pdfUrl)
    }, 60_000)
}
