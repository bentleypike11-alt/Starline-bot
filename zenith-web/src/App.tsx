import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useEffect } from "react";

import LandingPage from "@/pages/landing";
import LoginPage from "@/pages/login";
import NotFound from "@/pages/not-found";
import ServersPage from "@/pages/servers";
import DashboardLayout from "@/components/layout";
import OverviewPage from "@/pages/dashboard/overview";
import StaffPage from "@/pages/dashboard/staff";
import ApplicationsPage from "@/pages/dashboard/applications";
import StrikesPage from "@/pages/dashboard/strikes";
import WarningsPage from "@/pages/dashboard/warnings";
import LoaPage from "@/pages/dashboard/loa";
import ActivityPage from "@/pages/dashboard/activity";
import StatsPage from "@/pages/dashboard/stats";
import RanksPage from "@/pages/dashboard/ranks";
import ConfigPage from "@/pages/dashboard/config";
import BlacklistPage from "@/pages/dashboard/blacklist";
import BotCustomizationPage from "@/pages/dashboard/bot-customization";
import TOSPage from "@/pages/tos";
import PrivacyPage from "@/pages/privacy";
import PremiumPage from "@/pages/premium";
import PortalPage from "@/pages/portal";
import StatusPage from "@/pages/status";
import ManagePremiumPage from "@/pages/dashboard/manage-premium";
import NotesPage from "@/pages/dashboard/notes";
import AnnouncementsPage from "@/pages/dashboard/announcements";
import HandbookPage from "@/pages/dashboard/handbook";
import CommendationsPage from "@/pages/dashboard/commendations";
import RankRequestsPage from "@/pages/dashboard/rank-requests";
import CustomCommandsPage from "@/pages/dashboard/custom-commands";
import InactivityPage from "@/pages/dashboard/inactivity";
import PromotionsPage from "@/pages/dashboard/promotions";
import ShiftsPage from "@/pages/dashboard/shifts";
import RosterPage from "@/pages/dashboard/roster";
import DivisionsPage from "@/pages/dashboard/divisions";
import PerformancePage from "@/pages/dashboard/performance";
import AnalyticsPage from "@/pages/dashboard/analytics";
import TrainingPage from "@/pages/dashboard/training";
import GoalsPage from "@/pages/dashboard/goals";
import IncidentsPage from "@/pages/dashboard/incidents";
import EmbedSenderPage from "@/pages/dashboard/embed-sender";

// New systems
import PollsPage from "@/pages/dashboard/polls";
import TasksPage from "@/pages/dashboard/tasks";
import DirectoryPage from "@/pages/dashboard/directory";
import AwardsPage from "@/pages/dashboard/awards";

const queryClient = new QueryClient();

function ProtectedRoute({ component: Component }: { component: any }) {
  const { isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      setLocation("/login");
    }
  }, [isLoading, isAuthenticated, setLocation]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center">
          <div className="w-12 h-12 bg-muted rounded-xl mb-4" />
          <div className="h-3 w-24 bg-muted rounded" />
        </div>
      </div>
    );
  }

  return <Component />;
}

function DashboardRoutes({ params }: { params: { guildId: string } }) {
  const guildId = params.guildId;

  return (
    <DashboardLayout guildId={guildId}>
      <Switch>
        <Route
          path="/dashboard/:guildId"
          component={() => <OverviewPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/staff"
          component={() => <StaffPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/applications"
          component={() => <ApplicationsPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/strikes"
          component={() => <StrikesPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/warnings"
          component={() => <WarningsPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/loa"
          component={() => <LoaPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/activity"
          component={() => <ActivityPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/stats"
          component={() => <StatsPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/ranks"
          component={() => <RanksPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/config"
          component={() => <ConfigPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/blacklist"
          component={() => <BlacklistPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/bot-customization"
          component={() => (
            <BotCustomizationPage guildId={guildId} />
          )}
        />

        <Route
          path="/dashboard/:guildId/promotions"
          component={() => <PromotionsPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/shifts"
          component={() => <ShiftsPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/roster"
          component={() => <RosterPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/divisions"
          component={() => <DivisionsPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/performance"
          component={() => <PerformancePage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/analytics"
          component={() => <AnalyticsPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/manage-premium"
          component={() => <ManagePremiumPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/notes"
          component={() => <NotesPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/announcements"
          component={() => <AnnouncementsPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/handbook"
          component={() => <HandbookPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/commendations"
          component={() => <CommendationsPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/rank-requests"
          component={() => <RankRequestsPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/custom-commands"
          component={() => <CustomCommandsPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/inactivity"
          component={() => <InactivityPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/training"
          component={() => <TrainingPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/goals"
          component={() => <GoalsPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/incidents"
          component={() => <IncidentsPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/embed-sender"
          component={() => <EmbedSenderPage guildId={guildId} />}
        />

        {/* New systems */}

        <Route
          path="/dashboard/:guildId/polls"
          component={() => <PollsPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/tasks"
          component={() => <TasksPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/directory"
          component={() => <DirectoryPage guildId={guildId} />}
        />

        <Route
          path="/dashboard/:guildId/awards"
          component={() => <AwardsPage guildId={guildId} />}
        />

        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={LandingPage} />

      <Route path="/login" component={LoginPage} />

      <Route path="/tos" component={TOSPage} />

      <Route path="/privacy" component={PrivacyPage} />

      <Route path="/premium" component={PremiumPage} />

      <Route
        path="/portal/:apak"
        component={({ params }) => (
          <PortalPage apak={params.apak} />
        )}
      />

      <Route path="/status" component={StatusPage} />

      <Route
        path="/servers"
        component={() => (
          <ProtectedRoute component={ServersPage} />
        )}
      />

      <Route
        path="/dashboard/:guildId/*?"
        component={({ params }) => (
          <ProtectedRoute
            component={() => (
              <DashboardRoutes params={params as any} />
            )}
          />
        )}
      />

      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      forcedTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider>
            <WouterRouter
              base={import.meta.env.BASE_URL.replace(/\/$/, "")}
            >
              <Router />
            </WouterRouter>

            <Toaster />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
