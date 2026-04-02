const TOKEN_KEY = "bidreel:token";

function isExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return Date.now() / 1000 >= (payload.exp as number) - 30;
  } catch {
    return true;
  }
}

export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getValidSessionToken(): string | null {
  const t = getSessionToken();
  if (!t) return null;
  if (isExpired(t)) {
    clearSessionToken();
    return null;
  }
  return t;
}

export function setSessionToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
  }
}

export function clearSessionToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
  }
}
