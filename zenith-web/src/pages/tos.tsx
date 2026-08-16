import { Link } from "wouter";

export default function TOSPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-3xl mx-auto px-4">
        <Link href="/" className="inline-flex items-center gap-2 mb-8 hover:opacity-80 transition-opacity">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-white font-bold text-sm">Z</div>
          <span className="font-bold text-gray-900">StarLine</span>
        </Link>
        
        <div className="bg-white rounded-3xl border border-gray-200 p-8 md:p-12 shadow-sm prose prose-gray max-w-none">
          <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight mb-2">Terms of Service</h1>
          <p className="text-gray-500 text-sm mb-8">Last updated: {new Date().toLocaleDateString()}</p>
          
          <h3>1. Acceptance of Terms</h3>
          <p>By inviting the StarLine bot to your Discord server or logging into the StarLine dashboard, you agree to be bound by these Terms of Service. If you disagree with any part of the terms, you may not use our service.</p>
          
          <h3>2. Description of Service</h3>
          <p>StarLine provides management and moderation tools for Emergency Response: Liberty County (ERLC) Discord servers. This includes staff rosters, application handling, strike tracking, and activity monitoring.</p>
          
          <h3>3. Acceptable Use</h3>
          <p>You agree not to use the service to:</p>
          <ul>
            <li>Violate Discord's Terms of Service or Community Guidelines</li>
            <li>Store sensitive personal information (passwords, addresses, etc.)</li>
            <li>Harass, abuse, or harm other users</li>
            <li>Attempt to bypass rate limits, access controls, or premium restrictions</li>
          </ul>
          
          <h3>4. Premium Subscriptions</h3>
          <p>Premium features are provided on a subscription basis. Payments are final and non-refundable unless required by law. We reserve the right to modify pricing with prior notice.</p>
          
          <h3>5. Data Ownership</h3>
          <p>You retain ownership of the content you submit (applications, logs, server data). By using StarLine, you grant us a license to store and process this data solely for the purpose of providing the service.</p>
          
          <h3>6. Termination</h3>
          <p>We reserve the right to suspend or terminate your access to StarLine at any time, with or without cause or notice, immediately.</p>
        </div>
      </div>
    </div>
  );
}
