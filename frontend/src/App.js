import React, { useCallback, useEffect, useState } from "react";

import SplashScreen from "./screens/SplashScreen";
import OnboardingScreen from "./screens/OnboardingScreen";
import AuthScreen from "./screens/AuthScreen";
import VehicleVerification from "./screens/VehicleVerification";
import PaymentIntegration from "./screens/PaymentIntegration";
import UserDashboard from "./screens/UserDashboard";

import axios from "axios";

/* =========================================================
   CONFIG
========================================================= */

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:5000";

const SESSION_KEY = "trustcharge_session";
const ROLE_KEY = "trustcharge_locked_role";

/* =========================================================
   HELPERS
========================================================= */

function normalizePlate(value) {
  return String(value || "")
    .trim()
    .replace(/[\s-]/g, "")
    .toUpperCase();
}

function normalizeSession(sessionData) {
  if (!sessionData) {
    return null;
  }

  const email = String(
    sessionData.email || ""
  )
    .trim()
    .toLowerCase();

  const role = String(
    sessionData.role || ""
  )
    .trim()
    .toLowerCase();

  const firebaseUid =
    sessionData.firebaseUid ||
    sessionData.uid ||
    sessionData.userId ||
    null;

  if (!email) {
    return null;
  }

  if (
    role !== "user" &&
    role !== "admin"
  ) {
    return null;
  }

  return {
    email,
    role,
    uid: firebaseUid,
    firebaseUid,
    displayName:
      sessionData.displayName ||
      sessionData.name ||
      null,
  };
}

/* =========================================================
   APP
========================================================= */

