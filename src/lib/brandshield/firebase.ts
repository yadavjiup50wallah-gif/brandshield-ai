"use client";

import type { SessionUser } from "@/lib/brandshield/types";

/**
 * Firebase Authentication adapter for BrandShield AI.
 *
 * Two operating modes:
 *
 * 1. **Firebase mode** — active when a Firebase web config is provided via
 *    NEXT_PUBLIC_FIREBASE_* environment variables. Uses the real Firebase
 *    JS SDK (`signInWithEmailAndPassword` / `createUserWithEmailAndPassword`)
 *    and syncs the resulting ID token with the backend via
 *    POST /api/auth/firebase-sync (server verifies the token's RS256
 *    signature against Google's public certs).
 *
 * 2. **Local mode (default)** — when no Firebase config is present, auth
 *    calls the BrandShield API directly. The API mirrors Firebase Auth
 *    semantics and error codes (auth/invalid-email, auth/weak-password,
 *    auth/email-already-in-use, auth/user-not-found, auth/wrong-password),
 *    so switching to real Firebase later requires zero UI changes.
 *
 * The Firebase SDK is loaded through dynamic imports, so in local mode it
 * contributes nothing to the bundle.
 */

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

export function getFirebaseConfig(): FirebaseWebConfig | null {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim();
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim() ?? (projectId ? `${projectId}.firebaseapp.com` : undefined);
  if (!apiKey || !projectId || !appId) return null;
  return { apiKey, projectId, appId, authDomain: authDomain ?? `${projectId}.firebaseapp.com` };
}

export function isFirebaseConfigured(): boolean {
  return getFirebaseConfig() !== null;
}

/** Download the Firebase SDK chunks ahead of the first submit. Called when
 *  the auth screen mounts; `import()` caches its promise, so the later
 *  `loadFirebaseAuth()` inside signIn/signUp resolves instantly instead of
 *  waiting on a ~100KB chunk round trip. Idempotent. */
export function preloadFirebaseSdk(): void {
  if (typeof window === "undefined" || !isFirebaseConfigured()) return;
  void import("firebase/app");
  void import("firebase/auth");
}

async function loadFirebaseAuth() {
  const [{ initializeApp, getApps, getApp }, { getAuth }] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
  ]);
  const config = getFirebaseConfig();
  if (!config) throw Object.assign(new Error("Firebase is not configured."), { code: "firebase/not-configured" });
  const app = getApps().length ? getApp() : initializeApp(config);
  return getAuth(app);
}

function mapFirebaseError(err: unknown): Error {
  const code = (err as { code?: string })?.code ?? "auth/internal-error";
  const messages: Record<string, string> = {
    "auth/invalid-email": "That email address doesn't look right. Check the format.",
    "auth/missing-password": "Please enter a password.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/email-already-in-use": "An account with this email already exists. Try signing in instead.",
    "auth/user-not-found": "No account found for this email. Create one on the “Create account” tab.",
    "auth/wrong-password": "Incorrect password. Please try again.",
    "auth/invalid-credential": "Email or password is incorrect — or this account was created before Firebase was connected. Try the “Create account” tab once with the same email.",
    "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
    "auth/network-request-failed": "Network error — check your connection and try again.",
    "auth/operation-not-allowed": "Email/password sign-in is not enabled for this Firebase project.",
  };
  return Object.assign(new Error(messages[code] ?? (err as Error)?.message ?? "Authentication failed."), { code });
}

/** Sign in with real Firebase Auth, then sync the session with the backend.
 *  Resolves with the synced session user (drives the SPA dashboard swap). */
export async function firebaseEmailSignIn(email: string, password: string): Promise<SessionUser> {
  try {
    const { signInWithEmailAndPassword } = await import("firebase/auth");
    const auth = await loadFirebaseAuth();
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const idToken = await credential.user.getIdToken();
    return await syncSession(idToken);
  } catch (err) {
    throw mapFirebaseError(err);
  }
}

/** Create a real Firebase Auth account, then sync the session with the backend.
 *  Resolves with the synced session user (drives the SPA dashboard swap). */
export async function firebaseEmailSignUp(input: { email: string; password: string; name: string }): Promise<SessionUser> {
  try {
    const { createUserWithEmailAndPassword, updateProfile } = await import("firebase/auth");
    const auth = await loadFirebaseAuth();
    const credential = await createUserWithEmailAndPassword(auth, input.email, input.password);
    if (input.name) await updateProfile(credential.user, { displayName: input.name });
    const idToken = await credential.user.getIdToken();
    return await syncSession(idToken);
  } catch (err) {
    throw mapFirebaseError(err);
  }
}

async function syncSession(idToken: string): Promise<SessionUser> {
  const res = await fetch("/api/auth/firebase-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Could not sync your Firebase session with the workspace.");
  }
  return (await res.json()) as SessionUser;
}
