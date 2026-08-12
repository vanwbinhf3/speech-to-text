import type { NavigationPage } from "../types/navigation";

export const pages: readonly NavigationPage[] = [
  {
    id: "dashboard",
    name: "Dashboard",
    aliases: ["dashboard", "home dashboard", "main dashboard"],
  },
  {
    id: "projects",
    name: "Projects",
    aliases: ["project", "projects", "project page", "my projects"],
  },
  {
    id: "tasks",
    name: "Tasks",
    aliases: ["task", "tasks", "my tasks", "task page", "task list"],
  },
  {
    id: "workload",
    name: "Workload",
    aliases: [
      "workload dashboard",
      "employee workload",
      "team workload",
      "workload",
      "work load",
      "my workload",
    ],
  },
  {
    id: "employees",
    name: "Employees",
    aliases: [
      "employee list",
      "employees page",
      "team members",
      "employee",
      "employees",
      "staff",
    ],
  },
  {
    id: "analytics",
    name: "Analytics",
    aliases: [
      "analytics dashboard",
      "performance analytics",
      "analytics page",
      "analytics",
      "reports",
    ],
  },
  {
    id: "settings",
    name: "Settings",
    aliases: ["application settings", "app settings", "settings"],
  },
  {
    id: "integrations",
    name: "Integrations",
    aliases: [
      "openproject integration",
      "github integration",
      "integration settings",
      "integration",
      "integrations",
    ],
  },
] as const;
