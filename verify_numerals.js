/**
 * Manual verification script for numeral conversion
 */
function convertArabicIndicToLatin(text) {
    if (!text) return text
    return text.replace(/[٠-٩۰-۹]/g, (d) => {
        const code = d.charCodeAt(0)
        if (code >= 0x0660 && code <= 0x0669) {
            return (code - 0x0660).toString()
        }
        if (code >= 0x06f0 && code <= 0x06f9) {
            return (code - 0x06f0).toString()
        }
        return d
    })
}

const tests = [
    { input: '٠١٢٣٤٥٦٧٨٩', expected: '0123456789' },
    { input: '۰۱۲۳۴۵۶۷۸۹', expected: '0123456789' },
    { input: '١٢٣-٤٥٦', expected: '123-456' },
    { input: 'Mixed ١٢٣ and 456', expected: 'Mixed 123 and 456' }
]

console.log('Running numeral conversion tests...')
let allPassed = true
tests.forEach(({ input, expected }, i) => {
    const result = convertArabicIndicToLatin(input)
    if (result === expected) {
        console.log(`Test ${i + 1} PASSED`)
    } else {
        console.log(`Test ${i + 1} FAILED: expected "${expected}", got "${result}"`)
        allPassed = false
    }
})

if (allPassed) {
    console.log('\nAll conversion logic tests passed!')
} else {
    process.exit(1)
}
