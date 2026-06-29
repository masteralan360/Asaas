const STORAGE_KEY = 'prioritized_payment_method'

export function getPrioritizedPaymentMethod(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function setPrioritizedPaymentMethod(method: string | null): void {
  try {
    if (method) {
      localStorage.setItem(STORAGE_KEY, method)
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // silence quota / private-browsing errors
  }
}
