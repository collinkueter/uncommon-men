import { getApp, getApps, initializeApp } from "firebase/app";
import { browserLocalPersistence, connectAuthEmulator, getAuth, setPersistence, type Auth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import { DEFAULT_CONFERENCE_ID } from "@/lib/conferencePaths";
import { log } from "@/lib/logging/logger";

export const FIREBASE_NOT_CONFIGURED =
  "Firebase is not configured. Add the VITE_FIREBASE_* environment variables, or open ?demo=1 for the local preview.";

export interface FirebaseServices {
  auth: Auth;
  db: Firestore;
  /** Resolves once auth persistence is configured. */
  ready: Promise<void>;
}

let services: FirebaseServices | undefined;

/**
 * One Firebase app, auth and Firestore instance per page. Conference stores
 * come and go as the route's conference changes; the SDK instances do not.
 */
export function getFirebaseServices(): FirebaseServices {
  if (services) return services;
  const config = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  };
  if (Object.values(config).some((value) => !value)) throw new Error(FIREBASE_NOT_CONFIGURED);
  const app = getApps().length ? getApp() : initializeApp(config);
  const databaseId = import.meta.env.VITE_FIREBASE_DATABASE_ID || "conference";
  const auth = getAuth(app);
  let db: Firestore;
  let fresh = true;
  try {
    db = initializeFirestore(
      app,
      { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) },
      databaseId,
    );
  } catch {
    // Already initialized (hot module reload).
    db = getFirestore(app, databaseId);
    fresh = false;
  }
  if (fresh && import.meta.env.VITE_FIREBASE_EMULATORS === "true") {
    connectAuthEmulator(auth, `http://127.0.0.1:${import.meta.env.VITE_AUTH_EMULATOR_PORT || "9199"}`, {
      disableWarnings: true,
    });
    connectFirestoreEmulator(db, "127.0.0.1", Number(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT || 8180));
  }
  services = { auth, db, ready: setPersistence(auth, browserLocalPersistence) };
  return services;
}

const DEFAULT_LOOKUP_TIMEOUT_MS = 4000;

/**
 * settings/platform.defaultConferenceId, falling back to DEFAULT_CONFERENCE_ID
 * when the document is missing, unreadable, malformed, or slow.
 */
export async function readDefaultConferenceId(): Promise<string> {
  try {
    const { db } = getFirebaseServices();
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), DEFAULT_LOOKUP_TIMEOUT_MS));
    const settings = await Promise.race([getDoc(doc(db, "settings", "platform")), timeout]);
    const value = settings?.exists() ? settings.data().defaultConferenceId : undefined;
    return typeof value === "string" && /^[a-z0-9][a-z0-9-]{1,62}$/.test(value) ? value : DEFAULT_CONFERENCE_ID;
  } catch (error) {
    log.warn("Default conference lookup failed", { error: error instanceof Error ? error.message : String(error) });
    return DEFAULT_CONFERENCE_ID;
  }
}
