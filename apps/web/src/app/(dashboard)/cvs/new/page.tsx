'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';

import { createCv, updateCvContent } from '@/lib/cvApi';
import type { CvContent } from '@cvpilot/shared';

const EXAMPLE_CONTENT: CvContent = {
  version: 1,
  personalDetails: {
    fullName: 'Alex Johnson',
    email: 'alex.johnson@university.ac.uk',
    phone: '+44 7700 900000',
    location: 'London, UK',
    jobTitle: 'Computer Science Graduate',
  },
  summary:
    'Motivated Computer Science graduate with experience in full-stack web development, seeking a software engineering role in a fast-paced technology company.',
  workExperience: [
    {
      id: 'we-1',
      company: 'Tech Startup Ltd',
      title: 'Software Engineering Intern',
      location: 'London, UK',
      startDate: '2024-06',
      endDate: '2024-09',
      current: false,
      bullets: [
        'Built REST APIs using Node.js and TypeScript, serving 10,000+ daily active users',
        'Reduced page load time by 40% through frontend optimisation and lazy loading',
        'Collaborated with a team of 5 engineers using Agile methodology',
      ],
    },
  ],
  education: [
    {
      id: 'edu-1',
      institution: 'University of London',
      degree: 'BSc Computer Science',
      field: 'Computer Science',
      location: 'London, UK',
      startDate: '2021-09',
      endDate: '2024-06',
      grade: '2:1 (Upper Second Class)',
    },
  ],
  skills: [
    { id: 'sk-1', name: 'TypeScript' },
    { id: 'sk-2', name: 'React' },
    { id: 'sk-3', name: 'Node.js' },
    { id: 'sk-4', name: 'Python' },
    { id: 'sk-5', name: 'SQL' },
  ],
  languages: [{ id: 'lang-1', name: 'English', level: 'Native' }],
  certifications: [],
  sectionOrder: ['summary', 'workExperience', 'education', 'skills', 'languages'],
};

export default function NewCvPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState<'scratch' | 'example' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleScratch() {
    setLoading('scratch');
    setError(null);
    try {
      const token = await getToken();
      const cv = await createCv(token!, 'Untitled CV');
      router.push(`/cvs/${cv.id}/edit`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setLoading(null);
    }
  }

  async function handleExample() {
    setLoading('example');
    setError(null);
    try {
      const token = await getToken();
      const cv = await createCv(token!, 'Example CV');
      await updateCvContent(token!, cv.id, EXAMPLE_CONTENT);
      router.push(`/cvs/${cv.id}/edit`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setLoading(null);
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="mb-8">
        <Link href="/cvs" className="text-sm text-indigo-600 hover:underline">
          ← My CVs
        </Link>
        <h1 className="mt-4 text-2xl font-bold text-gray-900">Create a CV</h1>
        <p className="mt-1 text-sm text-gray-500">Choose how you want to get started.</p>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <button
          onClick={handleScratch}
          disabled={loading !== null}
          className="flex flex-col gap-3 rounded-xl border-2 border-gray-200 p-6 text-left transition hover:border-indigo-500 hover:shadow-sm disabled:opacity-50"
        >
          <span className="text-2xl">✍️</span>
          <span className="font-semibold text-gray-900">Start from scratch</span>
          <span className="text-sm text-gray-500">Build your CV section by section.</span>
          {loading === 'scratch' && <span className="text-xs text-indigo-600">Creating…</span>}
        </button>

        <Link
          href="/analyze"
          className="flex flex-col gap-3 rounded-xl border-2 border-gray-200 p-6 text-left transition hover:border-indigo-500 hover:shadow-sm"
        >
          <span className="text-2xl">📄</span>
          <span className="font-semibold text-gray-900">Upload a CV</span>
          <span className="text-sm text-gray-500">
            Upload a PDF or Word file and let us parse it for you.
          </span>
        </Link>

        <button
          onClick={handleExample}
          disabled={loading !== null}
          className="flex flex-col gap-3 rounded-xl border-2 border-gray-200 p-6 text-left transition hover:border-indigo-500 hover:shadow-sm disabled:opacity-50"
        >
          <span className="text-2xl">💡</span>
          <span className="font-semibold text-gray-900">Use an example</span>
          <span className="text-sm text-gray-500">
            See the builder in action with a prefilled example CV.
          </span>
          {loading === 'example' && <span className="text-xs text-indigo-600">Creating…</span>}
        </button>
      </div>
    </main>
  );
}
