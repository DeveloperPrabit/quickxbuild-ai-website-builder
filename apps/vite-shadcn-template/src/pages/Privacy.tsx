import { Link } from 'react-router-dom'

export default function Privacy() {
  return (
    <section className="container section" aria-labelledby="privacy-title">
      <span className="eyebrow">Your information matters</span>
      <h1 id="privacy-title">Privacy &amp; your data</h1>
      <p>Information you share when contacting our team or creating an account helps us respond to your requests and provide services.</p>
      <article style={{ maxWidth: 760, display: 'grid', gap: 24, marginTop: 32 }}>
        <section><h2>Information you share</h2><p>Enquiries may include your name, email, phone number, company and project requirements. Registration collects your name, email and password. Never include passwords, payment details or confidential client data in enquiries.</p></section>
        <section><h2>How information is used</h2><p>Contact details are used to respond to enquiries and discuss requested services. Account information is used to authenticate you and manage workspace access.</p></section>
        <section><h2>Sessions and providers</h2><p>Signing in uses a session cookie. Providers involved in hosting, communications or payments may process information necessary to deliver the features you use.</p></section>
        <section><h2>Retention and security</h2><p>Records are retained as needed to provide services and meet applicable obligations. No internet service can guarantee absolute security. Use a unique password and keep your credentials private.</p></section>
        <section><h2>Your choices</h2><p>Contact the team to request access, correction or deletion of information you have provided. Some records may need to be retained for legal or operational reasons.</p></section>
        <section><h2>Privacy questions</h2><p>Include the email associated with your enquiry or account when contacting us, but never your password.</p><Link className="action action-primary" to="/contact">Contact our team</Link></section>
      </article>
    </section>
  )
}
