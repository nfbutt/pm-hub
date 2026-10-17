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
  const client = useMemo(() => (token ? createClient(token) : null), [token]);
  const signOut = () => { clearToken(); setToken(null); location.hash = "#/"; };

  if (route.kind === "demo") return <ProjectScreen source={{ kind: "demo" }} view={route.view} onSignOut={client ? signOut : undefined} />;
  if (!client) return <Connect onConnected={setToken} />;
  if (route.kind === "home") return <ProjectPicker client={client} onSignOut={signOut} />;
  return (
    <ProjectScreen
      key={`${route.owner}/${route.number}`}
      source={{ kind: "github", client, owner: route.owner, number: route.number }}
      view={route.view}
      onSignOut={signOut}
    />
  );
}
