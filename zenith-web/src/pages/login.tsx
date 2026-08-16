import { useAuth } from "@/lib/auth";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { SiDiscord } from "react-icons/si";

export default function LoginPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md animate-pulse flex flex-col items-center">
          <div className="w-16 h-16 bg-gray-200 rounded-xl mb-6"></div>
          <div className="h-6 w-32 bg-gray-200 rounded mb-2"></div>
          <div className="h-4 w-48 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (isAuthenticated) {
    setLocation("/servers");
    return null;
  }

  const handleLogin = () => {
    window.location.href = "/api/auth/discord";
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/5 rounded-full mix-blend-multiply filter blur-3xl opacity-70 animate-blob"></div>
      <div className="absolute top-1/3 right-1/4 w-72 h-72 bg-premium/5 rounded-full mix-blend-multiply filter blur-3xl opacity-70 animate-blob animation-delay-2000"></div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <Link href="/" className="flex justify-center mb-6 hover:opacity-90 transition-opacity">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-white font-bold text-4xl shadow-lg" style={{ background: "linear-gradient(135deg,#d4af37,#ffd700)", boxShadow: "0 8px 24px rgba(212,175,55,.35)" }}>
            Z
          </div>
        </Link>
        <h2 className="mt-2 text-center text-3xl font-extrabold text-gray-900 tracking-tight">
          Sign in to StarLine
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          The command center for serious ERLC staff teams.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="bg-white py-8 px-4 shadow-xl shadow-gray-200/50 sm:rounded-3xl sm:px-10 border border-gray-100">
          <div className="space-y-6">
            <div>
              <Button 
                onClick={handleLogin}
                className="w-full flex justify-center py-6 px-4 border border-transparent rounded-xl shadow-sm text-lg font-medium text-white bg-[#5865F2] hover:bg-[#4752C4] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#5865F2] transition-all"
              >
                <SiDiscord className="w-6 h-6 mr-3" />
                Sign in with Discord
              </Button>
            </div>
            
            <div className="text-center">
              <p className="text-xs text-gray-500 font-medium italic group cursor-default">
                We promise we won't DM your server. 
                <span className="text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity ml-1">Probably.</span>
              </p>
            </div>
          </div>
          
          <div className="mt-8 border-t border-gray-100 pt-6">
            <p className="text-xs text-center text-gray-400">
              By signing in, you agree to our <Link href="/tos" className="hover:text-gray-600 underline">Terms of Service</Link> and <Link href="/privacy" className="hover:text-gray-600 underline">Privacy Policy</Link>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
