---
name: Xiaomi/MIUI scrcpy no control fix
description: scrcpy mirrors but cannot inject input on MIUI/HyperOS — root cause is "USB debugging (Security settings)" toggle. Confirmed signature, fix, and gotchas.
type: reference
originSessionId: 597c27cd-1e03-40d7-a921-7e1af8840661
---
When scrcpy on a Xiaomi/Redmi/POCO (MIUI/HyperOS) device shows video correctly but mouse/keyboard input doesn't reach the phone:

**Confirming signature** — run via the bundled adb (`<scrcpy-folder>\adb.exe shell input tap 500 1000`). If it returns:

```
java.lang.SecurityException: Injecting to another application requires INJECT_EVENTS permission
  at com.android.server.input.InputManagerService.injectInputEventInternal
```

…that is 100% the MIUI security gate. On AOSP the `shell` UID has INJECT_EVENTS by default; MIUI revokes it.

**Fix (must do all of these on the phone):**
1. Mi account signed in (Settings → Mi Account)
2. SIM card physically inserted (yes, required by Xiaomi's check)
3. Wi-Fi or mobile data ON at the moment of toggling
4. Settings → Additional settings → Developer options → enable **"USB debugging (Security settings)"** (separate from normal USB debugging, sits right below it). Prompts for Mi account password and does a ~10s online verification.
5. Reconnect USB cable and re-accept the RSA fingerprint.

**Gotchas:**
- Without SIM, or without Mi account, the toggle silently refuses to enable.
- "Verify apps over USB" should be OFF.
- "Turn on MIUI optimization" sometimes also needs to be OFF for stubborn cases.
- Some apps with FLAG_SECURE (banking, Pix, Google Pay) still block injection even with the toggle on — test on home screen first.

**Known confirmed-working device:** Redmi Note 11 4G (2201117TL, codename `spes`, MIUI V130 / Android 11).
