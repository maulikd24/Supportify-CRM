/**
 * Supportify stores customer tickets, contacts and credentials, so error
 * reports carry stack traces and context only — no bodies, cookies, headers,
 * query strings, user details, SQL parameters, AI prompts/outputs or local
 * variable values.
 */
export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  stackFrameVariables: false,
} as const;
