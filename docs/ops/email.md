# Sign-up email: why it fails and how to fix it

## What happens today

Supabase sends the confirmation, password-reset and resend emails from its
own shared sender. That sender is meant for development: a handful of
emails an hour per project, no custom domain, and messages that often land
in spam. A visitor who signs up and sees nothing arrive gives up quietly.
This is exactly what happened to the first outside sign-up on 2026-10-29,
who had to be confirmed by hand.

The app side is already in place: the sign-up page offers a resend, the
sign-in page offers a resend and a forgot-password flow, `/reset` sets a new
password and `https://app.rijeka.app/reset` is on the redirect allow-list.

## The fix: send from rijeka.app through a transactional provider

Any provider with an SMTP endpoint works. Resend and Postmark both have a
free tier that covers a demo many times over. Steps, about fifteen minutes:

1. **Create the provider account** and add the domain `rijeka.app`.
2. **Add the DNS records it gives you** at Namecheap (where rijeka.app is
   hosted): one DKIM TXT record, one SPF TXT record on the sending
   subdomain, and usually an MX record for bounces. Wait for the provider to
   show the domain as verified.
3. **Create an API key** at the provider. That key is the SMTP password.
4. **Supabase → Project Settings → Authentication → SMTP Settings**: enable
   custom SMTP and enter
   - sender email `desk@rijeka.app`, sender name `Rijeka`
   - host and port from the provider (Resend: `smtp.resend.com`, port 465;
     Postmark: `smtp.postmarkapp.com`, port 587)
   - username and password as the provider states (Resend: username
     `resend`, password the API key)
5. **Supabase → Authentication → Rate Limits**: raise the email limit from
   the development default to something like 60 an hour.
6. **Supabase → Authentication → URL Configuration**: set the Site URL to
   `https://app.rijeka.app` so links in the emails open the app rather than
   the landing page. `https://app.rijeka.app/reset` and `/confirm` stay on
   the redirect list.
7. **Send yourself a sign-up** from a fresh address and a password reset
   from an existing one. Both should arrive within a minute.

Keep "Confirm email" switched on once this works: it is what stops someone
signing up with an address they do not own.

## The quick alternative

Supabase → Authentication → Sign In / Providers → **Confirm email** off.
Sign-ups then land on the desk immediately with no email at all; the app
already handles that path. The trade-off is that an address is not proved,
which is acceptable for a demo with no customer data but should be reversed
when the provider above is in place.
