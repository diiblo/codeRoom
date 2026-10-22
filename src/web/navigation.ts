export type ProjectTab =
  "overview" | "tickets" | "collaborators" | "messaging" | "activity";
export type Route =
  | { page: "dashboard" }
  | { page: "projects" }
  | { page: "profiles" }
  | { page: "project"; projectId: string; tab: ProjectTab };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/");
  if (parts[0] === "espaces" && parts[1]) {
    try {
      const tab = parts[2];
      return {
        page: "project",
        projectId: decodeURIComponent(parts[1]),
        tab:
          tab === "tickets" ||
          tab === "collaborators" ||
          tab === "messaging" ||
          tab === "activity"
            ? tab
            : "overview",
      };
    } catch {
      return { page: "projects" };
    }
  }
  if (parts[0] === "espaces") return { page: "projects" };
  if (parts[0] === "profils") return { page: "profiles" };
  return { page: "dashboard" };
}

export function routeHref(route: Route) {
  if (route.page === "project")
    return `#/espaces/${encodeURIComponent(route.projectId)}/${route.tab}`;
  return route.page === "projects"
    ? "#/espaces"
    : route.page === "profiles"
      ? "#/profils"
      : "#/dashboard";
}
