import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Star, Zap, Shield, BarChart3, Headphones, Check, ArrowLeft, ExternalLink } from "lucide-react";

const SUPPORT_SERVER = "https://discord.gg/UmDQqXPCfF";

const FEATURES = [
  {
    icon: <BarChart3 className="w-6 h-6 text-yellow-500" />,
    title: "Advanced Analytics",
    desc: "Deep activity reports, trend analysis, and custom metrics for your entire staff team."
  },
  {
    icon: <Zap className="w-6 h-6 text-yellow-500" />,
    title: "Priority Bot Response",
    desc: "Your server gets priority processing for all slash commands and events."
  },
  {
    icon: <Shield className="w-6 h-6 text-yellow-500" />,
    title: "Advanced Automation",
    desc: "Auto-promotion, scheduled announcements, custom workflow triggers, and more."
  },
  {
    icon: <Headphones className="w-6 h-6 text-yellow-500" />,
    title: "Priority Support",
    desc: "Direct access to the StarLine support team with faster response times."
  },
];

const PLANS = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    color: "border-gray-200",
    badge: null,
    features: ["Staff roster (up to 25 members)", "Basic strike tracking", "LOA requests", "Standard applications", "Bot commands"],
    cta: "Current Plan",
    ctaVariant: "outline" as const,
    disabled: true,
    href: null,
  },
  {
    name: "Pro",
    price: "$9.99",
    period: "per month",
    color: "border-yellow-400 shadow-yellow-100 shadow-lg",
    badge: "Most Popular",
    features: [
      "Unlimited staff members",
      "Advanced analytics & reports",
      "Priority bot response",
      "Advanced automation",
      "Custom embed branding",
      "Priority support",
      "All future Pro features",
    ],
    cta: "Get Premium",
    ctaVariant: "default" as const,
    disabled: false,
    href: SUPPORT_SERVER,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "contact us",
    color: "border-gray-200",
    badge: null,
    features: [
      "Everything in Pro",
      "Dedicated bot instance",
      "Custom integrations",
      "SLA guarantee",
      "White-label options",
      "Onboarding support",
    ],
    cta: "Contact Us",
    ctaVariant: "outline" as const,
    disabled: false,
    href: SUPPORT_SERVER,
  },
];

export default function PremiumPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white font-bold text-xl">Z</div>
            <span className="font-bold text-xl tracking-tight text-gray-900">StarLine</span>
          </Link>
          <Link href="/servers">
            <Button variant="outline" size="sm" className="gap-2">
              <ArrowLeft className="w-4 h-4" /> Back to Dashboard
            </Button>
          </Link>
        </div>
      </nav>

      <div className="pt-24 pb-20 px-4">
        <div className="max-w-5xl mx-auto">
          {/* Hero */}
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-yellow-50 border border-yellow-200 text-yellow-700 text-sm font-semibold mb-6">
              <Star className="w-4 h-4 fill-current" /> StarLine Premium
            </div>
            <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 tracking-tight mb-4">
              Unlock the full power of <span className="text-yellow-500">StarLine Pro</span>
            </h1>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Everything your staff team needs to run at the highest level. No limits, no compromises.
            </p>
          </div>

          {/* Feature highlights */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-16">
            {FEATURES.map((f, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-12 h-12 rounded-xl bg-yellow-50 border border-yellow-100 flex items-center justify-center mb-4">
                  {f.icon}
                </div>
                <h3 className="font-bold text-gray-900 mb-1.5">{f.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>

          {/* Pricing */}
          <div className="grid md:grid-cols-3 gap-6">
            {PLANS.map((plan) => (
              <div key={plan.name} className={`bg-white border-2 rounded-2xl p-7 relative ${plan.color} ${plan.badge ? "ring-2 ring-yellow-300 ring-offset-2" : ""}`}>
                {plan.badge && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-yellow-500 text-white border-0 font-bold px-3 py-0.5 shadow-sm">
                    {plan.badge}
                  </Badge>
                )}
                <div className="mb-5">
                  <h3 className="font-extrabold text-gray-900 text-xl">{plan.name}</h3>
                  <div className="mt-2">
                    <span className="text-3xl font-extrabold text-gray-900">{plan.price}</span>
                    <span className="text-gray-400 text-sm ml-1">/{plan.period}</span>
                  </div>
                </div>
                <ul className="space-y-2.5 mb-7">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-gray-600">
                      <Check className={`w-4 h-4 flex-shrink-0 ${plan.badge ? "text-yellow-500" : "text-primary"}`} />
                      {f}
                    </li>
                  ))}
                </ul>
                {plan.href ? (
                  <a href={plan.href} target="_blank" rel="noreferrer" className="block">
                    <Button
                      variant={plan.ctaVariant}
                      className={`w-full font-bold gap-2 ${plan.badge ? "bg-yellow-500 hover:bg-yellow-600 text-white border-0 shadow-md" : ""}`}
                    >
                      {plan.cta} <ExternalLink className="w-3.5 h-3.5" />
                    </Button>
                  </a>
                ) : (
                  <Button
                    variant={plan.ctaVariant}
                    className="w-full font-bold"
                    disabled={plan.disabled}
                  >
                    {plan.cta}
                  </Button>
                )}
              </div>
            ))}
          </div>

          <p className="text-center text-sm text-gray-400 mt-8">
            Premium is applied per-server. Join our{" "}
            <a href={SUPPORT_SERVER} target="_blank" rel="noreferrer" className="text-primary font-medium hover:underline">
              Discord support server
            </a>{" "}
            to get started — a staff member will activate premium for your server.
          </p>
        </div>
      </div>
    </div>
  );
}
