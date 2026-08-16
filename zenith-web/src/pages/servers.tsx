import { Link } from "wouter";
  import { useState, useEffect } from "react";
  import { Button } from "@/components/ui/button";
  import { LogOut, Plus, Star, Settings } from "lucide-react";

  export interface Guild {
    id: string;
    name: string;
    icon?: string;
    iconUrl?: string;
    memberCount?: number;
    botInstalled: boolean;
    isPremium?: boolean;
  }

  export default function ServersPage() {
    const [guilds, setGuilds] = useState<Guild[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
      const fetchGuilds = async () => {
        try {
          const res = await fetch("/api/guilds", { credentials: 'include' });
          if (res.ok) {
            const data = await res.json();
            setGuilds(data);
          }
        } catch (error) {
          console.error("Failed to fetch guilds:", error);
        } finally {
          setIsLoading(false);
        }
      };
      fetchGuilds();
    }, []);

    const handleLogout = async () => {
      try {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/";
      } catch {}
    };

    return (
      <div className="min-h-screen bg-background pb-20">
        <nav className="bg-white border-b-2 sticky top-0 z-10 shadow-sm" style={{ borderColor: 'rgba(212,175,55,.4)' }}>
          <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-xl shadow-sm"
                style={{ background: 'linear-gradient(135deg, #d4af37, #ffd700)' }}>
                Z
              </div>
              <span className="font-bold text-xl tracking-tight" style={{ color: '#d4af37' }}>StarLine</span>
            </Link>
            <Button variant="ghost" onClick={handleLogout} className="text-muted-foreground hover:text-foreground gap-2">
              <LogOut className="w-4 h-4" />
              Log out
            </Button>
          </div>
        </nav>

        <main className="max-w-6xl mx-auto px-4 pt-10">
          <div className="mb-8">
            <h1 className="text-3xl font-extrabold tracking-tight">Select Server</h1>
            <p className="text-muted-foreground mt-1 text-sm">Choose a server to manage, or add StarLine to a new one.</p>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {[1,2,3,4].map(i => (
                <div key={i} className="h-44 bg-white rounded-2xl border border-border animate-pulse" />
              ))}
            </div>
          ) : guilds?.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-3xl border border-border shadow-sm">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ background: 'rgba(212,175,55,.1)' }}>
                <Plus className="w-8 h-8" style={{ color: '#d4af37' }} />
              </div>
              <h3 className="text-lg font-bold mb-1">No servers found</h3>
              <p className="text-muted-foreground mb-6 max-w-sm mx-auto text-sm">
                You don't have Manage Server permissions in any servers, or the bot hasn't been added yet.
              </p>
              <Button
                onClick={() => window.open(
                  "https://discord.com/api/oauth2/authorize?client_id=1341142514936381552&permissions=8&scope=bot%20applications.commands",
                  "_blank"
                )}
              >
                Add Bot to Server
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {guilds.map((guild) => <ServerCard key={guild.id} guild={guild} />)}
            </div>
          )}
        </main>
      </div>
    );
  }

  function ServerCard({ guild }: { guild: Guild }) {
    const iconUrl = guild.iconUrl || (guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null);

    return (
      <div className={`group relative bg-white rounded-2xl border p-6 flex flex-col items-center text-center transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
        guild.isPremium ? 'border-primary/40 ring-1 ring-primary/15' : 'border-border'
      }`}>
        {guild.isPremium && (
          <div className="absolute top-4 right-4 bg-premium/10 text-premium px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
            <Star className="w-3 h-3 fill-current" /> Pro
          </div>
        )}

        {iconUrl ? (
          <img src={iconUrl} alt={guild.name}
            className="w-20 h-20 rounded-2xl shadow-sm object-cover mb-4 ring-2 ring-primary/20" />
        ) : (
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center mb-4 text-white font-bold text-2xl"
            style={{ background: 'linear-gradient(135deg, #d4af37, #ffd700)' }}>
            {guild.name.charAt(0)}
          </div>
        )}

        <h3 className="text-base font-bold leading-tight mb-1 truncate w-full px-2" title={guild.name}>
          {guild.name}
        </h3>
        <p className="text-xs text-muted-foreground mb-5">
          {guild.memberCount ? `${guild.memberCount.toLocaleString()} members` : 'Discord Server'}
        </p>

        {guild.botInstalled ? (
          <Link href={`/dashboard/${guild.id}`} className="w-full mt-auto">
            <Button className="w-full font-semibold gap-2">
              <Settings className="w-4 h-4" />
              Manage Server
            </Button>
          </Link>
        ) : (
          <Button
            variant="outline"
            className="w-full mt-auto gap-2 border-primary/30 text-primary hover:bg-primary/5 hover:border-primary/50"
            onClick={() => window.open(
              `https://discord.com/api/oauth2/authorize?client_id=1341142514936381552&permissions=8&scope=bot%20applications.commands&guild_id=${guild.id}`,
              "_blank"
            )}
          >
            <Plus className="w-4 h-4" />
            Add to Server
          </Button>
        )}
      </div>
    );
  }
  
