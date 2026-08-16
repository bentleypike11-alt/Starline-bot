import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, AlertTriangle, Clock, Zap } from "lucide-react";

interface StatusData { api: string; database: string; bot: string; timestamp: string; }
interface ChangelogEntry { version: string; date: string; type: string; changes: string[]; }

function StatusDot({ status }: { status: string }) {
  const map: Record<string, { color: string; label: string }> = {
    operational: { color: 'bg-green-400', label: 'Operational' },
    degraded: { color: 'bg-yellow-400', label: 'Degraded' },
    not_configured: { color: 'bg-gray-300', label: 'Not Configured' },
    unknown: { color: 'bg-gray-300', label: 'Unknown' },
  };
  const s = map[status] || map.unknown;
  return (
    <span className="flex items-center gap-1.5 text-sm">
      <span className={`w-2.5 h-2.5 rounded-full ${s.color} ${status === 'operational' ? 'animate-pulse' : ''}`} />
      {s.label}
    </span>
  );
}

const TYPE_STYLES: Record<string, { badge: string; icon: JSX.Element }> = {
  major:   { badge: 'bg-purple-100 text-purple-700 border-purple-200', icon: <Zap size={12} /> },
  feature: { badge: 'bg-blue-100 text-blue-700 border-blue-200', icon: <CheckCircle size={12} /> },
  fix:     { badge: 'bg-green-100 text-green-700 border-green-200', icon: <AlertTriangle size={12} /> },
  patch:   { badge: 'bg-gray-100 text-gray-600 border-gray-200', icon: <Clock size={12} /> },
};

export default function StatusPage() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [changelog, setChangelog] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/status').then(r => r.ok ? r.json() : null),
      fetch('/api/changelog').then(r => r.ok ? r.json() : null),
    ]).then(([s, c]) => {
      if (s) setStatus(s);
      if (c) setChangelog(c);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const allOperational = status && status.api === 'operational' && (status.database === 'operational' || status.database === 'not_configured');

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white font-bold text-sm" style={{ background: 'linear-gradient(135deg,#d4af37,#ffd700)' }}>Z</div>
            <span className="font-bold tracking-tight" style={{ color: '#b8941f' }}>StarLine</span>
          </Link>
          <div className="flex gap-3 text-sm text-muted-foreground">
            <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
            <Link href="/servers" className="hover:text-foreground transition-colors">Dashboard</Link>
          </div>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 pt-24 pb-16 space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-extrabold tracking-tight mb-2">System Status</h1>
          <p className="text-muted-foreground">Real-time status and release notes for StarLine</p>
          {status && (
            <p className="text-xs text-muted-foreground mt-2">Last checked: {new Date(status.timestamp).toLocaleTimeString()}</p>
          )}
        </div>

        {/* Status card */}
        <Card className={`border shadow-sm ${allOperational ? 'border-green-200 bg-green-50/40' : 'border-yellow-200 bg-yellow-50/40'}`}>
          <CardContent className="p-5">
            {loading ? (
              <div className="flex items-center gap-2 text-muted-foreground"><div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: '#d4af37', borderTopColor: 'transparent' }} />Checking status...</div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-4">
                  {allOperational
                    ? <><CheckCircle className="text-green-600 w-5 h-5" /><span className="font-bold text-green-800">All systems operational</span></>
                    : <><AlertTriangle className="text-yellow-600 w-5 h-5" /><span className="font-bold text-yellow-800">Some services may be degraded</span></>}
                </div>
                {status && (
                  <div className="grid grid-cols-3 gap-4">
                    {[
                      { label: 'API', status: status.api },
                      { label: 'Database', status: status.database },
                      { label: 'Bot', status: status.bot },
                    ].map(s => (
                      <div key={s.label} className="text-center">
                        <p className="text-xs text-muted-foreground mb-1">{s.label}</p>
                        <StatusDot status={s.status} />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Changelog */}
        <div>
          <h2 className="text-xl font-bold mb-4">Release Notes</h2>
          <div className="space-y-4">
            {changelog.map((entry, i) => {
              const style = TYPE_STYLES[entry.type] || TYPE_STYLES.patch;
              return (
                <Card key={entry.version} className={`border-border bg-white shadow-sm ${i === 0 ? 'ring-2 ring-amber-200' : ''}`}>
                  <CardContent className="p-5">
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <span className="font-bold text-base">v{entry.version}</span>
                      {i === 0 && <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">Latest</Badge>}
                      <Badge className={`${style.badge} border text-[10px] flex items-center gap-1`}>{style.icon}{entry.type}</Badge>
                      <span className="text-xs text-muted-foreground ml-auto">{entry.date}</span>
                    </div>
                    <ul className="space-y-1">
                      {entry.changes.map((c, j) => (
                        <li key={j} className="flex items-start gap-2 text-sm text-muted-foreground">
                          <CheckCircle size={13} className="text-green-500 flex-shrink-0 mt-0.5" />
                          {c}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
