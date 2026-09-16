import { appPath, routePath } from "../core/paths.js";

const basePath =
  document.querySelector<HTMLMetaElement>('meta[name="ghtrends-base-path"]')
    ?.content || "";
export const appUrl = (path: string) => appPath(path, basePath);
export const routeUrl = (path: string) => routePath(path, basePath);
export const currentRoute = () => routeUrl(location.pathname) + location.search;
