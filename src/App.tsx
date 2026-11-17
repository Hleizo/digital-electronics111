import { BioScopeProvider } from './context/BioScopeContext'
import { Header } from './components/Header'
import { PageLink, usePage } from './navigation/router'
import { HomePage } from './pages/HomePage'
import { AdcPage, ComparisonPage, DacPage, HardwarePage, SignalPage } from './pages/LaboratoryPages'
import './components/adc/adc.css'
import './components/dac/dac.css'

function Site() {
  const path = usePage()
  const page = path === '/' ? <HomePage /> : path === '/signal' ? <SignalPage /> : path === '/adc' ? <AdcPage /> : path === '/dac' ? <DacPage /> : path === '/comparison' ? <ComparisonPage /> : path === '/hardware' ? <HardwarePage /> : <section className="not-found"><span className="section-index">404 / FIELD NOTE NOT FOUND</span><h1>This page is outside<br />our field of view.</h1><PageLink href="/" className="text-link">Return to BioScope ↗</PageLink></section>
  return <div className="site-shell"><a href="#main-content" className="skip-link">Skip to content</a><Header path={path} /><main id="main-content" tabIndex={-1}>{page}</main><footer className="journal-footer"><PageLink href="/" className="footer-wordmark">BioScope.</PageLink><span>Biomedical signal laboratory<br />Approaches 11 & 12</span><span>Educational software.<br />Not a medical device.</span><a href="#main-content" className="quiet-link">Back to top ↑</a></footer></div>
}
export default function App() {
  return <BioScopeProvider><Site /></BioScopeProvider>
}
