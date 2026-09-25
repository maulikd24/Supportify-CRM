import Link from "next/link";

export const metadata = { title: "Terms of Service — Supportify" };

const EFFECTIVE_DATE = "September 7, 2026";

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <Link href="/" className="text-sm text-muted-foreground underline underline-offset-4">
        ← Back to Supportify
      </Link>

      <h1 className="mt-6 text-2xl font-semibold">Terms of Service</h1>
      <p className="mt-1 text-sm text-muted-foreground">Effective {EFFECTIVE_DATE}</p>

      <div className="mt-8 flex flex-col gap-6 text-sm leading-relaxed text-foreground">
        <p>
          These Terms of Service (&quot;Terms&quot;) govern access to and use of Supportify&apos;s products,
          including QA Sentinel and CRM (together, the &quot;Service&quot;), provided by Supportify
          (&quot;Supportify,&quot; &quot;we,&quot; &quot;us&quot;). By creating an account or using the Service, you
          agree to these Terms on behalf of yourself and the organization you represent (&quot;you&quot;).
        </p>

        <section>
          <h2 className="mb-2 text-base font-medium">1. Accounts</h2>
          <p>
            You must provide accurate information when creating an account and are responsible for activity under
            your account and for keeping your credentials secure. You&apos;re responsible for the conduct of any
            team members you invite into your organization.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium">2. Subscriptions and billing</h2>
          <p>
            Paid plans are billed in advance on a recurring basis through our payment processor, Stripe. Fees are
            non-refundable except where required by law. You can cancel a subscription at any time from Billing;
            cancellation takes effect at the end of the current billing period. We may change our prices with
            advance notice before your next renewal.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium">3. Acceptable use</h2>
          <p>
            You agree not to use the Service to violate any law, infringe anyone&apos;s rights, transmit malicious
            code, attempt to gain unauthorized access to any part of the Service, or interfere with its normal
            operation. We may suspend or terminate accounts that violate this section.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium">4. Your data</h2>
          <p>
            You retain ownership of the data you submit to the Service (&quot;Customer Data&quot;), including client
            records, support tickets, and their contents. We process Customer Data only to provide and improve the
            Service, as described in our{" "}
            <Link href="/privacy" className="underline underline-offset-4">
              Privacy Policy
            </Link>
            . You can export your data at any time from Settings, and request deletion of your organization&apos;s
            data.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium">5. Third-party services</h2>
          <p>
            Parts of the Service rely on third-party providers to function — for example, Anthropic to generate AI
            ticket reviews, and Stripe to process payments. Your use of features backed by a third-party provider is
            also subject to that provider processing the relevant data as described in our Privacy Policy.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium">6. Disclaimers and limitation of liability</h2>
          <p>
            The Service, including AI-generated ticket reviews and scores, is provided &quot;as is.&quot; AI outputs
            may be inaccurate or incomplete and should be used as a supporting tool, not a substitute for human
            judgment. To the maximum extent permitted by law, Supportify is not liable for indirect, incidental, or
            consequential damages, and our total liability for any claim is limited to the fees you paid us in the
            12 months before the claim arose.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium">7. Termination</h2>
          <p>
            Either party may terminate this agreement at any time; you can delete your organization from Settings.
            We may suspend or terminate access for a material breach of these Terms, including non-payment.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium">8. Changes to these Terms</h2>
          <p>
            We may update these Terms from time to time. If we make material changes, we&apos;ll notify you by
            email or in-app before they take effect.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium">9. Contact</h2>
          <p>Questions about these Terms can be sent to legal@supportify.co.in.</p>
        </section>
      </div>
    </div>
  );
}
