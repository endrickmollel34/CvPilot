'use client';

import { useState } from 'react';
import { CONTACT_CATEGORIES, CONTACT_CATEGORY_LABELS, type ContactCategory } from '@cvpilot/shared';

import { submitContact } from '@/lib/contactApi';
import { getFriendlyErrorMessage } from '@/lib/errorMessage';

const inputClass =
  'mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 shadow-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900';

export function ContactForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [category, setCategory] = useState<ContactCategory>('general');
  const [message, setMessage] = useState('');
  // Honeypot — left permanently empty by real visitors, since the field is
  // hidden from sighted and screen-reader users alike (aria-hidden + tabIndex
  // -1, on top of the visual hiding). A bot's naive autofill is what fills
  // it. See SubmitContactDto.website and ContactService.submit.
  const [website, setWebsite] = useState('');

  const [status, setStatus] = useState<'idle' | 'submitting' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('submitting');
    setError('');
    try {
      await submitContact({ name, email, category, message, website });
      setStatus('sent');
      setName('');
      setEmail('');
      setCategory('general');
      setMessage('');
    } catch (err) {
      setStatus('error');
      setError(getFriendlyErrorMessage(err, 'Could not send your message. Please try again.'));
    }
  }

  if (status === 'sent') {
    return (
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-6 text-sm text-neutral-700">
        Thanks — your message has been sent. We&apos;ll get back to you as soon as we can.
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
      <div>
        <label htmlFor="contact-name" className="text-sm font-medium text-neutral-900">
          Name
        </label>
        <input
          id="contact-name"
          type="text"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="contact-email" className="text-sm font-medium text-neutral-900">
          Email
        </label>
        <input
          id="contact-email"
          type="email"
          required
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="contact-category" className="text-sm font-medium text-neutral-900">
          Category
        </label>
        <select
          id="contact-category"
          required
          value={category}
          onChange={(e) => setCategory(e.target.value as ContactCategory)}
          className={inputClass}
        >
          {CONTACT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CONTACT_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="contact-message" className="text-sm font-medium text-neutral-900">
          Message
        </label>
        <textarea
          id="contact-message"
          required
          minLength={10}
          maxLength={5000}
          rows={6}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className={inputClass}
        />
      </div>

      {/* Honeypot — hidden from real visitors via both CSS and accessibility
          attributes; never rendered as a visible/labelled field. */}
      <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-0 w-0 overflow-hidden">
        <label htmlFor="contact-website">Website</label>
        <input
          id="contact-website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      {status === 'error' && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={status === 'submitting'}
        className="rounded-md bg-neutral-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-60"
      >
        {status === 'submitting' ? 'Sending…' : 'Send message'}
      </button>
    </form>
  );
}
