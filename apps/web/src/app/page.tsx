import { AtsVisual } from '@/components/landing/AtsVisual';
import { Faq } from '@/components/landing/Faq';
import { Features } from '@/components/landing/Features';
import { FinalCta } from '@/components/landing/FinalCta';
import { Hero } from '@/components/landing/Hero';
import { HowItWorks } from '@/components/landing/HowItWorks';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { LandingNav } from '@/components/landing/LandingNav';
import { PricingSection } from '@/components/landing/PricingSection';
import { ProductShowcase } from '@/components/landing/ProductShowcase';
import { TrustSection } from '@/components/landing/TrustSection';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#FCFCFD] text-neutral-900">
      <LandingNav />
      <main>
        <Hero />
        <TrustSection />
        <HowItWorks />
        <ProductShowcase />
        <Features />
        <AtsVisual />
        <PricingSection />
        <Faq />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  );
}
