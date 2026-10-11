/* Asks Smartcar directly what your application has. No server needed.
   Usage (in the folder with your .env):   node check-smartcar.js            */
require("dotenv").config();

const id = process.env.SMARTCAR_M2M_CLIENT_ID;
const secret =
  process.env.SMARTCAR_M2M_CLIENT_SECRET || process.env.SMARTCAR_CONNECT_CLIENT_SECRET;

(async () => {
  console.log("API client id :", id || "(missing SMARTCAR_M2M_CLIENT_ID)");
  console.log("Secret        :", secret ? `${secret.length} characters` : "(missing)");
  if (!id || !secret) process.exit(1);

  const tokenRes = await fetch("https://iam.smartcar.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
  });
  const token = await tokenRes.json().catch(() => ({}));
  console.log("\n1) Token request:", tokenRes.status, token.access_token ? "OK" : JSON.stringify(token));
  if (!token.access_token) process.exit(1);

  for (const path of [
    "/connections",
    "/connections?filter[mode]=simulated",
    "/connections?filter[mode]=live",
  ]) {
    const r = await fetch(`https://vehicle.api.smartcar.com/v3${path}`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const body = await r.json().catch(() => null);
    const list = body?.data || body?.connections || [];
    console.log(`\n2) GET ${path}  ->  HTTP ${r.status}, ${list.length} connection(s), totalCount=${body?.meta?.totalCount ?? "?"}`);
    for (const c of list.slice(0, 5)) console.log("   ", JSON.stringify(c).slice(0, 300));
  }

  // Optional: node check-smartcar.js <vehicleId> <userId>  -> shows the raw signals
  const [vehicleId, userId] = process.argv.slice(2);

  if (vehicleId && userId) {
    for (const path of [
      `/vehicles/${vehicleId}`,
      `/vehicles/${vehicleId}/signals`,
      `/vehicles/${vehicleId}/signals/tractionbattery-stateofcharge`,
      `/vehicles/${vehicleId}/signals/location-preciselocation`,
    ]) {
      const r = await fetch(`https://vehicle.api.smartcar.com/v3${path}`, {
        headers: { Authorization: `Bearer ${token.access_token}`, "sc-user-id": userId },
      });
      const text = await r.text();
      console.log(`\n3) GET ${path}  ->  HTTP ${r.status}\n   ${text.slice(0, 1800)}`);
    }
  }

  console.log(
    "\nIf every list is empty, Smartcar has NO vehicle for this application:\n" +
      "create one in Dashboard -> Vehicle Simulator (and check the SAME application's\n" +
      "Client ID shown under API Credentials matches SMARTCAR_M2M_CLIENT_ID)."
  );
})().catch((e) => console.error("Failed:", e.message));