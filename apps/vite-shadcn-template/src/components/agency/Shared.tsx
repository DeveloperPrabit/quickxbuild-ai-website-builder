import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { ArrowUpRight, ArrowRight, Menu, X, Layers3, Github, Linkedin } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'

export function Brand() {
  return <Link to="/" className="brand" aria-label="Techspire Global home"><span className="brand-symbol"><Layers3 size={26} strokeWidth={1.7} /></span><span>techspire<span className="brand-global">GLOBAL</span></span></Link>
}

export function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduced = useReducedMotion()
  return <motion.div className={className} initial={reduced ? false : { opacity: 0, y: 22 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-35px' }} transition={{ duration: .55, delay }}>{children}</motion.div>
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow"><span />{children}</div>
}

export function Action({ to, children, secondary = false }: { to: string; children: ReactNode; secondary?: boolean }) {
  return <Link className={`action ${secondary ? 'action-secondary' : 'action-primary'}`} to={to}>{children}{secondary ? <ArrowRight size={16} /> : <ArrowUpRight size={17} />}</Link>
}

export function Layout() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  useEffect(() => {
    setOpen(false)
    if (location.hash) {
      const timer = setTimeout(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' }), 80)
      return () => clearTimeout(timer)
    }
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [location.pathname, location.hash])
  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [])
  useEffect(() => {
    document.title = `${location.pathname === '/about' ? 'About us' : location.pathname === '/contact' ? 'Let’s build something great' : location.pathname === '/privacy' ? 'Privacy' : 'Digital solutions, built for what’s next'} — Techspire Global`
  }, [location.pathname])
  return <div className="agency"><a className="skip-link" href="#main">Skip to content</a><header className="site-header"><div className="container nav-inner"><Brand /><nav className="desktop-nav" aria-label="Main navigation"><Link to="/#services">Services</Link><Link to="/#products">Products</Link><Link to="/#work">Case Studies</Link><NavLink to="/about">About</NavLink><NavLink to="/contact">Contact</NavLink></nav><Link to="/contact" className="nav-cta">Book a free consultation <ArrowUpRight size={16} /></Link><button className="mobile-toggle" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button></div>{open && <nav id="mobile-nav" className="mobile-nav" aria-label="Mobile navigation"><Link to="/#services" onClick={() => setOpen(false)}>Services</Link><Link to="/#products" onClick={() => setOpen(false)}>Products</Link><Link to="/#work" onClick={() => setOpen(false)}>Case Studies</Link><Link to="/about">About</Link><Link to="/contact">Contact</Link><Action to="/contact">Book a free consultation</Action></nav>}</header><main id="main"><Outlet /></main><Footer /></div>
}

function Footer() {
  return <footer className="site-footer"><div className="container"><div className="footer-grid"><div className="footer-brand"><Brand /><p>Thoughtful technology.<br />Extraordinary possibilities.</p><span className="location-label"><span className="status-dot" />Australia · Working globally</span></div><div><h3>Explore</h3><Link to="/">Home</Link><Link to="/about">About us</Link><Link to="/#work">Selected work</Link><Link to="/contact">Let’s talk</Link></div><div><h3>What we do</h3><Link to="/#services">Web development</Link><Link to="/#services">Mobile applications</Link><Link to="/#services">AI & automation</Link><Link to="/#services">Digital growth</Link></div><div><h3>Have something in mind?</h3><a className="footer-email" href="mailto:hello@techspire.global">hello@techspire.global <ArrowUpRight size={15} /></a><p>Good ideas deserve a conversation.</p><div className="social-links"><a href="https://www.linkedin.com/" target="_blank" rel="noreferrer" aria-label="Visit LinkedIn"><Linkedin size={17} /></a><a href="https://github.com/" target="_blank" rel="noreferrer" aria-label="Visit GitHub"><Github size={17} /></a><Link to="/contact" aria-label="Contact Techspire"><ArrowUpRight size={18} /></Link></div></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} Techspire Global. All rights reserved.</span><div><Link to="/privacy">Privacy policy</Link><span>Designed for what’s next.</span><a href="#main" aria-label="Back to top">↑</a></div></div></div></footer>
}
