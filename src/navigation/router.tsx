import { useEffect, useSyncExternalStore } from 'react'
import type { AnchorHTMLAttributes } from 'react'

export const PAGES = [
  { path: '/', label: 'Home', title: 'BioScope — A biomedical signal journal' },
  { path: '/signal', label: 'Signal', title: 'Signal Studio — BioScope' },
  { path: '/adc', label: 'ADC', title: 'ADC Laboratory — BioScope' },
  { path: '/dac', label: 'DAC', title: 'DAC Laboratory — BioScope' },
  { path: '/comparison', label: 'Comparison', title: 'Resolution & Signal Comparison — BioScope' },
  { path: '/hardware', label: 'ESP32', title: 'ESP32 Connection — BioScope' },
] as const
export type PagePath = typeof PAGES[number]['path']
const eventName = 'bioscope:navigate'
const pathname = () => window.location.pathname.replace(/\/+$/, '') || '/'
function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener)
  window.addEventListener(eventName, listener)
  return () => { window.removeEventListener('popstate', listener); window.removeEventListener(eventName, listener) }
}
export function usePage() {
  const path = useSyncExternalStore(subscribe, pathname, () => '/')
  useEffect(() => {
    document.title = PAGES.find(page => page.path === path)?.title ?? 'Page not found — BioScope'
    if (!window.location.hash) window.scrollTo({ top: 0, behavior: 'instant' })
    document.getElementById('main-content')?.focus({ preventScroll: true })
  }, [path])
  return path
}
export function PageLink({ href, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a {...props} href={href} onClick={event => {
    onClick?.(event)
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target || props.download !== undefined) return
    const target = new URL(href, window.location.href)
    if (target.origin !== window.location.origin || target.hash || !PAGES.some(page => page.path === target.pathname)) return
    event.preventDefault()
    if (target.href === window.location.href) { window.scrollTo({ top: 0, behavior: 'instant' }); return }
    window.history.pushState(null, '', target.pathname + target.search)
    window.dispatchEvent(new Event(eventName))
  }} />
}
