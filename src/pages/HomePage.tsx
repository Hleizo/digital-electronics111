import { memo, useEffect, useRef, useState } from 'react'
import { PageLink } from '../navigation/router'
import { SignalFigure } from '../components/home/SignalFigure'

const chapters = [
  { label: 'Analog', title: 'Before the numbers.', text: 'A sensor begins with a voltage. Continuous in time, its changing shape carries the information we want to understand.', note: 'x(t) · a continuous-time signal', color: 'green' },
  { label: 'Sampling', title: 'A moment, measured.', text: 'Sampling takes a reading at a precise instant. The spacing between those instants determines how much of the signal’s detail we can observe.', note: 'fs = 100 samples/s · Δt = 0.01 s', color: 'green' },
  { label: 'Digital', title: 'A shape becomes a code.', text: 'The ADC assigns each captured voltage to a uniform bin. This four-bit illustration has 16 possible codes: a finite vocabulary for a continuous world.', note: 'Code = floor(Vin / Δ) · saturation at the limits', color: 'amber' },
  { label: 'Reconstruction', title: 'Back into the physical.', text: 'A DAC turns each code into a held voltage. An optional low-pass filter softens the steps, but cannot restore information lost in sampling or quantization.', note: 'Vout = Code × Vref / (2ᴺ − 1) · RC cutoff 4 Hz', color: 'purple' },
] as const

export const HomePage = memo(function HomePage() {
  const narrative = useRef<HTMLElement>(null)
  const progress = useRef(0)
  const [active, setActive] = useState(0)
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const sections = narrative.current?.querySelectorAll<HTMLElement>('.journal-chapter')
      if (!sections?.length) return
      const first = sections[0].getBoundingClientRect()
      const value = Math.max(0, Math.min(3, (window.innerHeight * .48 - first.top) / first.height))
      progress.current = value
      const chapter = Math.min(3, Math.floor(value + .22))
      setActive(previous => previous === chapter ? previous : chapter)
      narrative.current?.style.setProperty('--journey-progress', String(value / 3))
    }
    const scroll = () => { if (!frame) frame = requestAnimationFrame(update) }
    window.addEventListener('scroll', scroll, { passive: true }); window.addEventListener('resize', scroll); update()
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', scroll); window.removeEventListener('resize', scroll) }
  }, [])
  return <div className="home-page page-enter">
    <section className="journal-hero" aria-labelledby="hero-title">
      <div className="hero-copy"><div className="journal-kicker"><span>BIOSCOPE / FIELD NOTES</span><span>VOLUME 01</span></div>
        <h1 id="hero-title">Every signal<br />tells a <em>story.</em></h1>
        <p>Explore how biomedical signals become digital information — and how digital information becomes analog again.</p>
        <div className="hero-links"><PageLink href="/signal" className="text-link">Explore the laboratory <span aria-hidden="true">↗</span></PageLink><a href="#how-it-works" className="quiet-link">How it works <span aria-hidden="true">↓</span></a></div>
        <span className="hero-footnote">AN INTERACTIVE STUDY IN SIGNALS & SYSTEMS</span>
      </div>
      <div className="hero-graphic"><SignalFigure /><span className="figure-margin-note">CONTINUOUS BY NATURE.<br />DIGITAL BY DESIGN.</span></div>
    </section>
    <div className="journal-intro" id="how-it-works"><span className="section-index">THE READING GUIDE / 01—04</span><p>One signal.<br /><em>Four ways to see it.</em></p><span className="intro-aside">From a sensor’s first voltage<br />to a reconstructed waveform.</span></div>
    <section ref={narrative} className="signal-narrative" aria-label="From analog voltage to digital reconstruction" data-chapter={active}>
      <div className="journal-chapters">{chapters.map((chapter, index) => <article key={chapter.label} className={`journal-chapter accent-${chapter.color}${active === index ? ' journal-chapter--active' : ''}`}>
        <div className="chapter-meta"><span className="chapter-number">0{index + 1}</span><span className="chapter-label">{chapter.label}</span></div>
        <h2>{chapter.title}</h2><p>{chapter.text}</p><code>{chapter.note}</code>
        <span className="chapter-rule" aria-hidden="true" />
      </article>)}</div>
      <div className="narrative-visual"><div className="narrative-sticky"><div className="narrative-caption"><span>0{active + 1} / {chapters[active].label.toUpperCase()}</span><span>0–3.3 V EDUCATIONAL RANGE</span></div><SignalFigure journey progress={progress} /><div className="journey-track" aria-hidden="true"><span /></div><p className="narrative-note">One synthetic source, evaluated through BioScope’s signal, ADC and DAC models. Scroll to follow the transformation.</p></div></div>
    </section>
    <section className="journal-invitation"><span className="section-index">FROM READING TO EXPERIMENTING</span><h2>Now, change<br /><em>the story.</em></h2><div><p>Choose a signal. Change its resolution. See what survives the journey.</p><PageLink href="/signal" className="text-link">Open the signal studio <span aria-hidden="true">↗</span></PageLink></div></section>
  </div>
})
