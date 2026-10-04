export const SESSION_COOKIE_NAME = "achadinhos_session";
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}
