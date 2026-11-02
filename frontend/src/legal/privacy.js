// Privacy Notice — single source for /privacy and privacy.html.
export const PRIVACY_META = { title: 'Privacy Notice', updated: '2 November 2026', version: '1.1' }
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
  { h: 'Usage measurement and error reports', p: [
    'Usage counts: when you open a page in the application, or start the sign-up form, the application sends a small message to our API saying which event it was and which route. The API records the event, the route, the day, the release of the application you were using, and a visitor identifier. That identifier is a one-way hash of your address, your browser type, the day and a secret held by the server; it changes every day, cannot be reversed, is never sent back to your browser, and is not connected to your account. Your address itself is not stored with the count. No cookie is set and nothing is written to your browser for this. The resulting counts of visitors, views and sign-ups are visible to the platform administrator only. The landing site does not send these messages.',
    'Content-Security-Policy reports: the site asks your browser to report, rather than block, anything that breaks its content security policy while we check the policy before enforcing it. If that happens, your browser posts a report to our API with the page, the directive and the blocked address, together with your browser type. These reports are kept in the memory of the running server only, at most the last 200, and are lost when it restarts; they contain no account identity and are visible to the platform administrator only.',
    'Error reports: if the application hits an error it did not expect, it posts a report to our API with the error text and stack, the page address and route, your browser type, the release and the time. Anything shaped like a sign-in token is removed before the report is kept; no session or account identifier is sent. Reports are kept in the memory of the running server only, at most the last 200, and are lost when it restarts. A summary of the last 24 hours (the error text, the route, how often) is shown on the system page to signed-in users; the public health endpoint carries only the number of reports.',
    'All three are processed on the basis of our legitimate interest in keeping the service working and secure, and none of them is used for advertising or shared with anyone.' ]},
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
