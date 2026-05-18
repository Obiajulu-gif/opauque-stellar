import { Link } from "react-router-dom";
import { Footer } from "./Footer";

type LegalPageLayoutProps = {
  title: string;
  children: React.ReactNode;
};

export function LegalPageLayout({ title, children }: LegalPageLayoutProps) {
  return (
    <div className="min-h-screen flex flex-col bg-ink-950 text-white">
      <div className="flex-1 max-w-2xl mx-auto w-full px-4 sm:px-6 py-12">
        <Link
          to="/app"
          className="inline-block text-slate-500 text-sm hover:text-slate-400 transition-colors mb-8"
        >
          ← Back
        </Link>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-white mb-8">
          {title}
        </h1>
        <div className="max-w-none text-neutral-300 text-sm leading-relaxed space-y-8">
          {children}
        </div>
      </div>
      <Footer />
    </div>
  );
}
