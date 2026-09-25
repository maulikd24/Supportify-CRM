import Link from "next/link";

export const metadata = { title: "Privacy Policy — Supportify" };

const EFFECTIVE_DATE = "September 7, 2026";

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <Link href="/" className="text-sm text-muted-foreground underline underline-offset-4">
        ← Back to Supportify
      </Link>

      <h1 className="mt-6 text-2xl font-semibold">Privacy Policy</h1>
      <p className="mt-1 text-sm text-muted-foreground">Effective {EFFECTIVE_DATE}</p>

      <div className="mt-8 flex flex-col gap-6 text-sm leading-relaxed text-foreground">
        <p>
          This Privacy Policy explains what information Supportify collects when you use QA Sentinel and CRM
          (together, the &quot;Service&quot;), and how we use, share, and protect it.
        </p>

        <section>
          <h2 className="mb-2 text-base font-medium">1. Information we collect</h2>
          <ul className="list-disc pl-5">
            <li>
              <span className="font-medium">Account information:</span> name, work email, password (stored as a
              salted hash, never in plain text), and organization details you provide at signup.
            </li>
            <li>
              <span className="font-medium">Customer Data:</span> the client records, tickets, messages, and other
              content you or your team add to the Service, including support ticket conversations imported from
              Zendesk for QA Sentinel to review.
            </li>
            <li>
              <span className="font-medium">Billing information:</span> handled directly by Stripe — we store a
              reference to your Stripe customer and subscription, never your full card number.
            </li>
            <li>
              <span className="font-medium">Usage data:</span> log-in activity, feature usage, and audit-log entries
              recorded for security and to operate the Service.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium">2. How we use it</h2>
          <p>
            We use this information to provide the Service (including generating AI ticket reviews), secure your
            account (including two-factor authentication and audit logging), process payments, send transactional
            email (verification, password reset, receipts), and respond to support requests. We do not sell your
            data.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium">3. Third-party processors</h2>
          <p>We share data with the following processors, only as needed to provide the Service:</p>
          <ul className="mt-2 list-disc pl-5">
            <li>
              <span className="font-medium">Anthropic</span> — ticket conversation content is sent to Anthropic&apos;s
              Claude API to generate QA Sentinel&apos;s AI reviews and scores.
            </li>
            <li>
              <span className="font-medium">Stripe</span> — payment processing and subscription management.
            </li>
            <li>
              <span className="font-medium">Resend</span> — delivery of transactional email.
            </li>
            <li>
              <span className="font-medium">Zendesk</span> (when you connect it) — we read ticket conversations you
              authorize us to access, using credentials you provide, encrypted at rest.
            </li>
            <li>
              <span className="font-medium">WorkOS</span> (only if your organization enables Single Sign-On) —
              handles authentication with your identity provider.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium">4. Data security</h2>
          <p>
            Passwords are hashed, never stored in plain text. Sensitive credentials (Zendesk tokens, webhook signing
            secrets, two-factor authentication secrets) are encrypted at rest with AES-256-GCM. Access to another
            organization&apos;s data is not possible through the Service — every record is scoped to your
            organization.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium">5. Data retention and deletion</h2>
          <p>
            We retain Customer Data for as long as your organization has an active account. You can export your
            organization&apos;s data at any time from Settings, and request deletion of your organization and its
            data, which we will act on within a reasonable time, except where we&apos;re required to retain records
            by law (for example, billing records).
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium">6. Your choices</h2>
          <p>
            You can update your account information, enable two-factor authentication, and export or delete your
            data from the Service&apos;s Settings pages at any time.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium">7. Changes to this policy</h2>
          <p>
            We may update this policy from time to time. If we make material changes, we&apos;ll notify you by
            email or in-app before they take effect.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium">8. Contact</h2>
          <p>Questions about this policy can be sent to privacy@supportify.co.in.</p>
        </section>
      </div>
    </div>
  );
}
