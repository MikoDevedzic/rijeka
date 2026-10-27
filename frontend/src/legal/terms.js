// Terms of Service — single source for the app page (/terms) and the landing page (terms.html).
// Plain English on purpose. Bracketed items are for Rijeka LLC to fill in.
export const TERMS_META = { title: 'Terms of Service', updated: '27 October 2026', version: '1.0' }
export const TERMS = [
  { h: 'Who we are and what this is', p: [
    'Rijeka is operated by Rijeka LLC ("Rijeka", "we"). The hosted service at app.rijeka.app is a demonstration and learning environment for over-the-counter derivatives: booking, pricing, risk, XVA, margin and bilateral confirmation. The source code is published on GitHub under the licences stated there.',
    'By creating an account or using the service you agree to these terms and to the Privacy Notice. If you are using Rijeka on behalf of an organisation, you confirm you are authorised to bind it.' ]},
  { h: 'Eligibility', p: [
    'You must be at least 18 and use the service for professional, educational or research purposes. Keep your credentials to yourself; you are responsible for activity under your account.' ]},
  { h: 'A demonstration, not a production system', p: [
    'The hosted service is a demo. Data may be reset, features may change or be withdrawn, and availability is not guaranteed. Do not rely on it to run a business.',
    'Market data in the demo is a dated snapshot entered manually or taken from public sources, shown with its date on every screen. It is not live, may be stale, and is not suitable for trading or valuation decisions.' ]},
  { h: 'No advice, no venue, no counterparty', p: [
    'Nothing in Rijeka is investment, legal, tax or accounting advice, and no output is a recommendation to enter into any transaction. Rijeka LLC is not a broker, dealer, exchange, trading venue, clearing house or investment adviser, and is not a party to any trade you record.',
    'The demo counterparty ("RIJEKA DEMO BANK AG") is fictional and exists only so that you can exercise the workflow alone.' ]},
  { h: 'On-chain confirmations', p: [
    'Confirmations in the hosted demo are anchored to the Sepolia test network. A test-network record has no legal effect. Whether a confirmation between two real parties is contractually binding is a matter for the agreement between those parties, not for Rijeka.',
    'Anything written to a public blockchain is public and permanent. Rijeka writes only a hash of the trade record and the signing addresses, never the terms themselves, but you should assume those are visible to everyone forever. Where Rijeka holds a signing key for a demo entity, the attestation says so ("bilateral: false").' ]},
  { h: 'Your content', p: [
    'You keep ownership of what you enter: trades, entities, curves, messages. You grant Rijeka the right to store and process it to run the service and to show it to the people you share it with (for example the other members of a room).',
    'Do not enter information you are not entitled to share, including confidential client data or licensed market data you may not redistribute. Account data is separated from other accounts, but this is a demo environment and you should treat it accordingly.' ]},
  { h: 'The assistant', p: [
    'Prometheus is an AI assistant. It can read your book and the rooms it is invited to; it cannot change anything. Its answers can be wrong. Messages to it, and the trade data it needs to answer, are processed by Anthropic as our service provider.' ]},
  { h: 'Acceptable use', p: [
    'Do not attempt to access other accounts or data, probe or overload the service, misrepresent your identity or organisation, or use the service to break any law or any third party\'s licence. We may suspend accounts that do.' ]},
  { h: 'Fees', p: [
    'The hosted demo is free. Paid services (dedicated coverage, pilots, self-hosting support, commercial licences) are provided only under a separate written agreement.' ]},
  { h: 'Intellectual property and open source', p: [
    'The Rijeka name and logo belong to Rijeka LLC. The software is licensed as stated in the repository: Apache-2.0 for the pricing engine and the confirmation standard, Business Source License 1.1 for the platform. Those licences, not these terms, govern your use of the code.' ]},
  { h: 'Warranty disclaimer', p: [
    'The service is provided "as is" and "as available", without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, accuracy and non-infringement. Numbers can be wrong; the methodology document lists known limitations.' ]},
  { h: 'Limitation of liability', p: [
    'To the fullest extent permitted by law, Rijeka LLC and its members, officers and contributors are not liable for any indirect, incidental, special, consequential or punitive damages, or for lost profits, lost data or trading losses, arising from the service. Our total liability for any claim relating to the service is limited to USD 100. Some jurisdictions do not allow these limits; where they do not, the limits apply to the extent permitted.' ]},
  { h: 'Termination', p: [
    'You can stop using the service at any time and ask us to delete your account (see the Privacy Notice). We may suspend or end the demo, or your access to it, at any time. Records already written to a public blockchain cannot be removed by anyone.' ]},
  { h: 'Changes', p: [
    'We may update these terms. The date and version at the top will change, and material changes will be announced in the application. Continued use after a change is acceptance.' ]},
  { h: 'Governing law', p: [
    'These terms are governed by the laws of [State of formation of Rijeka LLC], United States, without regard to conflict-of-law rules, and disputes are subject to the courts there.' ]},
  { h: 'Contact', p: [ 'Rijeka LLC · miko@rijeka.app' ]},
]
