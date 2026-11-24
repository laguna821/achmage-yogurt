/** The renderer can navigate only within this workspace. */
export const isAppRoute = (route: unknown): route is string => typeof route === 'string' &&
  (['', '/meetings', '/recordings', '/videos', '/chat', '/trash', '/settings', '/settings/recordings', '/settings/notes-model'].includes(route) || /^\/(?:note|chat|folder)\/[\w-]+$/.test(route))
