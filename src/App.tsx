import { useMemo, useState } from "react";
import { createClient } from "./github/client";
import { useRoute } from "./router";
import { clearToken, readToken } from "./store/token";
import { Connect } from "./views/Connect";
import { ProjectPicker } from "./views/ProjectPicker";
import { ProjectScreen } from "./views/ProjectScreen";

export function App() {
  const route = useRoute();
  const [token, setToken] = useState(readToken);
  // GitHub turned the saved token down (expired or revoked). The link stays where it is,
  // so a new token lands the person back on the project they were opening.
  const [rejected, setRejected] = useState(false);
  const client = useMemo(() => (token ? createClient(token) : null), [token]);
  const signOut = () => { clearToken(); setToken(null); setRejected(false); location.hash = "#/"; };
  const tokenRejected = () => { clearToken(); setToken(null); setRejected(true); };
  const connected = (t: string) => { setRejected(false); setToken(t); };

  if (route.kind === "demo") return <ProjectScreen source={{ kind: "demo" }} view={route.view} onSignOut={client ? signOut : undefined} />;
  if (!client) return <Connect onConnected={connected} rejected={rejected} target={route.kind === "project" ? route : null} />;
  if (route.kind === "home") return <ProjectPicker client={client} onSignOut={signOut} onTokenRejected={tokenRejected} />;
  return (
    <ProjectScreen
      key={`${route.owner}/${route.number}`}
      source={{ kind: "github", client, owner: route.owner, number: route.number }}
      view={route.view}
      onSignOut={signOut}
      onTokenRejected={tokenRejected}
    />
  );
}
