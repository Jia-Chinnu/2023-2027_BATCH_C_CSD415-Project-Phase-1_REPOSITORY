import React, { useState } from "react";

import {
  auth,
  googleProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "../firebase";

export default function AuthScreen({
  onAuthSuccess,
  activeSession,
  lockedRole,
  roleConflictError,
}) {
  const [isSignup, setIsSignup] =
    useState(false);

  const [role, setRole] =
    useState("user");

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [name, setName] =
    useState("");

  const [error, setError] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  /* =========================================================
     FIREBASE ERROR HELPER
  ========================================================= */

  const getFirebaseError = (err) => {
    const code = err?.code || "";

    const messages = {
      "auth/invalid-email":
        "Please enter a valid email address.",

      "auth/user-not-found":
        "No TrustCharge account was found with this email.",

      "auth/wrong-password":
        "Incorrect password. Please try again.",

      "auth/invalid-credential":
        "Invalid email or password.",

      "auth/email-already-in-use":
        "An account already exists with this email.",

      "auth/weak-password":
        "Password should contain at least 6 characters.",

      "auth/popup-closed-by-user":
        "Google sign-in was cancelled.",

      "auth/popup-blocked":
        "The Google sign-in popup was blocked by your browser.",

      "auth/network-request-failed":
        "Network error. Please check your internet connection.",

      "auth/too-many-requests":
        "Too many attempts. Please wait a moment and try again.",
    };

    if (messages[code]) {
      return messages[code];
    }

    return (
      err?.message
        ?.replace(/^Firebase:\s*/i, "")
        ?.replace(/\s*\(auth\/.*\)\.?$/i, "")
        ?.trim() ||
      "Authentication failed. Please try again."
    );
  };

  /* =========================================================
     SEND FIREBASE USER TO APP.JSX
  ========================================================= */

  const completeAuthentication = (
    firebaseUser,
    selectedRole,
    displayName = null
  ) => {
    /*
     * IMPORTANT
     *
     * Firebase gives us the real permanent UID:
     *
     * firebaseUser.uid
     *
     * This UID is what App.jsx uses to find/save
     * the user's vehicle in SQLite.
     */

    if (!firebaseUser?.uid) {
      throw new Error(
        "Firebase did not return a valid account ID."
      );
    }

    if (!firebaseUser?.email) {
      throw new Error(
        "Firebase did not return an email address."
      );
    }

    const session = {
      email: firebaseUser.email,

      role: selectedRole,

      /*
       * Keep both names for compatibility.
       */
      uid: firebaseUser.uid,

      firebaseUid: firebaseUser.uid,

      displayName:
        displayName ||
        firebaseUser.displayName ||
        null,
    };

    console.log(
      "=========================================="
    );

    console.log(
      "TrustCharge Firebase authentication successful"
    );

    console.log(
      "Email:",
      session.email
    );

    console.log(
      "Role:",
      session.role
    );

    console.log(
      "Firebase UID:",
      session.firebaseUid
    );

    console.log(
      "=========================================="
    );

    /*
     * Send complete Firebase identity to App.jsx.
     */
    onAuthSuccess(session);
  };

  /* =========================================================
     EMAIL LOGIN / SIGNUP
  ========================================================= */

  const handleEmailAuth = async (e) => {
    e.preventDefault();

    setError("");

    /*
     * If App.jsx has locked this browser session
     * to another role, prevent switching roles.
     */
    if (
      lockedRole &&
      lockedRole !== role
    ) {
      setError(
        `This session is locked to ${lockedRole.toUpperCase()} access.`
      );

      return;
    }

    const cleanEmail =
      email.trim().toLowerCase();

    if (!cleanEmail) {
      setError(
        "Please enter your email address."
      );

      return;
    }

    if (!password) {
      setError(
        "Please enter your password."
      );

      return;
    }

    if (
      isSignup &&
      !name.trim()
    ) {
      setError(
        "Please enter your full name."
      );

      return;
    }

    setLoading(true);

    try {
      let result;

      /* =====================================================
         SIGN UP
      ===================================================== */

      if (isSignup) {
        result =
          await createUserWithEmailAndPassword(
            auth,
            cleanEmail,
            password
          );
      }

      /* =====================================================
         LOGIN
      ===================================================== */

      else {
        result =
          await signInWithEmailAndPassword(
            auth,
            cleanEmail,
            password
          );
      }

      /*
       * REAL FIREBASE USER
       */
      const firebaseUser =
        result?.user;

      if (!firebaseUser?.uid) {
        setError(
          "Firebase authentication succeeded, but no account ID was returned."
        );

        return;
      }

      /*
       * COMPLETE SESSION
       *
       * This is the critical fix.
       */
      completeAuthentication(
        firebaseUser,
        role,
        isSignup
          ? name.trim()
          : firebaseUser.displayName
      );
    } catch (err) {
      console.error(
        "TrustCharge email authentication error:",
        err
      );

      setError(
        getFirebaseError(err)
      );
    } finally {
      setLoading(false);
    }
  };

  /* =========================================================
     GOOGLE LOGIN
  ========================================================= */

  const handleGoogleAuth =
    async () => {
      setError("");

      if (
        lockedRole &&
        lockedRole !== role
      ) {
        setError(
          `This session is locked to ${lockedRole.toUpperCase()} access.`
        );

        return;
      }

      setLoading(true);

      try {
        const result =
          await signInWithPopup(
            auth,
            googleProvider
          );

        const firebaseUser =
          result?.user;

        if (!firebaseUser?.uid) {
          setError(
            "Google authentication succeeded, but Firebase did not return an account ID."
          );

          return;
        }

        /*
         * IMPORTANT:
         *
         * Google login also sends the REAL Firebase UID.
         */
        completeAuthentication(
          firebaseUser,
          role,
          firebaseUser.displayName
        );
      } catch (err) {
        console.error(
          "TrustCharge Google authentication error:",
          err
        );

        setError(
          getFirebaseError(err)
        );
      } finally {
        setLoading(false);
      }
    };

  /* =========================================================
     SWITCH LOGIN / SIGNUP
  ========================================================= */

  const toggleAuthMode = () => {
    setError("");
    setPassword("");

    setIsSignup(
      (current) => !current
    );
  };

  /* =========================================================
     UI
  ========================================================= */

  return (
    <div style={styles.container}>
      <div style={styles.card}>

        {/* =================================================
            BRAND
        ================================================= */}

        <div style={styles.brandRow}>
          <div style={styles.coreBadge}>
            <span
              style={{
                color: "#FFFFFF",
                fontSize: "16px",
                fontWeight: "900",
              }}
            >
              ⚡
            </span>
          </div>

          <h2 style={styles.brandText}>
            Trust
            <span
              style={{
                color: "#D97706",
              }}
            >
              Charge
            </span>
          </h2>
        </div>

        {/* =================================================
            TITLE
        ================================================= */}

        <h1 style={styles.title}>
          {isSignup
            ? "Create Account"
            : "Welcome Back"}
        </h1>

        <p style={styles.subtitle}>
          {isSignup
            ? "Sign up to start charging or managing stations"
            : "Log in to access your EV network"}
        </p>

        {/* =================================================
            ROLE SELECTOR
        ================================================= */}

        <div style={styles.roleTabs}>
          <button
            type="button"
            disabled={loading}
            onClick={() =>
              setRole("user")
            }
            style={{
              ...styles.roleTab,
              backgroundColor:
                role === "user"
                  ? "#D97706"
                  : "transparent",
              color:
                role === "user"
                  ? "#FFFFFF"
                  : "#78716C",
              opacity:
                loading ? 0.6 : 1,
            }}
          >
            EV User
          </button>

          <button
            type="button"
            disabled={loading}
            onClick={() =>
              setRole("admin")
            }
            style={{
              ...styles.roleTab,
              backgroundColor:
                role === "admin"
                  ? "#D97706"
                  : "transparent",
              color:
                role === "admin"
                  ? "#FFFFFF"
                  : "#78716C",
              opacity:
                loading ? 0.6 : 1,
            }}
          >
            Station Admin
          </button>
        </div>

        {/* =================================================
            ROLE ERROR FROM APP
        ================================================= */}

        {roleConflictError && (
          <div
            style={styles.errorBox}
          >
            {roleConflictError}
          </div>
        )}

        {/* =================================================
            LOCAL AUTH ERROR
        ================================================= */}

        {error && (
          <div
            style={styles.errorBox}
          >
            {error}
          </div>
        )}

        {/* =================================================
            FORM
        ================================================= */}

        <form
          onSubmit={
            handleEmailAuth
          }
          style={styles.form}
        >
          {/* FULL NAME */}
          {isSignup && (
            <div
              style={styles.inputGroup}
            >
              <label
                style={styles.label}
              >
                Full Name
              </label>

              <input
                type="text"
                placeholder="Enter your name"
                value={name}
                onChange={(e) =>
                  setName(
                    e.target.value
                  )
                }
                required
                disabled={loading}
                autoComplete="name"
                style={{
                  ...styles.input,
                  opacity:
                    loading ? 0.7 : 1,
                }}
              />
            </div>
          )}

          {/* EMAIL */}
          <div
            style={styles.inputGroup}
          >
            <label
              style={styles.label}
            >
              Email Address
            </label>

            <input
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) =>
                setEmail(
                  e.target.value
                )
              }
              required
              disabled={loading}
              autoComplete="email"
              style={{
                ...styles.input,
                opacity:
                  loading ? 0.7 : 1,
              }}
            />
          </div>

          {/* PASSWORD */}
          <div
            style={styles.inputGroup}
          >
            <label
              style={styles.label}
            >
              Password
            </label>

            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) =>
                setPassword(
                  e.target.value
                )
              }
              required
              disabled={loading}
              autoComplete={
                isSignup
                  ? "new-password"
                  : "current-password"
              }
              style={{
                ...styles.input,
                opacity:
                  loading ? 0.7 : 1,
              }}
            />
          </div>

          {/* SUBMIT */}
          <button
            type="submit"
            disabled={loading}
            style={{
              ...styles.submitButton,
              opacity:
                loading ? 0.75 : 1,
              cursor:
                loading
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            {loading
              ? "Authenticating..."
              : isSignup
              ? `Sign Up as ${
                  role === "admin"
                    ? "Admin"
                    : "User"
                }`
              : "Log In"}
          </button>
        </form>

        {/* =================================================
            DIVIDER
        ================================================= */}

        <div
          style={styles.divider}
        >
          <span
            style={
              styles.dividerLine
            }
          />

          <span
            style={
              styles.dividerText
            }
          >
            or continue with
          </span>

          <span
            style={
              styles.dividerLine
            }
          />
        </div>

        {/* =================================================
            GOOGLE
        ================================================= */}

        <button
          type="button"
          onClick={
            handleGoogleAuth
          }
          disabled={loading}
          style={{
            ...styles.googleButton,
            opacity:
              loading ? 0.7 : 1,
            cursor:
              loading
                ? "not-allowed"
                : "pointer",
          }}
        >
          <svg
            style={{
              width: "18px",
              height: "18px",
            }}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              fill="#4285F4"
              d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
            />

            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.13 0-5.78-2.11-6.73-4.96H1.18v3.15C3.17 21.32 7.23 24 12 24z"
            />

            <path
              fill="#FBBC05"
              d="M5.27 14.24c-.25-.72-.38-1.49-.38-2.24s.13-1.52.38-2.24V6.61H1.18C.43 8.12 0 9.81 0 12s.43 3.88 1.18 5.39l4.09-3.15z"
            />

            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.23 0 3.17 2.68 1.18 6.61l4.09 3.15c.95-2.85 3.6-4.96 6.73-4.96z"
            />
          </svg>

          Continue with Google
        </button>

        {/* =================================================
            SWITCH
        ================================================= */}

        <div
          style={
            styles.switchContainer
          }
        >
          <p
            style={
              styles.switchText
            }
          >
            {isSignup
              ? "Already have an account?"
              : "Don't have an account?"}
          </p>

          <button
            type="button"
            onClick={
              toggleAuthMode
            }
            disabled={loading}
            style={{
              ...styles.switchButton,
              opacity:
                loading ? 0.6 : 1,
            }}
          >
            {isSignup
              ? "Log In"
              : "Sign Up"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   STYLES
========================================================= */

const styles = {
  container: {
    width: "100vw",
    minHeight: "100dvh",
    backgroundColor: "#FBF8F3",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "16px",
    boxSizing: "border-box",
    fontFamily:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },

  card: {
    width: "100%",
    maxWidth: "420px",
    backgroundColor:
      "rgba(255, 255, 255, 0.95)",
    backdropFilter:
      "blur(16px)",
    WebkitBackdropFilter:
      "blur(16px)",
    borderRadius: "28px",
    padding: "32px 24px",
    boxShadow:
      "0 20px 40px rgba(120,70,10,0.08)",
    border:
      "1px solid rgba(245,158,11,0.2)",
    boxSizing: "border-box",
  },

  brandRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "20px",
  },

  coreBadge: {
    width: "36px",
    height: "36px",
    borderRadius: "10px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background:
      "linear-gradient(135deg, #F59E0B, #D97706)",
    boxShadow:
      "0 4px 12px rgba(217,119,6,0.3)",
  },

  brandText: {
    margin: 0,
    fontSize: "18px",
    fontWeight: "800",
    color: "#292524",
  },

  title: {
    fontSize: "26px",
    fontWeight: "800",
    color: "#1C1917",
    margin: "0 0 6px 0",
    letterSpacing: "-0.02em",
  },

  subtitle: {
    fontSize: "13px",
    lineHeight: "1.5",
    color: "#78716C",
    margin: "0 0 20px 0",
  },

  roleTabs: {
    display: "flex",
    backgroundColor: "#F5F2EC",
    borderRadius: "12px",
    padding: "4px",
    marginBottom: "20px",
  },

  roleTab: {
    flex: 1,
    padding: "10px",
    borderRadius: "10px",
    border: "none",
    fontWeight: "700",
    fontSize: "13px",
    cursor: "pointer",
    transition:
      "all 0.2s ease",
  },

  errorBox: {
    backgroundColor: "#FEF2F2",
    color: "#DC2626",
    padding: "10px 14px",
    borderRadius: "10px",
    fontSize: "12px",
    lineHeight: "1.5",
    marginBottom: "16px",
    border:
      "1px solid #FCA5A5",
  },

  form: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
  },

  inputGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    textAlign: "left",
  },

  label: {
    fontSize: "12px",
    fontWeight: "700",
    color: "#57534E",
  },

  input: {
    padding: "12px 14px",
    borderRadius: "12px",
    border:
      "1px solid #E7E5E4",
    backgroundColor: "#FAFAF9",
    fontSize: "14px",
    color: "#1C1917",
    outline: "none",
    transition:
      "border-color 0.2s",
    boxSizing: "border-box",
    width: "100%",
  },

  submitButton: {
    marginTop: "6px",
    backgroundColor: "#D97706",
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: "14px",
    padding: "13px",
    borderRadius: "12px",
    border: "none",
    cursor: "pointer",
    boxShadow:
      "0 6px 16px rgba(217,119,6,0.25)",
    transition:
      "all 0.2s ease",
  },

  divider: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    margin: "18px 0",
    color: "#A8A29E",
    fontSize: "12px",
  },

  dividerLine: {
    flex: 1,
    height: "1px",
    backgroundColor: "#E7E5E4",
  },

  dividerText: {
    padding: "0 10px",
    whiteSpace: "nowrap",
  },

  googleButton: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    color: "#292524",
    fontWeight: "700",
    fontSize: "13px",
    padding: "12px",
    borderRadius: "12px",
    border:
      "1px solid #E7E5E4",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    boxShadow:
      "0 2px 8px rgba(0,0,0,0.04)",
    transition:
      "background-color 0.2s",
  },

  switchContainer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    marginTop: "20px",
  },

  switchText: {
    margin: 0,
    fontSize: "13px",
    color: "#78716C",
  },

  switchButton: {
    background: "none",
    border: "none",
    color: "#D97706",
    fontWeight: "700",
    fontSize: "13px",
    cursor: "pointer",
    padding: 0,
  },
};