import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  FileText,
  LockKeyhole,
  Sparkles,
  Layers3,
} from "lucide-react";
import { Brand } from "@/components/brand";
export default function Home() {
  return (
    <div className="landing">
      <nav className="landing-nav">
        <Brand />
        <div>
          <a href="#pricing">Pricing</a>
          <Link href="/login">
            Sign in <ArrowUpRight size={14} />
          </Link>
        </div>
      </nav>
      <main>
        <section className="hero">
          <div className="eyebrow">
            <span className="dot" /> A quieter place for your ideas
          </div>
          <h1>
            Less noise.
            <br />
            More <em>signal.</em>
          </h1>
          <p>
            Your notes hold good ideas. Bring them into focus with private
            workspaces and thoughtful summaries.
          </p>
          <Link className="button primary" href="/login?mode=signup">
            Find your focus <ArrowUpRight size={17} />
          </Link>
          <span className="hero-caption">Start free · No card required</span>
          <div className="hero-preview">
            <div className="preview-bar">
              <span />
              <span />
              <span />
              <small>YOUR NEXT GOOD IDEA</small>
            </div>
            <div className="preview-content">
              <div>
                <div className="tag">
                  <FileText size={13} /> TEAM NOTES
                </div>
                <h3>
                  A launch with a little
                  <br />
                  more clarity.
                </h3>
                <p>
                  The team is preparing for the November release. Onboarding,
                  accessibility, and billing are the priorities…
                </p>
              </div>
              <div className="preview-summary">
                <Sparkles size={20} />
                <h4>The important parts</h4>
                <p>
                  Launch on November 12.
                  <br />
                  <br />
                  Maya owns onboarding.
                  <br />
                  <br />
                  Review accessibility before release.
                </p>
              </div>
            </div>
          </div>
        </section>
        <section className="feature-strip">
          <article>
            <LockKeyhole size={22} />
            <h3>Yours, by design.</h3>
            <p>Your notes and summaries stay in your personal workspace.</p>
          </article>
          <article>
            <Sparkles size={22} />
            <h3>Clarity in a click.</h3>
            <p>Turn a long note into a few useful takeaways.</p>
          </article>
          <article>
            <Layers3 size={22} />
            <h3>Know where you stand.</h3>
            <p>Simple plans and a clear view of your monthly usage.</p>
          </article>
        </section>
        <section id="pricing" className="pricing">
          <div className="eyebrow">A LITTLE SPACE. OR A LOT.</div>
          <h2>Start with a thought.</h2>
          <p>Both plans include private notes and your summary history.</p>
          <div className="price-grid">
            {[
              {
                name: "Free",
                price: "$0",
                count: 5,
                text: "For a fresh perspective.",
              },
              {
                name: "Pro",
                price: "$12",
                count: 100,
                text: "For a mind full of ideas.",
              },
            ].map((plan) => (
              <article
                key={plan.name}
                className={`price-card ${plan.name === "Pro" ? "featured" : ""}`}
              >
                <span className="tag">
                  {plan.name}
                  {plan.name === "Pro" && " · TEST MODE"}
                </span>
                <h3>
                  {plan.price}
                  <small>/ month</small>
                </h3>
                <p>{plan.text}</p>
                <div className="price-feature">
                  <Check size={16} /> {plan.count} summaries / UTC month
                </div>
                <div className="price-feature">
                  <Check size={16} /> Private notes & usage history
                </div>
                <Link
                  className={`button ${plan.name === "Pro" ? "primary" : "secondary"}`}
                  href="/login?mode=signup"
                >
                  Get started <ArrowUpRight size={15} />
                </Link>
              </article>
            ))}
          </div>
          <small>
            Reference implementation. Stripe subscriptions use test mode; no
            real payments.
          </small>
        </section>
      </main>
      <footer>
        <Brand />
        <span>
          Built for clearer thinking. Reference implementation by Igor
          Fedchenko.
        </span>
      </footer>
    </div>
  );
}
