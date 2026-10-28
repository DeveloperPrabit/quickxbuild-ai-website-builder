import { ContactSection } from '@/components/agency/LeadForm'
import { Eyebrow, Reveal } from '@/components/agency/Shared'
import { Plus } from 'lucide-react'

const questions = [
  ['What happens after I get in touch?', 'The form prepares an enquiry for your email app. Once you send it, we can arrange an introductory conversation to understand your goals, answer questions, and agree on a useful next step. There is no obligation to proceed.'],
  ['Do I need a detailed project brief?', 'Not at all. Tell us what you want to achieve, what is getting in the way, and any timelines you have in mind. We can help turn an early idea into a clear scope.'],
  ['How much will my project cost?', 'Every project has different requirements. After discovery, we provide a proposal covering scope, deliverables, pricing, and assumptions before any work begins.'],
  ['Can you work with our existing systems?', 'Yes. We start by reviewing your current tools and technical constraints. Where practical, we integrate with what already works rather than replacing it unnecessarily.'],
  ['Do you support projects after launch?', 'We can agree on a support and improvement plan that fits your needs, including maintenance, monitoring, and future features. The responsibilities and service terms are defined in your proposal.'],
]
export default function Contact() {
  return <><ContactSection standalone /><section className="section faq-section"><div className="container contact-grid"><Reveal><Eyebrow>A LITTLE CLARITY, BEFORE WE TALK</Eyebrow><h2>Good questions.<br /><span className="muted-heading">Straight answers.</span></h2><p className="section-copy">Something else on your mind?<br />We’re always happy to talk it through.</p></Reveal><div className="faq-list">{questions.map(([question, answer]) => <details key={question}><summary>{question}<Plus size={18} /></summary><p>{answer}</p></details>)}</div></div></section></>
}
