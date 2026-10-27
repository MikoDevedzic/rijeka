// Privacy Notice — single source for /privacy and privacy.html.
export const PRIVACY_META = { title: 'Privacy Notice', updated: '27 October 2026', version: '1.0' }
export const PRIVACY = [
  { h: 'Controller', p: [ 'Rijeka LLC is the controller of personal data processed through app.rijeka.app and rijeka.app. Contact: miko@rijeka.app.' ]},
  { h: 'What we collect', p: [
    'Account data: your email address, a handle derived from it, and the role on your account.',
    'What you enter: legal entities, counterparties, trades, curves and other market data, messages in rooms, and any wallet address you register for signing.',
    'Technical data: IP address, browser type and request logs, collected by our hosting providers in the ordinary course of serving the site.',
    'If you link a room to Telegram: the Telegram group identifier and title. We do not read the group\'s conversation.',
    'If you file an issue or a validation finding: whatever you post on GitHub, which is governed by GitHub\'s terms.' ]},
  { h: 'Why we process it and on what basis', p: [
    'To provide the service you asked for (performance of a contract): accounts, your workspace, rooms, confirmations.',
    'To keep the service secure and working (legitimate interest): logs, abuse prevention, debugging.',
    'To answer you when you write to us (legitimate interest).',
    'We do not sell personal data and we do not use it for advertising.' ]},
  { h: 'Who processes it for us', p: [
    'Supabase (database, authentication, storage), Render (application hosting), Netlify (site hosting), Anthropic (the Prometheus assistant: the messages you send it and the trade data it needs to answer), Telegram (only if you link a room), and GitHub (only if you post there). These providers process data on our instructions, and some are in the United States; transfers rely on their standard contractual terms.' ]},
  { h: 'Public blockchains', p: [
    'When a trade is confirmed on chain, the hash of the trade record, the two signing addresses and the time are written to a public Ethereum network (the Sepolia test network in the demo). This is public and permanent and cannot be deleted by us or anyone. The trade terms themselves are never written on chain. A wallet address you register is pseudonymous but may be linkable to you by others.' ]},
  { h: 'Retention', p: [
    'Account and workspace data are kept while your account exists. The demo may be reset, in which case workspace data is deleted. Request logs are kept by providers for a limited period, typically 30 to 90 days. On-chain records are permanent by nature.' ]},
  { h: 'Your rights', p: [
    'Depending on where you live, you may have the right to access, correct, delete or export your data, to object to or restrict processing, and to complain to a supervisory authority. Email miko@rijeka.app and we will act within 30 days. Deleting your account removes your workspace; it cannot remove hashes already on a public chain.' ]},
  { h: 'Security', p: [
    'Accounts are authenticated by Supabase with signed tokens; data is encrypted in transit; each account\'s workspace is separated from others. This is a demonstration environment, and you should not enter data whose exposure would harm you or a third party.' ]},
  { h: 'Cookies', p: [
    'The application keeps your session in your browser\'s session storage and uses no advertising or tracking cookies. The landing site may use the hosting provider\'s basic analytics.' ]},
  { h: 'Children', p: [ 'The service is not directed at anyone under 18 and we do not knowingly collect their data.' ]},
  { h: 'Changes', p: [ 'We will update this notice when our processing changes and show the new date and version at the top.' ]},
]
