import type { Metadata } from 'next';

import { LegalPageLayout } from '@/components/legal/LegalPageLayout';

export const metadata: Metadata = {
  title: 'Terms of Service — CVPilot',
  description:
    'The terms that govern your use of CVPilot, including accounts, subscriptions, AI-generated content, and acceptable use.',
};

const LAST_UPDATED = '4 September 2026';

export default function TermsPage() {
  return (
    <LegalPageLayout title="Terms of Service" lastUpdated={LAST_UPDATED}>
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of CVPilot (the
        &ldquo;Service&rdquo;). By creating an account or using CVPilot, you agree to these Terms.
        If you do not agree, please do not use the Service.
      </p>

      <section>
        <h2>1. The Service</h2>
        <p>
          CVPilot lets you build or upload a CV, receive an AI-generated match score and suggestions
          against a job description you provide, generate an AI-tailored version of your CV, and
          generate an AI-written cover letter. Some features are available on a Free plan with
          monthly usage limits; paid plans (currently Pro and a Student plan) offer higher or
          unlimited usage, as described on our pricing page at the time you subscribe.
        </p>
      </section>

      <section>
        <h2>2. Accounts</h2>
        <p>
          You need an account, created and authenticated through our authentication provider, Clerk,
          to use most of CVPilot. You are responsible for maintaining the security of your account
          and for all activity that occurs under it. You must provide accurate information when
          creating your account and keep it up to date.
        </p>
      </section>

      <section>
        <h2>3. Your content</h2>
        <p>
          You retain ownership of the CV content, job descriptions, and other material you upload or
          enter into CVPilot (&ldquo;Your Content&rdquo;). You are solely responsible for Your
          Content, including its accuracy and your right to submit it. You grant us a limited
          licence to store, process, and transmit Your Content solely as needed to operate and
          provide the Service to you — including sending relevant parts of it to the AI providers
          described in our Privacy Policy to generate analyses, tailored CVs, and cover letters. We
          do not claim ownership of Your Content.
        </p>
      </section>

      <section>
        <h2>4. AI-generated content and no outcome guarantees</h2>
        <p>
          Match scores, suggestions, tailored CV content, and cover letters produced by CVPilot are
          generated using third-party AI models and are provided as a drafting aid. They may contain
          errors, omissions, or inaccuracies, and you should review and edit any AI-generated
          content before relying on or sending it. CVPilot does not guarantee the accuracy,
          completeness, or suitability of AI-generated content for any particular purpose, employer,
          or applicant tracking system (ATS).
        </p>
        <p>
          CVPilot does not guarantee that using the Service will result in interviews, job offers,
          or any other employment outcome. Any match score is an automated estimate only and is not
          a certification of how any specific employer or system will evaluate your CV.
        </p>
      </section>

      <section>
        <h2>5. Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>
            Use the Service to upload or generate unlawful, fraudulent, or misleading content,
            including CVs that misrepresent your identity or qualifications.
          </li>
          <li>
            Attempt to gain unauthorised access to CVPilot systems, other users&rsquo; accounts, or
            data.
          </li>
          <li>
            Interfere with or disrupt the Service, including by circumventing usage limits or rate
            limits.
          </li>
          <li>
            Use the Service to upload content that infringes the rights of others or contains
            malicious code.
          </li>
          <li>Use the Service in a way that violates applicable law.</li>
        </ul>
        <p>We may suspend or terminate access for accounts that violate these Terms.</p>
      </section>

      <section>
        <h2>6. Subscriptions and billing</h2>
        <p>
          Paid plans are billed on a recurring subscription basis through our payment processor,
          Stripe. By subscribing, you authorise us (via Stripe) to charge your payment method on a
          recurring basis until you cancel. Prices and included usage limits are shown at the time
          of purchase and may change for future billing periods with notice.
        </p>
        <p>
          You can manage or cancel your subscription at any time through the billing portal
          available in your account. If you cancel, your paid plan remains active — including any
          plan usage limits and features — until the end of your current billing period, after which
          your account moves to the Free plan. We do not currently offer prorated refunds for
          partial billing periods, except where required by law.
        </p>
      </section>

      <section>
        <h2>7. Plan limits</h2>
        <p>
          The Free plan and paid plans each include specific monthly or total usage limits (for
          example, on the number of AI analyses, cover letters, or CVs you can create), as described
          on our pricing page. We may adjust these limits from time to time; material reductions to
          a plan you are already subscribed to will be communicated where reasonably practicable.
        </p>
      </section>

      <section>
        <h2>8. Intellectual property</h2>
        <p>
          CVPilot, its underlying software, design, and branding are owned by us or our licensors
          and are protected by intellectual property laws. Except for the limited right to use the
          Service as intended, these Terms do not grant you any rights to our intellectual property.
          &ldquo;CVPilot&rdquo; and associated branding may not be used without our permission.
        </p>
      </section>

      <section>
        <h2>9. Service availability and changes</h2>
        <p>
          We aim to keep CVPilot available and reliable, but we do not guarantee uninterrupted or
          error-free operation. We may update, modify, or discontinue features of the Service from
          time to time. We will try to give reasonable notice of changes that materially reduce
          functionality you are actively using.
        </p>
      </section>

      <section>
        <h2>10. Account termination and deletion</h2>
        <p>
          You may delete your account at any time; see our Privacy Policy for what happens to your
          data when you do. We may suspend or terminate your account if you materially breach these
          Terms, misuse the Service, or where required by law. If we terminate your account for
          cause, any active subscription will also be cancelled.
        </p>
      </section>

      <section>
        <h2>11. Disclaimers</h2>
        <p>
          The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without
          warranties of any kind, whether express or implied, including implied warranties of
          merchantability, fitness for a particular purpose, or non-infringement, to the fullest
          extent permitted by applicable law. We do not warrant that AI-generated output will be
          accurate, complete, or appropriate for your circumstances.
        </p>
      </section>

      <section>
        <h2>12. Limitation of liability</h2>
        <p>
          To the fullest extent permitted by applicable law, CVPilot and its operators will not be
          liable for any indirect, incidental, special, consequential, or punitive damages, or any
          loss of profits, opportunities, or data, arising from your use of the Service. Our total
          liability for any claim relating to the Service is limited to the amount you paid us for
          the Service in the twelve months before the claim arose, or a reasonable minimal amount if
          you used only the Free plan. Nothing in these Terms limits liability that cannot lawfully
          be limited or excluded.
        </p>
      </section>

      {/*
        No registered legal entity, registered address, or governing
        jurisdiction exists anywhere in this repository/config. Rather than
        invent one, this section is deliberately written without naming a
        specific governing law or court. It MUST be replaced with a real
        governing-law and exclusive-jurisdiction clause (naming the actual
        registered entity, its jurisdiction, and the applicable courts)
        before these Terms are relied on for full commercial launch — see
        the equivalent note in privacy/page.tsx for the entity-name gap.
      */}
      <section>
        <h2>13. Governing law</h2>
        <p>
          These Terms are intended to be governed by the law generally applicable to the operation
          of the Service, without regard to conflict-of-law principles. CVPilot has not yet
          designated a specific governing law or forum for disputes. Until a specific governing-law
          and jurisdiction clause is adopted, we will work with you in good faith to resolve any
          dispute directly, and this section will be updated to name the applicable law and courts
          once CVPilot&rsquo;s corporate structure is finalised.
        </p>
      </section>

      <section>
        <h2>14. Changes to these Terms</h2>
        <p>
          We may update these Terms from time to time as the Service evolves. If we make material
          changes, we will update the &ldquo;Last updated&rdquo; date above. Continuing to use the
          Service after an update means you accept the revised Terms.
        </p>
      </section>

      <section>
        <h2>15. Contact us</h2>
        <p>
          Questions about these Terms can be sent via our <a href="/contact">contact form</a>.
        </p>
      </section>
    </LegalPageLayout>
  );
}
