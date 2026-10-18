import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge conditional class names and resolve Tailwind conflicts.
 * Single entry point so every primitive composes classes the same way.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
