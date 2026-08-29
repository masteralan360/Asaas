export function formatCookOrderTicketTimestamp(locale: string, printedAt: Date) {
    const dateParts = new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: '2-digit',
    }).formatToParts(printedAt)
    const day = dateParts.find((part) => part.type === 'day')?.value
    const month = dateParts.find((part) => part.type === 'month')?.value
    const time = new Intl.DateTimeFormat(locale, {
        hour: 'numeric',
        minute: '2-digit',
    }).format(printedAt)

    return day && month ? `${day}/${month} ${time}` : time
}
