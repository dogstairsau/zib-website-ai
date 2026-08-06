# Referral email banner

The banner that goes at the foot of client emails (and in HubSpot marketing
emails / email signatures), linking to `/submit-a-referral`.

Modelled on the Entourage banner Michael liked — headline, one line of copy
naming the services, one button — rebuilt in Zib's black/orange rather than
their green.

## The link

```
https://zibdigital.com.au/submit-a-referral?utm_source=email-banner&utm_medium=email&utm_campaign=client-referrals
```

Keep those three params on every placement so the referral page's hidden
fields can record where each intro came from. Vary `utm_source` per placement
so they're separable in reporting:

| Placement | `utm_source` |
|---|---|
| Marketing email footer | `email-banner` |
| Personal email signature | `email-signature` |
| Monthly client report | `client-report` |
| Invoice / statement email | `invoice-email` |

## HubSpot marketing emails

Drag in a **Custom HTML** module (or Rich text → source view) and paste the
block below. It's table-based with inline styles — no `<style>` block, no
flexbox, no web fonts — so it survives Outlook, Gmail and Apple Mail.

```html
<!-- Zib Digital · referral banner -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
  <tr>
    <td align="center" style="padding:0;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:600px;max-width:100%;background-color:#0F0F0F;border-radius:16px;">
        <tr>
          <td style="padding:34px 36px 36px 36px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
            <p style="margin:0 0 14px 0;font-size:11px;line-height:1.2;letter-spacing:0.14em;text-transform:uppercase;color:#FF6200;font-weight:600;">Client referrals</p>
            <p style="margin:0 0 14px 0;font-size:28px;line-height:1.15;letter-spacing:-0.02em;color:#FFFFFF;font-weight:600;">Our best clients come from you.</p>
            <p style="margin:0 0 26px 0;font-size:15px;line-height:1.55;color:#C9C9C9;">If you know a business that needs <strong style="color:#FFFFFF;font-weight:600;">SEO</strong>, <strong style="color:#FFFFFF;font-weight:600;">Google Ads</strong>, <strong style="color:#FFFFFF;font-weight:600;">social</strong> or a <strong style="color:#FFFFFF;font-weight:600;">better website</strong>, introduce them below. We'll look after them, and we'll tell you how it went.</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              <tr>
                <td align="center" bgcolor="#FF6200" style="border-radius:999px;">
                  <a href="https://zibdigital.com.au/submit-a-referral?utm_source=email-banner&amp;utm_medium=email&amp;utm_campaign=client-referrals"
                     style="display:inline-block;padding:15px 34px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#FFFFFF;text-decoration:none;border-radius:999px;">Submit a referral</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
```

### Notes

- `border-radius` is ignored by older Outlook, which renders square corners.
  That's fine — everything stays legible. Don't swap the button for an image
  to force the pill shape; images get blocked and the CTA disappears.
- The `&amp;` entities in the `href` are correct, not a typo. Written as bare
  `&` some editors mangle the second and third UTM params.
- Width is fixed at 600px with `max-width:100%`, which is what mobile clients
  actually honour.

## Light variant

For emails on a white background where a black block is too heavy, change:

- outer cell `background-color:#0F0F0F` → `#FAFAF8`, and add
  `border:1px solid #E8E5DD`
- headline colour `#FFFFFF` → `#000000`
- body colour `#C9C9C9` → `#3A3A3A`, and the `<strong>` colour → `#000000`

Leave the eyebrow and button orange.

## If they want an image version instead

Some signature tools only take images. Export at **1200 × 400px** (displayed
at 600 × 200), and:

- Put the whole message in the alt text — images are blocked by default in
  Outlook, so alt text is what most recipients read first:
  `"Our best clients come from you — submit a referral"`.
- Wrap the image in the same link, with the same UTM params.
- Keep the button visually inside the image, but remember it isn't clickable
  on its own — the whole image must be the link.

An HTML banner is better wherever it's an option: it renders with images off,
it's readable by screen readers, and the text isn't fixed-resolution.
