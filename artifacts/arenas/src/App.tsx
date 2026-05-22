import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/Landing";
import Community from "@/pages/Community";
import Login from "@/pages/Login";
import Profile from "@/pages/Profile";
import Events from "@/pages/Events";
import Leaderboards from "@/pages/Leaderboards";
import Challenges from "@/pages/Challenges";
import Athletes from "@/pages/Athletes";
import Blog from "@/pages/Blog";
import { useEffect } from "react";

const queryClient = new QueryClient();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ProtectedRoute({ component: Component }: { component: () => any }) {
  const { isLoggedIn } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoggedIn) setLocation("/login");
  }, [isLoggedIn, setLocation]);

  if (!isLoggedIn) return null;
  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/"              component={Landing} />
      <Route path="/login"         component={Login} />
      <Route path="/community"     component={() => <ProtectedRoute component={Community} />} />
      <Route path="/athletes"      component={() => <ProtectedRoute component={Athletes} />} />
      <Route path="/events"        component={() => <ProtectedRoute component={Events} />} />
      <Route path="/leaderboards"  component={() => <ProtectedRoute component={Leaderboards} />} />
      <Route path="/challenges"    component={() => <ProtectedRoute component={Challenges} />} />
      <Route path="/profile"       component={() => <ProtectedRoute component={Profile} />} />
      <Route path="/blog"          component={Blog} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
