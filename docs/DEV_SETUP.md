# Developer Setup

Local development workflows for Syntraro.

## Stripe Webhook (Development)

Portal payments record server-side via the Stripe webhook
(`POST /api/webhooks/stripe`). Stripe doesn't deliver to `localhost`
directly — the Stripe CLI forwards events from your test account to a
local URL. Without this running, a portal payment will succeed at
Stripe but the local app will never see the `payment_intent.succeeded`
event, so the invoice won't update, the payment won't appear in the
admin Payments list, and no receipt email will go out. The portal page's
30-second polling will time out and show a "still processing" message.

### One-time setup

Install the Stripe CLI:
<https://docs.stripe.com/stripe-cli>

Then authenticate the CLI with your Stripe account (opens a browser):

```bash
stripe login
```

### Each dev session

Open a second terminal alongside `npm run dev` and run:

```bash
npm run stripe:listen
```

This is a thin wrapper around:

```
stripe listen --forward-to localhost:5000/api/webhooks/stripe
```

When the command starts it prints a webhook signing secret like:

```
> Ready! You are using Stripe API Version [...]. Your webhook signing secret is whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx (^C to quit)
```

Add this to your `.env` file:

```
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Restart the dev server so the new env var loads (`tsx watch` reloads
the source on save but does not re-read `.env`):

```bash
# Ctrl-C the running `npm run dev`, then:
npm run dev
```

### Expected behaviour

After a successful card payment in the customer portal, within ~1–2
seconds:

- the invoice's status updates (e.g. `awaiting_payment` → `paid` /
  `partial_paid`)
- the payment row appears in the admin **Payments** list
- the receipt email goes out via Resend
- the portal's "Processing your payment…" panel flips to "Payment
  received. A receipt will be emailed to you shortly."

If the portal panel sits on "Processing your payment…" for the full
30-second window and then shows "Payment is still processing", the most
likely cause is that `stripe listen` isn't running OR
`STRIPE_WEBHOOK_SECRET` doesn't match the value the CLI printed.
