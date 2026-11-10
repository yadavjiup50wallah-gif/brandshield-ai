import { hashPassword, verifyPassword } from "../src/lib/brandshield/server/password.ts";
import { isDemoWorkspaceEnabled } from "../src/lib/brandshield/server/seed.ts";
import { DEMO_EMAILS } from "../src/lib/brandshield/shared.ts";
import { getFirebaseConfig } from "../src/lib/brandshield/firebase.ts";

console.log("==================================================");
console.log("RUNNING BRANDSHIELD AI AUTHENTICATION VERIFICATION");
console.log("==================================================");

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    testsPassed++;
  } else {
    console.error(`[FAIL] ${message}`);
    testsFailed++;
  }
}

async function runTests() {
  // Test 1: scrypt hashing and verification
  console.log("\n--- Suite 1: Password Hashing & Scrypt Verification ---");
  const hash = await hashPassword("demo1234");
  assert(hash.startsWith("scrypt$16384$8$1$"), "Generated scrypt hash has correct OWASP parameters");

  const correctVerify = await verifyPassword("demo1234", hash);
  assert(correctVerify.valid === true, "verifyPassword validates 'demo1234' against scrypt hash");
  assert(correctVerify.needsUpgrade === false, "scrypt hash does not need upgrade");

  const wrongVerify = await verifyPassword("wrongpassword", hash);
  assert(wrongVerify.valid === false, "verifyPassword rejects incorrect password");

  // Test 2: Legacy plaintext upgrade compatibility
  console.log("\n--- Suite 2: Legacy Plaintext Migration ---");
  const legacyVerify = await verifyPassword("demo1234", "demo1234");
  assert(legacyVerify.valid === true, "Legacy plaintext password validates correctly");
  assert(legacyVerify.needsUpgrade === true, "Legacy plaintext signals needsUpgrade = true");

  // Test 3: Demo Persona Registry
  console.log("\n--- Suite 3: Demo Personas & Workspace Configuration ---");
  assert(DEMO_EMAILS.has("ava@nimbus.demo"), "Ava Chen is recognized as a demo email");
  assert(DEMO_EMAILS.has("marcus@nimbus.demo"), "Marcus Reed is recognized as a demo email");
  assert(DEMO_EMAILS.has("priya@pixelworks.demo"), "Priya Sharma is recognized as a demo email");
  assert(DEMO_EMAILS.has("elena@nimbus.demo"), "Elena Rodriguez is recognized as a demo email");
  assert(!DEMO_EMAILS.has("realuser@company.com"), "Real users are not recognized as demo emails");

  assert(isDemoWorkspaceEnabled() === true, "Demo workspace is enabled by default");

  // Test 4: Firebase Configuration Parsing
  console.log("\n--- Suite 4: Firebase Config Evaluation ---");
  // In local test environment without NEXT_PUBLIC_FIREBASE_* vars, must evaluate to null (Local mode)
  const localConfig = getFirebaseConfig();
  assert(localConfig === null, "In local dev without Firebase env vars, correctly defaults to null (Local Mode)");

  console.log("\n==================================================");
  console.log(`AUTH VERIFICATION SUMMARY: ${testsPassed} passed, ${testsFailed} failed`);
  console.log("==================================================");

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error("Test execution error:", e);
  process.exit(1);
});
