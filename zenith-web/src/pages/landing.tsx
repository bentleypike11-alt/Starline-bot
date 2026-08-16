import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  ShieldCheck,
  Settings2,
  Activity,
  Users,
  ChevronRight,
  ArrowRight,
  Star
} from "lucide-react";

// =========================================================
// CHANGE YOUR SUPPORT SERVER LINK HERE
// =========================================================
const SUPPORT_SERVER_URL = "https://discord.gg/UmDQqXPCfF";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">

      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">

          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-xl"
              style={{
                background: "linear-gradient(135deg,#d4af37,#ffd700)"
              }}
            >
              Z
            </div>

            <span
              className="font-bold text-xl tracking-tight"
              style={{ color: "#d4af37" }}
            >
              StarLine
            </span>
          </div>

          <div className="flex items-center gap-6">

            <Link
              href="/tos"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Terms
            </Link>

            <a
              href={SUPPORT_SERVER_URL}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Support
            </a>

            <Link
              href="/privacy"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Privacy
            </Link>

            <Link
              href="/login"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Log in
            </Link>

            <Link href="/servers">
              <Button className="font-semibold shadow-sm">
                Try the demo
              </Button>
            </Link>

          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-4">
        <div className="max-w-4xl mx-auto text-center">

          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-muted border border-border text-sm font-medium text-muted-foreground mb-8 cursor-help group">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />

            V2 Now Available

            <span className="hidden group-hover:inline ml-2 text-xs text-muted-foreground">
              (no actual bugs were harmed)
            </span>
          </div>

          <h1 className="text-5xl md:text-7xl font-extrabold text-foreground tracking-tight leading-[1.1] mb-6">
            The command center for <br />
            <span className="text-primary">
              serious ERLC servers.
            </span>
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
            StarLine is the professional, no-nonsense hub that every serious
            staff team needs. Manage applications, strikes, activity, and
            ranks from a single precise dashboard.
          </p>

          <div className="flex items-center justify-center gap-4">

            <Link href="/servers">
              <Button
                size="lg"
                className="h-12 px-8 text-base font-semibold shadow-md hover:shadow-lg transition-all"
              >
                Get Started
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </Link>

            <a
              href="https://discord.com/oauth2/authorize?client_id=1501773810368643172"
              target="_blank"
              rel="noreferrer"
            >
              <Button
                size="lg"
                variant="outline"
                className="h-12 px-8 text-base font-semibold"
              >
                Add to Discord
              </Button>
            </a>

          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-24 bg-muted/30 border-y border-border">
        <div className="max-w-6xl mx-auto px-4">

          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-foreground">
              Everything you need to run a server.
            </h2>

            <p className="text-muted-foreground mt-2">
              Built for efficiency. Designed for professionals.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">

            {[
              {
                icon: <Users className="w-6 h-6 text-primary" />,
                title: "Staff Management",
                desc: "Track every staff member's history, strikes, and activity in one unified roster."
              },
              {
                icon: <Activity className="w-6 h-6 text-primary" />,
                title: "Activity Tracking",
                desc: "Automated leaderboards and activity logging so you always know who's putting in the work."
              },
              {
                icon: <Settings2 className="w-6 h-6 text-primary" />,
                title: "Deep Configuration",
                desc: "Customize every aspect of your bot. From channels and roles to strike thresholds."
              },
              {
                icon: <ShieldCheck className="w-6 h-6 text-primary" />,
                title: "Application Pipeline",
                desc: "Review, accept, and deny staff applications with custom questionnaires."
              }
            ].map((f, i) => (
              <div
                key={i}
                className="bg-card p-8 rounded-2xl border border-card-border shadow-sm hover:shadow-md transition-shadow"
              >

                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
                  {f.icon}
                </div>

                <h3 className="text-xl font-bold text-card-foreground mb-2">
                  {f.title}
                </h3>

                <p className="text-muted-foreground leading-relaxed">
                  {f.desc}
                </p>

              </div>
            ))}

          </div>
        </div>
      </section>

      {/* Pricing / Premium */}
      <section className="py-24 px-4">
        <div className="max-w-5xl mx-auto">

          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-foreground">
              Choose your tier
            </h2>

            <p className="text-muted-foreground mt-2">
              Start for free, upgrade when you need more power.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">

            {/* Free */}
            <div className="bg-card p-8 rounded-3xl border border-border shadow-sm">

              <h3 className="text-2xl font-bold text-card-foreground">
                Standard
              </h3>

              <p className="text-muted-foreground mt-2 min-h-12">
                Perfect for growing communities starting to organize.
              </p>

              <div className="text-4xl font-extrabold text-foreground my-6">
                Free
              </div>

              <ul className="space-y-4 mb-8">

                {[
                  "Basic staff roster",
                  "Standard application system",
                  "Strike tracking",
                  "Basic configuration"
                ].map(f => (
                  <li
                    key={f}
                    className="flex items-center text-muted-foreground"
                  >
                    <ChevronRight className="w-5 h-5 text-muted-foreground mr-2" />
                    {f}
                  </li>
                ))}

              </ul>

              <Button
                variant="outline"
                className="w-full h-12 text-base font-semibold"
              >
                Start for free
              </Button>

            </div>

            {/* Premium */}
            <div className="bg-card p-8 rounded-3xl border-2 border-premium shadow-md relative overflow-hidden">

              <div className="absolute top-4 right-4 flex items-center bg-premium/10 text-premium-foreground px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
                <Star className="w-3 h-3 mr-1 fill-current" />
                StarLine Pro
              </div>

              <h3 className="text-2xl font-bold text-card-foreground">
                Premium
              </h3>

              <p className="text-muted-foreground mt-2 min-h-12">
                Advanced features for established roleplay servers.
              </p>

              <div className="text-4xl font-extrabold text-foreground my-6">
                500{" "}
                <span className="text-lg font-medium text-muted-foreground">
                  R$ / mo
                </span>
              </div>

              <ul className="space-y-4 mb-8">

                {[
                  "Custom bot branding",
                  "Advanced activity analytics",
                  "Multi-server syncing",
                  "Priority support",
                  "Unlimited applications"
                ].map(f => (
                  <li
                    key={f}
                    className="flex items-center text-foreground font-medium"
                  >
                    <Star className="w-5 h-5 text-premium mr-2 fill-premium" />
                    {f}
                  </li>
                ))}

              </ul>

              <Button
                className="w-full h-12 text-base font-semibold bg-premium hover:bg-premium/90 text-white border-0"
              >
                Get Premium
              </Button>

            </div>

          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-background py-12">

        <div className="max-w-6xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-4">

          <div className="flex items-center gap-2">

            <div
              className="w-6 h-6 rounded flex items-center justify-center text-white font-bold text-xs"
              style={{
                background: "linear-gradient(135deg,#d4af37,#ffd700)"
              }}
            >
              Z
            </div>

            <span className="font-semibold text-foreground">
              StarLine
            </span>

          </div>

          <div className="flex items-center gap-5 flex-wrap justify-center">

            <a
              href="https://discord.com/oauth2/authorize?client_id=1501773810368643172"
              target="_blank"
              rel="noreferrer"
              className="text-sm font-semibold hover:underline"
              style={{ color: "#d4af37" }}
            >
              Add to Discord
            </a>

            {/* SUPPORT SERVER LINK */}
            <a
              href={SUPPORT_SERVER_URL}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Support Server
            </a>

            <Link
              href="/tos"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Terms
            </Link>

            <Link
              href="/privacy"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Privacy
            </Link>

          </div>

          <div className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} StarLine. Not affiliated with
            Discord or ERLC.
          </div>

        </div>

      </footer>
    </div>
  );
}
