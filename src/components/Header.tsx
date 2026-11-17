import { useEffect, useRef, useState } from 'react'
import { useBioScope } from '../context/BioScopeContext'
import { PAGES, PageLink } from '../navigation/router'
import { Icon } from './Icon'

export function Header({ path }: { path: string }) {
  const { config, bluetooth } = useBioScope()
  const [hidden, setHidden] = useState(false)
  const [open, setOpen] = useState(false)
  const element = useRef<HTMLElement>(null)
  const menu = useRef<HTMLButtonElement>(null)
  useEffect(() => { setOpen(false); setHidden(false) }, [path])
  useEffect(() => {
    let last = window.scrollY, movement = 0, direction = 0, frame = 0
    const update = () => {
      frame = 0
      const y = Math.max(0, window.scrollY), delta = y - last
      last = y
      if (y < 64) { setHidden(false); movement = 0; return }
      const nextDirection = Math.sign(delta)
      if (nextDirection !== direction) movement = 0
      direction = nextDirection; movement += delta
      if (Math.abs(movement) >= 12) { setHidden(movement > 0); movement = 0 }
    }
    const scroll = () => { if (!frame) frame = requestAnimationFrame(update) }
    window.addEventListener('scroll', scroll, { passive: true })
    return () => { window.removeEventListener('scroll', scroll); cancelAnimationFrame(frame) }
  }, [])
  useEffect(() => {
    if (!open) return
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); menu.current?.focus() } }
    const outside = (event: PointerEvent) => { if (!element.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('keydown', key); document.addEventListener('pointerdown', outside)
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', outside) }
  }, [open])
  const connected = bluetooth.snapshot.status === 'connected'
  const label = config.mode === 'simulation' ? 'Simulation' : bluetooth.receiving ? 'ESP32 · receiving' : `ESP32 · ${bluetooth.snapshot.status}`
  return <div className="site-header-space"><header ref={element} className={`site-header${hidden && !open ? ' site-header--hidden' : ''}${open ? ' site-header--open' : ''}`} onFocusCapture={() => setHidden(false)}>
    <PageLink href="/" className="wordmark" aria-label="BioScope home" onClick={() => setOpen(false)}><Icon name="pulse" size={23} /><span>BioScope<span className="wordmark-period">.</span></span></PageLink>
    <nav id="site-navigation" className="site-nav" aria-label="Main navigation">{PAGES.map(page => <PageLink key={page.path} href={page.path} onClick={() => setOpen(false)} aria-current={page.path === path ? 'page' : undefined}>{page.label}</PageLink>)}</nav>
    <span className={`connection-note${connected ? ' connection-note--connected' : ''}`} role="status"><span aria-hidden="true" />{label}</span>
    <button ref={menu} type="button" className="menu-button" aria-expanded={open} aria-controls="site-navigation" onClick={() => { setHidden(false); setOpen(!open) }}><span>{open ? 'Close' : 'Menu'}</span><span className="menu-lines" aria-hidden="true" /></button>
  </header></div>
}
