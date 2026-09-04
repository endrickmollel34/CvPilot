import type { Metadata } from 'next';

import { LegalPageLayout } from '@/components/legal/LegalPageLayout';

export const metadata: Metadata = {
  title: 'Privacy Policy — CVPilot',
  description:
    'How CVPilot collects, uses, stores, and protects your information, including uploaded CV content, account data, and payment information.',
};

const LAST_UPDATED = '4 September 2026';

export default function PrivacyPage() {
  return (
    <LegalPageLayout title="Privacy Policy" lastUpdated={LAST_UPDATED}>
      {/*
        No registered legal entity name is present anywhere in this
        repository/config — "CVPilot" (the product/operator name) is used
        throughout instead of a formal company name. Replace with the
        actual registered entity name, if one is incorporated, before full
        commercial launch. See also the governing-law note in
        terms/page.tsx, which has the same gap.
      */}
      <p>
        This Privacy Policy explains what information CVPilot (&ldquo;CVPilot&rdquo;,
        &ldquo;we&rdquo;, &ldquo;us&rdquo;) collects when you use our CV-building, CV analysis, and
        cover-letter tools (the &ldquo;Service&rdquo;), how we use it, and the choices you have. It
        applies to visitors and registered users of the Service.
      </p>

      <section>
        <h2>1. Information you provide to us</h2>
        <p>When you use CVPilot, you may provide us with:</p>
        <ul>
          <li>
            <strong>Account information</strong> — your email address and authentication details,
            collected and managed on our behalf by our authentication provider, Clerk, when you sign
            up or sign in.
          </li>
          <li>
            <strong>CV content</strong> — the personal and career information contained in any CV
            you upload (as a PDF or DOCX file) or build directly in CVPilot, which may include your
            name, contact details, work history, education, and other information you choose to
            include.
          </li>
          <li>
            <strong>Job descriptions and inputs you paste or type</strong> — for example, the job
            description text you provide when requesting a match analysis or a tailored cover
            letter.
          </li>
          <li>
            <strong>Payment information</strong> — if you subscribe to a paid plan, billing is
            handled by our payment processor, Stripe. CVPilot does not receive or store your full
            card number; Stripe processes payment details directly.
          </li>
          <li>
            <strong>Contact form submissions</strong> — if you use our{' '}
            <a href="/contact">contact form</a>, the name, email address, category, and message you
            provide. This is sent directly to us by email via our transactional email provider,
            Resend, and is not stored in our database. We use your email address only to reply to
            your enquiry.
          </li>
        </ul>
      </section>

      <section>
        <h2>2. Information collected automatically</h2>
        <p>
          Like most web services, our infrastructure and hosting providers (including our
          application hosts and content-delivery network) process standard technical information
          needed to deliver requests, such as IP address, browser/device information, and request
          timestamps. We also record usage information within the product itself — for example, how
          many analyses, cover letters, or CVs you have created — so we can enforce plan limits and
          show you your own usage.
        </p>
        <p>
          Authentication with CVPilot relies on session cookies/tokens set by Clerk, our
          authentication provider, which are required for you to stay signed in. We do not currently
          use separate analytics, advertising, or tracking cookies.
        </p>
      </section>

      <section>
        <h2>3. How we use your information</h2>
        <p>We use the information described above to:</p>
        <ul>
          <li>Provide, operate, and maintain the Service — including your account and your CVs.</li>
          <li>
            Generate AI-powered CV match scores, suggestions, tailored CV versions, and cover
            letters based on the CV content and job descriptions you provide.
          </li>
          <li>
            Process and extract text from CV files you upload, so that content can be used in the
            product.
          </li>
          <li>Process payments and manage subscriptions for paid plans.</li>
          <li>Enforce plan usage limits and provide customer support.</li>
          <li>Maintain the security, integrity, and reliability of the Service.</li>
        </ul>
      </section>

      <section>
        <h2>4. AI processing of your content</h2>
        <p>
          To generate match scores, suggestions, tailored CVs, and cover letters, CVPilot sends
          relevant parts of your CV content and any job description you supply to third-party AI
          providers — currently OpenAI, with Anthropic configured as a fallback provider used if the
          primary provider is unavailable. These providers process your content solely to generate
          the response returned to you within CVPilot; we do not separately publish or share this
          content with anyone else. We do not control, and this policy does not cover, these
          providers&rsquo; own data-handling practices beyond what is necessary to provide the
          Service — please refer to the respective provider for details of how they handle data
          submitted through their APIs.
        </p>
      </section>

      <section>
        <h2>5. Third-party service providers</h2>
        <p>
          We rely on a small number of specialist providers to operate CVPilot. We share the minimum
          information each provider needs to perform its function:
        </p>
        <ul>
          <li>
            <strong>Clerk</strong> — authentication and account/session management.
          </li>
          <li>
            <strong>Cloudflare (R2)</strong> — storage of uploaded CV files and generated document
            files.
          </li>
          <li>
            <strong>OpenAI</strong> and, as a fallback, <strong>Anthropic</strong> — AI processing
            of CV and job-description content, as described above.
          </li>
          <li>
            <strong>Stripe</strong> — payment processing and subscription billing.
          </li>
          <li>
            <strong>Resend</strong> — our transactional email infrastructure, used if we need to
            send you account or service-related email.
          </li>
          <li>
            Our application and database hosting providers, who store and run the Service and its
            underlying PostgreSQL database on our behalf.
          </li>
        </ul>
      </section>

      <section>
        <h2>6. Storage and security</h2>
        <p>
          Account and application data is stored in a hosted PostgreSQL database. Uploaded CV files
          and generated documents are stored in Cloudflare R2 object storage and are served only via
          short-lived, single-purpose access URLs rather than being made directly public. We take
          reasonable technical and organisational measures to protect your information, but no
          method of transmission or storage is completely secure, and we cannot guarantee absolute
          security.
        </p>
      </section>

      <section>
        <h2>7. Data retention</h2>
        <p>
          We retain your account and CV data for as long as your account remains active, so that the
          Service can function (for example, so you can return to a previous CV, analysis, or cover
          letter). We do not currently apply a fixed automatic retention or deletion schedule beyond
          what is described in the &ldquo;Account and data deletion&rdquo; section below. If this
          changes, we will update this policy.
        </p>
      </section>

      <section>
        <h2>8. Account and data deletion</h2>
        <p>
          You can request deletion of your CVPilot account at any time, including by deleting your
          account through our authentication provider, Clerk. When your account is deleted, we
          remove your CVs, analyses, cover letters, tailored CVs, and related account records from
          our database, and make a best-effort attempt to delete your stored files from Cloudflare
          R2. If you have an active paid subscription, we also attempt to cancel it with Stripe as
          part of account deletion. Some minimal billing records may be retained by our payment
          processor, Stripe, as required for their own accounting, tax, and fraud- prevention
          obligations, independent of CVPilot.
        </p>
      </section>

      <section>
        <h2>9. International data transfers</h2>
        <p>
          CVPilot and the third-party providers we rely on (described above) may process and store
          information in countries other than the one you are located in. Where this happens, we
          rely on the safeguards and mechanisms those providers make available for international
          data transfers. We do not make specific representations about particular transfer
          frameworks beyond what our providers themselves offer, and we encourage you to review
          their own documentation if this is important to you.
        </p>
      </section>

      <section>
        <h2>10. Your rights and choices</h2>
        <p>
          Depending on where you live, you may have rights to access, correct, export, or delete the
          personal information we hold about you. You can access and edit most of your CV and
          account content directly within the product, and you can delete your account as described
          above. For any other request relating to your personal information, contact us using the
          details below.
        </p>
      </section>

      <section>
        <h2>11. Children</h2>
        <p>
          CVPilot is intended for users who are old enough to enter into a binding agreement in
          their jurisdiction, and is not directed at children. We do not knowingly collect personal
          information from children. If you believe a child has provided us with personal
          information, please contact us and we will take appropriate steps to remove it.
        </p>
      </section>

      <section>
        <h2>12. Changes to this policy</h2>
        <p>
          We may update this Privacy Policy from time to time as the Service evolves. If we make
          material changes, we will update the &ldquo;Last updated&rdquo; date above. Continued use
          of the Service after an update means you accept the revised policy.
        </p>
      </section>

      <section>
        <h2>13. Contact us</h2>
        <p>
          If you have questions about this Privacy Policy, how your information is handled, or you
          want to make a data request (for example, to access, correct, or delete your personal
          information), contact us via our <a href="/contact">contact form</a>, selecting
          &ldquo;Privacy / data request&rdquo; as the category.
        </p>
      </section>
    </LegalPageLayout>
  );
}
