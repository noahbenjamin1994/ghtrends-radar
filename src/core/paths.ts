/** Public deployment prefix; the local CLI keeps the empty root prefix. */
export function basePathFromUrl(url: string): string {
  const path = new URL(url).pathname.replace(/\/+$/, "");
  if (path && !/^(\/[a-zA-Z0-9_-]+)+$/.test(path))
    throw new Error("PUBLIC_URL must use a simple directory path.");
  return path;
}

export function appPath(path: string, basePath: string): string {
  if (!path.startsWith("/") || path.startsWith("//") || !basePath) return path;
  if (
    path === basePath ||
    path.startsWith(basePath + "/") ||
    path.startsWith(basePath + "?")
  )
    return path;
  return basePath + path;
}

export function routePath(path: string, basePath: string): string {
  if (
    basePath &&
    (path === basePath ||
      path.startsWith(basePath + "/") ||
      path.startsWith(basePath + "?"))
  )
    return path.slice(basePath.length) || "/";
  return path;
}