export default function App() {
  const [step, setStep] =
    useState("splash");

  const [
    checkingSession,
    setCheckingSession,
  ] = useState(true);

  const [
    checkingVehicle,
    setCheckingVehicle,
  ] = useState(false);

  const [
    userSession,
    setUserSession,
  ] = useState(null);

  const [
    lockedRole,
    setLockedRole,
  ] = useState(null);

  const [
    roleConflictError,
    setRoleConflictError,
  ] = useState("");

  const [
    plateInput,
    setPlateInput,
  ] = useState("");

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    errorMessage,
    setErrorMessage,
  ] = useState("");

  const [
    verifiedVehicle,
    setVerifiedVehicle,
  ] = useState(null);

  const [walletBalance, setWalletBalance] = useState(0);

  /* =======================================================
     CLEAN UP THE URL AFTER A MOLLIE REDIRECT BACK
     (the actual payment confirmation always comes from
     /api/payments/status, polled in determineUserStep —
     this just tidies the address bar)
  ======================================================= */

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (params.get("trustcharge_payment") === "return") {
      params.delete("trustcharge_payment");
      params.delete("firebaseUid");

      const remaining = params.toString();

      const cleanedUrl =
        window.location.pathname +
        (remaining ? `?${remaining}` : "") +
        window.location.hash;

      window.history.replaceState({}, "", cleanedUrl);
    }
  }, []);

  /* =======================================================
     LOAD VEHICLE FROM SQLITE
  ======================================================= */

  const loadSavedVehicle = useCallback(
    async (session) => {
      if (!session) {
        return null;
      }

      const firebaseUid =
        session.firebaseUid ||
        session.uid ||
        session.userId;

      if (!firebaseUid) {
        return null;
      }

      try {
        setCheckingVehicle(true);

        const response =
          await axios.get(
            `${API_BASE_URL}/api/vehicles/user/${encodeURIComponent(
              firebaseUid
            )}`,
            {
              timeout: 15000,
            }
          );

        const data = response.data;

        if (
          data?.success === true &&
          data?.exists === true &&
          data?.vehicle &&
          data.vehicle.rdwVerified === true
        ) {
          return data.vehicle;
        }

        return null;
      } catch (error) {
        return null;
      } finally {
        setCheckingVehicle(false);
      }
    },
    []
  );

  /* =======================================================
     LOAD WALLET / MOLLIE PAYMENT STATUS
  ======================================================= */

  const loadWalletStatus = useCallback(async (session) => {
    if (!session) {
      return null;
    }

    const firebaseUid =
      session.firebaseUid || session.uid || session.userId;

    if (!firebaseUid) {
      return null;
    }

    try {
      const response = await axios.get(
        `${API_BASE_URL}/api/payments/status/${encodeURIComponent(
          firebaseUid
        )}`,
        { timeout: 15000 }
      );

      const data = response.data;

      if (data?.success && data?.wallet) {
        return data.wallet;
      }

      return null;
    } catch (error) {
      return null;
    }
  }, []);

  /* =======================================================
     DETERMINE USER DESTINATION
  ======================================================= */

  const determineUserStep =
    useCallback(
      async (session) => {
        if (!session) {
          setStep("onboarding");
          return;
        }

        if (session.role === "admin") {
          setVerifiedVehicle(null);
          setStep("app");
          return;
        }

        if (session.role === "user") {
          const firebaseUid =
            session.firebaseUid ||
            session.uid ||
            session.userId;

          if (!firebaseUid) {
            setVerifiedVehicle(null);
            setPlateInput("");
            setErrorMessage(
              "Your Firebase account ID is missing. Please sign out and sign in again."
            );
            setStep("auth");
            return;
          }

          const vehicle =
            await loadSavedVehicle(session);

          if (vehicle) {
            setVerifiedVehicle(vehicle);
            setErrorMessage("");

            // A verified vehicle isn't enough on its own — a returning
            // user who never completed (or abandoned) the Mollie
            // membership checkout is sent back to the payment step
            // instead of straight to the dashboard.
            const wallet = await loadWalletStatus(session);

            if (wallet?.paid) {
              setWalletBalance(wallet.balance || 0);
              setStep("app");
            } else {
              setStep("payment");
            }
          } else {
            setVerifiedVehicle(null);
            setPlateInput("");
            setErrorMessage("");
            setStep("verify");
          }

          return;
        }

        setStep("auth");
      },
      [loadSavedVehicle, loadWalletStatus]
    );

  /* =======================================================
     RESTORE SESSION ON APP START
  ======================================================= */

  useEffect(() => {
    let mounted = true;

    async function restoreSession() {
      try {
        const savedSession =
          localStorage.getItem(
            SESSION_KEY
          );

        const savedLockedRole =
          localStorage.getItem(
            ROLE_KEY
          );

        if (
          savedLockedRole === "admin" ||
          savedLockedRole === "user"
        ) {
          if (mounted) {
            setLockedRole(
              savedLockedRole
            );
          }
        }

        if (!savedSession) {
          if (mounted) {
            setUserSession(null);
            setVerifiedVehicle(null);
          }

          return;
        }

        let parsedSession;

        try {
          parsedSession =
            JSON.parse(savedSession);
        } catch (parseError) {
          localStorage.removeItem(
            SESSION_KEY
          );

          localStorage.removeItem(
            ROLE_KEY
          );

          if (mounted) {
            setUserSession(null);
            setLockedRole(null);
            setVerifiedVehicle(null);
          }

          return;
        }

        const restoredSession =
          normalizeSession(
            parsedSession
          );

        if (!restoredSession) {
          localStorage.removeItem(
            SESSION_KEY
          );

          localStorage.removeItem(
            ROLE_KEY
          );

          if (mounted) {
            setUserSession(null);
            setLockedRole(null);
            setVerifiedVehicle(null);
          }

          return;
        }

        if (
          restoredSession.role === "user" &&
          !restoredSession.firebaseUid
        ) {
          localStorage.removeItem(
            SESSION_KEY
          );

          if (mounted) {
            setUserSession(null);
            setVerifiedVehicle(null);
            setErrorMessage("");
            setStep("auth");
          }

          return;
        }

        if (!mounted) {
          return;
        }

        setUserSession(
          restoredSession
        );

        setLockedRole(
          restoredSession.role
        );

        localStorage.setItem(
          SESSION_KEY,
          JSON.stringify(
            restoredSession
          )
        );

        localStorage.setItem(
          ROLE_KEY,
          restoredSession.role
        );

        if (
          restoredSession.role ===
          "admin"
        ) {
          setVerifiedVehicle(null);
          setStep("app");
        } else {
          await determineUserStep(
            restoredSession
          );
        }
      } catch (error) {
        localStorage.removeItem(
          SESSION_KEY
        );

        localStorage.removeItem(
          ROLE_KEY
        );

        if (mounted) {
          setUserSession(null);
          setLockedRole(null);
          setVerifiedVehicle(null);
          setStep("onboarding");
        }
      } finally {
        if (mounted) {
          setCheckingSession(false);
        }
      }
    }

    restoreSession();

    return () => {
      mounted = false;
    };
  }, [determineUserStep]);

  /* =======================================================
     REAL RDW VERIFICATION
  ======================================================= */

  const handleVerifySubmit =
    async (e) => {
      e.preventDefault();

      const cleanPlate =
        normalizePlate(
          plateInput
        );

      if (!cleanPlate) {
        setErrorMessage(
          "Enter a Netherlands license plate."
        );

        return;
      }

      if (
        !userSession?.email
      ) {
        setErrorMessage(
          "Your login session has expired. Please sign in again."
        );

        return;
      }

      const firebaseUid =
        userSession.firebaseUid ||
        userSession.uid ||
        userSession.userId;

      if (!firebaseUid) {
        setErrorMessage(
          "Your Firebase account ID is missing. Please sign out and sign in again."
        );

        return;
      }

      setLoading(true);
      setErrorMessage("");

      try {
        const rdwResponse =
          await axios.get(
            `${API_BASE_URL}/api/verify-plate`,
            {
              params: {
                plate: cleanPlate,
              },
              timeout: 20000,
            }
          );

        const rdwData =
          rdwResponse.data;

        if (
          rdwData?.success !== true ||
          rdwData?.verified !== true ||
          !rdwData?.vehicle
        ) {
          setErrorMessage(
            `Plate ${cleanPlate} was not found in the live RDW Netherlands registry.`
          );

          return;
        }

        const rdwVehicle = {
          ...rdwData.vehicle,

          plate:
            rdwData.vehicle.plate ||
            rdwData.plate ||
            cleanPlate,

          rdwVerified: true,

          source:
            rdwData.vehicle.source ||
            rdwData.source ||
            "RDW Netherlands",

          verifiedAt:
            rdwData.vehicle.verifiedAt ||
            new Date().toISOString(),
        };

        if (
          rdwVehicle.rdwVerified !== true
        ) {
          setErrorMessage(
            "Vehicle verification failed because the RDW confirmation was invalid."
          );

          return;
        }

        const saveResponse =
          await axios.post(
            `${API_BASE_URL}/api/vehicles/verify-and-save`,
            {
              firebaseUid,
              email:
                userSession.email,
              plate: cleanPlate,
            },
            {
              timeout: 20000,
            }
          );

        const saveData =
          saveResponse.data;

        if (
          saveData?.success !== true ||
          saveData?.verified !== true ||
          saveData?.saved !== true ||
          !saveData?.vehicle
        ) {
          setErrorMessage(
            saveData?.error ||
              "The vehicle was verified by RDW but could not be saved to your TrustCharge account."
          );

          return;
        }

        if (
          saveData.vehicle
            .rdwVerified !== true
        ) {
          setErrorMessage(
            "The saved vehicle did not contain valid RDW verification."
          );

          return;
        }

        const savedVehicle = {
          ...saveData.vehicle,
          plate:
            saveData.vehicle.plate ||
            cleanPlate,
          rdwVerified: true,
          source:
            saveData.vehicle.source ||
            "RDW Netherlands",
        };

        setVerifiedVehicle(
          savedVehicle
        );

        setPlateInput("");
        setErrorMessage("");

        // Transition to payment step after successful RDW verification
        setStep("payment");
      } catch (error) {
        if (!error.response) {
          if (
            error.code ===
            "ECONNABORTED"
          ) {
            setErrorMessage(
              "RDW verification timed out. Please check your connection and try again."
            );
          } else {
            setErrorMessage(
              "Cannot connect to the TrustCharge backend. Make sure the backend is running on port 5000."
            );
          }

          return;
        }

        if (
          error.response.status ===
          404
        ) {
          setErrorMessage(
            "TrustCharge RDW verification endpoint was not found. Check that the backend is running on port 5000."
          );

          return;
        }

        setErrorMessage(
          error.response?.data
            ?.error ||
            error.response?.data
              ?.message ||
            "Live RDW vehicle verification failed. Please check the Netherlands license plate and try again."
        );
      } finally {
        setLoading(false);
      }
    };

  /* =======================================================
     LOGOUT
  ======================================================= */

  const handleLogout =
    () => {
      localStorage.removeItem(
        SESSION_KEY
      );

      localStorage.removeItem(
        ROLE_KEY
      );

      setUserSession(null);
      setLockedRole(null);
      setVerifiedVehicle(null);
      setPlateInput("");
      setLoading(false);
      setErrorMessage("");
      setRoleConflictError("");

      setStep("auth");
    };

  /* =======================================================
     INITIAL LOADING
  ================================================       */

  if (checkingSession) {
    return (
      <div
        style={{
          minHeight: "100dvh",
          width: "100%",
          background:
            "linear-gradient(135deg,#090D16,#111827)",
          color: "#FFFFFF",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        }}
      >
        <div
          style={{
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: "44px",
              marginBottom: "14px",
            }}
          >
            ⚡
          </div>

          <div
            style={{
              width: "42px",
              height: "42px",
              border:
                "3px solid rgba(255,255,255,.15)",
              borderTop:
                "3px solid #FF7A00",
              borderRadius:
                "50%",
              margin:
                "0 auto 14px",
              animation:
                "trustchargeSpin .8s linear infinite",
            }}
          />

          <p
            style={{
              margin: 0,
              color: "#94A3B8",
              fontSize: "13px",
            }}
          >
            Loading TrustCharge...
          </p>

          <style>
            {`
              @keyframes trustchargeSpin {
                from {
                  transform: rotate(0deg);
                }
                to {
                  transform: rotate(360deg);
                }
              }
            `}
          </style>
        </div>
      </div>
    );
  }

  /* =======================================================
     SPLASH / LOGO
  ======================================================= */

  if (step === "splash") {
    return (
      <SplashScreen
        onDone={() => {
          if (!userSession) {
            setStep("onboarding");
            return;
          }

          determineUserStep(
            userSession
          );
        }}
      />
    );
  }

  /* =======================================================
     ONBOARDING
  ================================================       */

  if (step === "onboarding") {
    return (
      <OnboardingScreen
        onFinish={() => {
          setRoleConflictError("");
          setErrorMessage("");
          setPlateInput("");

          setStep("auth");
        }}
      />
    );
  }

  /* =======================================================
     AUTHENTICATION
  ================================================       */

  if (step === "auth") {
    return (
      <AuthScreen
        activeSession={
          userSession
        }

        lockedRole={
          lockedRole
        }

        roleConflictError={
          roleConflictError
        }

        onAuthSuccess={
          async (sessionData) => {
            if (
              !sessionData ||
              !sessionData.email ||
              !sessionData.role
            ) {
              setRoleConflictError(
                "Invalid login information. Please try again."
              );

              return;
            }

            const firebaseUid =
              sessionData.firebaseUid ||
              sessionData.uid ||
              sessionData.userId ||
              null;

            const requestedRole =
              String(
                sessionData.role
              )
                .trim()
                .toLowerCase();

            if (
              requestedRole !==
                "admin" &&
              requestedRole !==
                "user"
            ) {
              setRoleConflictError(
                "Invalid account role."
              );

              return;
            }

            if (
              requestedRole ===
                "user" &&
              !firebaseUid
            ) {
              setRoleConflictError(
                "Your Firebase account ID is missing. Please sign out and sign in again."
              );

              return;
            }

            const storedLockedRole =
              localStorage.getItem(
                ROLE_KEY
              );

            const currentLockedRole =
              lockedRole ||
              storedLockedRole;

            if (
              currentLockedRole &&
              currentLockedRole !==
                requestedRole
            ) {
              setRoleConflictError(
                `Access Denied: This session is locked to ${currentLockedRole.toUpperCase()} access.`
              );

              return;
            }

            const newSession = {
              email:
                String(
                  sessionData.email
                )
                  .trim()
                  .toLowerCase(),

              role:
                requestedRole,

              uid:
                firebaseUid,

              firebaseUid:
                firebaseUid,

              displayName:
                sessionData.displayName ||
                sessionData.name ||
                null,
            };

            setUserSession(
              newSession
            );

            setLockedRole(
              requestedRole
            );

            localStorage.setItem(
              ROLE_KEY,
              requestedRole
            );

            localStorage.setItem(
              SESSION_KEY,
              JSON.stringify(
                newSession
              )
            );

            setRoleConflictError("");
            setErrorMessage("");

            if (
              requestedRole ===
              "admin"
            ) {
              setVerifiedVehicle(
                null
              );

              setStep("app");

              return;
            }

            setCheckingVehicle(true);

            try {
              const vehicle =
                await loadSavedVehicle(
                  newSession
                );

              if (vehicle) {
                setVerifiedVehicle(
                  vehicle
                );

                setPlateInput("");
                setErrorMessage("");
                setStep("app");
              } else {
                setVerifiedVehicle(
                  null
                );

                setPlateInput("");
                setErrorMessage("");
                setStep("verify");
              }
            } finally {
              setCheckingVehicle(false);
            }
          }
        }
      />
    );
  }

  /* =======================================================
     VEHICLE VERIFICATION
  ================================================       */

  if (step === "verify") {
    if (
      !userSession ||
      userSession.role !==
        "user"
    ) {
      return (
        <AuthScreen
          activeSession={
            userSession
          }

          lockedRole={
            lockedRole
          }

          roleConflictError={
            roleConflictError
          }

          onAuthSuccess={
            async (
              sessionData
            ) => {
              const firebaseUid =
                sessionData?.firebaseUid ||
                sessionData?.uid ||
                sessionData?.userId ||
                null;

              if (
                !firebaseUid
              ) {
                setRoleConflictError(
                  "Your Firebase account ID is missing. Please sign out and sign in again."
                );

                return;
              }

              const session =
                normalizeSession({
                  ...sessionData,
                  uid:
                    firebaseUid,
                  firebaseUid,
                  role: "user",
                });

              if (!session) {
                setRoleConflictError(
                  "Invalid account session."
                );

                return;
              }

              setUserSession(
                session
              );

              setLockedRole(
                "user"
              );

              localStorage.setItem(
                SESSION_KEY,
                JSON.stringify(
                  session
                )
              );

              localStorage.setItem(
                ROLE_KEY,
                "user"
              );

              await determineUserStep(
                session
              );
            }
          }
        />
      );
    }

    return (
      <VehicleVerification
        plateInput={
          plateInput
        }

        setPlateInput={
          setPlateInput
        }

        onVerifySubmit={
          handleVerifySubmit
        }

        loading={
          loading
        }

        errorMessage={
          errorMessage
        }

        currentUser={
          userSession
        }
      />
    );
  }

  /* =======================================================
     PAYMENT / MEMBERSHIP PASS SELECTION STEP
  ======================================================= */

  if (step === "payment") {
    return (
      <PaymentIntegration
        currentUser={userSession}
        apiBaseUrl={API_BASE_URL}
        onBack={() => setStep("verify")}
      />
    );
  }

  /* =======================================================
     DASHBOARD
  ======================================================= */

  if (step === "app") {
    if (
      userSession?.role ===
      "admin"
    ) {
      return (
        <UserDashboard
          user={
            userSession
          }

          verifiedVehicle={
            null
          }

          apiBaseUrl={
            API_BASE_URL
          }

          onLogout={
            handleLogout
          }
        />
      );
    }

    if (
      userSession?.role ===
        "user" &&
      !verifiedVehicle
    ) {
      return (
        <VehicleVerification
          plateInput={
            plateInput
          }

          setPlateInput={
            setPlateInput
          }

          onVerifySubmit={
            handleVerifySubmit
          }

          loading={
            loading
          }

          errorMessage={
            errorMessage
          }

          currentUser={
            userSession
          }
        />
      );
    }

    return (
      <UserDashboard
        user={
          userSession
        }

        verifiedVehicle={
          verifiedVehicle
        }

        walletBalance={walletBalance}

        apiBaseUrl={
          API_BASE_URL
        }

        onLogout={
          handleLogout
        }
      />
    );
  }

  return null;
}