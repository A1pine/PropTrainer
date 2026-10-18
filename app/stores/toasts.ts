export type ToastVariant = 'default' | 'success' | 'danger' | 'warn' | 'info'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastInput {
  title: string
  description?: string
  variant?: ToastVariant
  duration?: number
  action?: ToastAction
}

export interface ToastItem extends ToastInput {
  id: number
  createdAt: number
}

let nextId = 1

export const useToastStore = defineStore('toasts', () => {
  const items = ref<ToastItem[]>([])
  const timers = new Map<number, ReturnType<typeof setTimeout>>()

  function dismiss(id: number) {
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.delete(id)
    items.value = items.value.filter((toast) => toast.id !== id)
  }

  function push(input: ToastInput): number {
    const toast: ToastItem = {
      id: nextId++,
      createdAt: Date.now(),
      variant: 'default',
      duration: 4000,
      ...input,
    }
    items.value = [...items.value.slice(-3), toast]
    if (toast.duration && toast.duration > 0) {
      timers.set(
        toast.id,
        setTimeout(() => dismiss(toast.id), toast.duration),
      )
    }
    return toast.id
  }

  function success(title: string, description?: string) {
    return push({ title, description, variant: 'success' })
  }

  function error(title: string, description?: string) {
    return push({ title, description, variant: 'danger', duration: 6000 })
  }

  return { items, push, dismiss, success, error }
})
