import { Link } from "wouter";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-3xl mx-auto px-4">
        <Link href="/" className="inline-flex items-center gap-2 mb-8 hover:opacity-80 transition-opacity">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-white font-bold text-sm">Z</div>
          <span className="font-bold text-gray-900">StarLine</span>
        </Link>
        
        <div className="bg-white rounded-3xl border border-gray-200 p-8 md:p-12 shadow-sm prose prose-gray max-w-none">
          <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight mb-2">Privacy Policy</h1>
          <p className="text-gray-500 text-sm mb-8">Last updated: {new Date().toLocaleDateString()}</p>
          
          <h3>1. Information We Collect</h3>
          <p>We collect the minimum amount of data necessary to provide our services:</p>
          <ul>
            <li><strong>Discord Data:</strong> User IDs, Usernames, Avatars, Guild IDs, Guild Names, Roles, and Channel IDs.</li>
            <li><strong>User-Generated Content:</strong> Staff applications, strike reasons, LOA requests, and activity logs.</li>
            <li><strong>Usage Data:</strong> Basic analytics on dashboard usage to improve the service.</li>
          </ul>
          
          <h3>2. How We Use Your Information</h3>
          <p>The information we collect is used strictly to:</p>
          <ul>
            <li>Operate the StarLine bot and dashboard functionality</li>
            <li>Authenticate users via Discord OAuth2</li>
            <li>Provide customer support and troubleshooting</li>
            <li>Maintain service security and prevent abuse</li>
          </ul>
          
          <h3>3. Data Sharing and Disclosure</h3>
          <p>We do not sell, trade, or rent your personal identification information to others. We may share generic aggregated demographic information not linked to any personal identification.</p>
          
          <h3>4. Data Storage and Security</h3>
          <p>We adopt appropriate data collection, storage, and processing practices and security measures to protect against unauthorized access, alteration, disclosure, or destruction of your personal information and data stored on our site.</p>
          
          <h3>5. Your Rights (GDPR)</h3>
          <p>If you reside in the European Economic Area (EEA), you have the right to:</p>
          <ul>
            <li>Access the personal data we hold about you</li>
            <li>Request correction of incorrect data</li>
            <li>Request deletion of your data ("Right to be Forgotten")</li>
            <li>Object to processing of your data</li>
          </ul>
          <p>To exercise these rights, please kick the bot from your server, which will automatically schedule your server data for deletion, and contact us in our support server to delete your user account data.</p>
        </div>
      </div>
    </div>
  );
}
