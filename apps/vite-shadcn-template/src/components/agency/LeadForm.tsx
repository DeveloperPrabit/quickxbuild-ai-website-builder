import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowUpRight, Check, Mail, Clock3, Globe2, Loader2, Download, Phone } from 'lucide-react'
import { Eyebrow, Reveal } from './Shared'

export const projectTypes = ['Web design & development', 'Mobile app development', 'AI & business automation', 'SEO & digital growth', 'Shara AI demo', 'Something else']

export function LeadForm() {
  const [params] = useSearchParams()
  const initialService = params.get('service') || ''
  const [state, setState] = useState<'idle' | 'preparing' | 'ready'>('idle')
  const [brief, setBrief] = useState('')
  const [subject, setSubject] = useState('')
  const [error, setError] = useState('')
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    if (!form.reportValidity()) return
    setState('preparing')
    setError('')
    const data = new FormData(form)
    const text = `Hello Techspire team,\n\nI'd like to discuss a project.\n\nName: ${data.get('name')}\nEmail: ${data.get('email')}\nPhone: ${data.get('phone') || 'Not provided'}\nCompany: ${data.get('company') || 'Not provided'}\nProject: ${data.get('service')}\n\n${data.get('details')}\n\nLooking forward to connecting!`
    const title = `Project enquiry — ${data.get('service')} — ${data.get('name')}`
    try {
      setBrief(text)
      setSubject(title)
      await new Promise(resolve => setTimeout(resolve, 400))
      setState('ready')
    } catch {
      setError('We couldn’t prepare your enquiry. Please try again or email us directly.')
      setState('idle')
    }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([brief], { type: 'text/plain' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'techspire-project-brief.txt'
    link.click()
    URL.revokeObjectURL(url)
  }
  if (state === 'ready') return <div className="lead-form form-success" role="status"><span className="success-icon"><Check size={28} /></span><div className="eyebrow">ONE MORE STEP</div><h3>Your next chapter is ready.</h3><p>We’ve prepared your project enquiry. Open it in your email app and press send to start the conversation.</p><p className="form-note">Nothing has been sent yet. You can also download your brief and send it to hello@techspire.global.</p><a className="action action-primary" href={`mailto:hello@techspire.global?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(brief)}`}>Open email & send enquiry <ArrowUpRight size={17} /></a><button className="text-button" onClick={download}><Download size={16} /> Download project brief</button><button className="text-button" onClick={() => setState('idle')}>Start another enquiry <ArrowUpRight size={14} /></button></div>
  return <form className="lead-form" onSubmit={submit}><div className="form-heading"><h3>Tell us what you’re thinking.</h3><span>Let’s make it happen.</span></div><div className="form-grid"><label>Full name <span>*</span><input name="name" autoComplete="name" placeholder="Alex Morgan" required maxLength={100} /></label><label>Work email <span>*</span><input type="email" name="email" autoComplete="email" placeholder="alex@company.com" required maxLength={200} /></label><label>Phone number<input type="tel" name="phone" autoComplete="tel" placeholder="+61" maxLength={30} /></label><label>Company<input name="company" autoComplete="organization" placeholder="Your company" maxLength={100} /></label><label className="full-width">What can we help you with? <span>*</span><select name="service" required defaultValue={projectTypes.includes(initialService) ? initialService : ''}><option value="" disabled>Select a service</option>{projectTypes.map(type => <option key={type}>{type}</option>)}</select></label><label className="full-width">A little about your project <span>*</span><textarea name="details" placeholder="Your idea, your goals, your big what-if…" required minLength={15} maxLength={3000} rows={4} /></label></div><label className="consent"><input type="checkbox" required /><span>I agree to the <Link to="/privacy">privacy policy</Link> and to being contacted about my enquiry.</span></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="action action-primary form-submit" disabled={state === 'preparing'} type="submit">{state === 'preparing' ? <>Preparing your enquiry <Loader2 size={17} className="spin" /></> : <>Let’s build something great <ArrowUpRight size={17} /></>}</button><p className="form-note">No pressure. No obligation. Just a good conversation.<br />We’ll prepare your enquiry to send with your email app.</p></form>
}

export function ContactSection({ standalone = false }: { standalone?: boolean }) {
  return <section id="contact" className={`section contact-section ${standalone ? 'contact-standalone' : ''}`}><div className="container contact-grid"><Reveal><Eyebrow>LET’S BUILD WHAT’S NEXT</Eyebrow>{standalone ? <h1>Big ideas start<br />with a <span className="muted-heading">hello.</span></h1> : <h2>Have a vision?<br />Let’s make it <span className="muted-heading">real.</span></h2>}<p className="section-copy">Whether you’re starting from scratch or ready for your next chapter, we’re here to help you move forward.</p><div className="contact-details"><a href="mailto:hello@techspire.global"><Mail size={19} /><span><small>DROP US A LINE</small>hello@techspire.global</span><ArrowUpRight size={17} /></a><div><Clock3 size={19} /><span><small>WHEN WE’RE AROUND</small>Monday–Friday, 9am–5pm AEST</span></div><div><Globe2 size={19} /><span><small>BASED IN AUSTRALIA. BUILT FOR EVERYWHERE.</small>Local understanding. Global perspective.</span></div><div><Phone size={19} /><span><small>PREFER A CALL?</small>Leave your number and request a callback.</span></div></div><div className="contact-footnote"><span className="status-dot" />Open to ambitious projects.<p>Business registration and contracting details are supplied with every proposal.</p></div></Reveal><Reveal delay={.1}><LeadForm /></Reveal></div></section>
}
