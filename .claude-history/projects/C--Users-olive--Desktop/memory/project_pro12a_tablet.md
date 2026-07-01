---
name: Hancdon Pro12-A Tablet Project
description: Full knowledge base for the Hancdon Pro12-A Chinese spoof tablet - Android 9 Pie phh-Treble + Magisk + VFS-independent bind mounts (/data/app, dalvik-cache, media, gms → /system) + MTK performance unlock. Boot 60s, CPU 1.95 GHz sustained, /system RO, binds RW via `mount -o remount,rw` (no `bind` flag).
type: project
originSessionId: 91e27662-5c30-4745-8778-bbf9fd398292
---
# Hancdon Pro12-A Tablet — Production Configuration

## Hardware (real, unmasked from fraudulent firmware)

- **SoC**: MediaTek MT6755 / Helio P10 (HW code 0x326)
- **CPU**: 8x Cortex-A53 — cluster 0 (cpu0-3) max 1.144 GHz, cluster 1 (cpu4-7) max 1.950 GHz
- **RAM**: 3.92 GB real (was spoofed 16 GB)
- **Storage**: 8 GB eMMC real (was spoofed 512 GB)
- **/data partition**: 771 MB only (hardware allocation)
- **Screen**: 11.6" 60 Hz (was spoofed 120 Hz)
- **Board codename**: `full_k55v1_64` (MediaTek ALPS reference)
- **Kernel**: Linux 3.18.79 (July 2016 build) — HARD LIMIT, cannot upgrade past Android 9 Pie
- **Original firmware**: Android 8.1 Oreo + LZ Spoof System pretending "Android 15"
- **USB PIDs**: 201C/201D (normal+ADB), 0BB4:0C01 (fastboot via HTC VID), 0E8D:2008 (preloader), 0E8D:0003 (BROM)

## Current production state

- **ROM**: phh-Treble Pie v123 `system-A9-v123-gapps-su.img.xz` (arm64 A-only)
- **Root**: Magisk v30.7 — boot.img patched via Magisk Manager app → flashed via fastboot
- **Bootloader**: unlocked via `fastboot oem unlock` (NOT `flashing unlock` — device-specific)
- **SELinux**: Enforcing (intentionally left on — performance scripts don't need setenforce 0)
- **Boot time**: ~60 seconds (from 30+ min before audio HAL fix)

## 🔑 Key technical discoveries

### 1. VFS-independent bind mount RW on kernel 3.18.79

**Correct syntax** (verified empirically on MT6755 kernel 3.18.79):
```bash
mount -o remount,rw /system       # temporarily RW to create sources
mount --bind /system/foo /data/foo # bind (inherits /system RW state)
mount -o remount,ro /system        # /system back to RO (security)
mount -o remount,rw /data/foo      # KEY: NO `bind` flag → modifies VFS only
```

**DO NOT USE**: `mount -o remount,bind,rw /data/foo` — on kernel 3.18, the `bind` flag makes it re-read /system's state (inherits RO). Counter-intuitive but verified.

### 2. Audio HAL fix in /vendor (REQUIRED for fast boot)

MT6755 vendor audio HAL crashes in `EffectLoadXmlEffectConfig+1458 → je_free` when:
- `/vendor/etc/audio_effects.xml` is MISSING → crash
- XML is present but invalid → crash
- `audio.effect@2.0` declared in manifest → framework calls, service crashes

**Fix (persistent in /vendor)**:
1. Remove `<hal>` block for `android.hardware.audio.effect` from `/vendor/manifest.xml` (backup at `.orig`)
2. Create `/vendor/etc/audio_effects.xml` with AOSP default libraries + effects

Without this fix: boot hangs 30-60 min in audio crash loop.
With fix: boot ~60 seconds.

### 3. Magisk safe mode avoidance

**Safe mode triggers**:
- `persist.sys.safemode == 1`
- `bootloop counter > threshold` (stored in `/data/adb/magisk.db`)
- Multiple boot failures in short time

**Consequences**: Magisk auto-creates `disable` file in `/data/adb/modules/*/`, scripts in `post-fs-data.d`/`service.d` skipped.

**Recovery**:
```bash
adb shell rm -f /data/adb/modules/*/disable
adb shell 'magisk --sqlite "DELETE FROM settings WHERE key LIKE \"%bootloop%\""'
adb shell 'resetprop persist.sys.safemode 0'
```

**Prevention**: avoid modules that break boot. Use simple scripts in `post-fs-data.d` directly.

### 4. Critical binds that BREAK Android (do NOT retry)

- **Whole `/data/data`** → zygote SIGABRT (can't read/write encrypted storage skeleton)
- **Whole `/data/user_de`** → vold encryption handling breaks
- **Symlinking `/data/app`** → PackageManager rejects and WIPES content

## Installed persistent scripts

### /data/adb/post-fs-data.d/00_selfheal.sh  ← NEW (anti-safe-mode, runs FIRST)

Runs FIRST, before bind mounts. Guarantees Magisk never enters safe mode:
- Removes all `/data/adb/modules/*/disable` flags
- Resets bootloop counter: `magisk --sqlite "REPLACE INTO settings (key,value) VALUES('bootloop',0);"`
- Forces `persist.sys.safemode=0` and `persist.sys.safemode.disable=1` via resetprop
- Removes `/data/adb/magisk_disable` and `/cache/.disable_magisk` sentinel files
PC master: `C:\Users\olive_\Desktop\Pro12A_Flash\05_Magisk\00_selfheal.sh`

### /data/adb/post-fs-data.d/01_bindmounts.sh

Runs BEFORE Android framework. Applies 4 bind mounts:
- `/data/app` ← `/system/data_app` (APKs, 2GB+ capacity)
- `/data/dalvik-cache` ← `/system/dalvik_cache` (compiled bytecode)
- `/data/media` ← `/system/data_media` (internal sdcard)
- `/data/user_de/0/com.google.android.gms` ← `/system/data_gms` (168 MB GMS data)

Uses VFS-independent RW syntax (no `bind` flag in remount,rw).

### /data/adb/service.d/00_selfheal.sh  ← NEW (second pass anti-safe-mode)

Same as post-fs-data version — double protection in service.d stage.

### /data/adb/service.d/02_performance.sh  ← REWRITTEN (bulletproof)

**Root cause of old failure**: old version used `while [ getprop boot_completed != 1 ]; sleep 2; done` loop which gets stuck indefinitely on kernel 3.18.79. Process sat in hrtimer_nanosleep for 10+ minutes, never applied perf.

**New design**: applies IMMEDIATELY on launch (no waiting), then spawns background daemon (`while true; sleep 30; apply_perf; done &`) that reapplies every 30s forever to counter Android throttle reverts. Animation scales handled by a separate subshell that waits for framework then exits.

Applies:
- Disable MTK PPM policies 2-7 (FORCE_LIMIT, PWR_THRO, THERMAL, DLPT, USER_LIMIT, LCM_OFF)
- Disable MTK HPS hotplug (`/proc/hps/enabled = 0`)
- All 8 CPU cores online (explicit per-core echo, no glob — avoids busybox glob issues)
- CPU governor performance on all cores
- scaling_max_freq = scaling_min_freq = hardware max (lock at top)
  - cpu0-3: 1144000 Hz
  - cpu4-7: 1950000 Hz
- Disable all thermal zones (`thermal_zone*/mode = disabled`)
- eMMC scheduler = deadline, read_ahead_kb = 512
- vm.swappiness = 10
- Animation scales = 0.5 (via Android settings)

### /vendor/etc/audio_effects.xml + /vendor/manifest.xml

Audio HAL fix — SURVIVES `/data` wipe. Backup of original at `/vendor/manifest.xml.orig`.

## Space optimization result

With all 4 binds active:
- /data: 151-220 MB used, 550-620 MB free (20-28% used)
- /data/app (bind to /system): ~2.3 GB free for APKs
- Total effective storage: /data (570 MB) + /system allocated space (2.3+ GB) = ~2.9 GB usable

## Performance result (verified with perf 3-phase)

- CPU at max freq sustained: cpu0-3 @ 1.14 GHz, cpu4-7 @ 1.95 GHz
- All 8 cores online always
- PPM throttling: 6/11 policies disabled
- Boot time: ~60 seconds
- No thermal throttling (disabled)

## Recovery procedures

| Problem | Action |
|---|---|
| Bootloop | Vol+ + Power → fastboot → `fastboot flash boot magisk_patched.img` |
| Zygote SIGABRT | Wipe /data: `fastboot -w` then reboot, Android rebuilds fresh |
| /system corrupt | `fastboot flash system system-A9-v123-gapps-su.img` |
| Tablet dead | Vol+ AND Vol- + USB plug → BROM mode (PID 0003) → mtkclient/SP Flash Tool |
| Audio loop again | Verify `/vendor/manifest.xml` grep audio.effect = 0; recreate `/vendor/etc/audio_effects.xml` |
| Binds lost (Magisk safe mode) | Remove `disable` files, reset bootloop counter (see Section 3) |

## PC-side tools (Windows)

- ADB/fastboot: `C:\Users\olive_\AppData\Local\Android\Sdk\platform-tools\`
- Master scripts (current production versions):
  - `C:\Users\olive_\Desktop\Pro12A_Flash\05_Magisk\00_selfheal.sh` (anti-safe-mode, deploy to both post-fs-data.d AND service.d)
  - `C:\Users\olive_\Desktop\Pro12A_Flash\05_Magisk\01_bindmounts.sh`
  - `C:\Users\olive_\Desktop\Pro12A_Flash\05_Magisk\02_performance.sh` (bulletproof: immediate apply + 30s daemon)
- Flash images:
  - `C:\Users\olive_\Desktop\Pro12A_Flash\03_GSI\system-A9-v123-gapps-su.img` (1.7 GB uncompressed)
  - `C:\Users\olive_\Desktop\Pro12A_Flash\05_Magisk\magisk_patched.img` (patched boot.img)
- Tools:
  - `C:\Users\olive_\Desktop\Pro12A_Flash\01_Tools\Magisk-v30.7.apk`
  - `C:\Users\olive_\Desktop\Pro12A_Flash\01_Tools\SP_Flash_Tool_v5.2152_Win.zip`
  - `C:\Users\olive_\Desktop\Pro12A_Flash\01_Tools\mtkclient\` (BROM via Python)
  - `C:\Users\olive_\Desktop\Pro12A_Flash\01_Tools\UsbDk_1.0.22_x64.msi` (MTK BROM driver)

## Verification commands (health check)

```bash
# CPU at max performance
adb shell 'cat /sys/devices/system/cpu/cpu4/cpufreq/scaling_cur_freq'  # expect 1950000
adb shell 'cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor'  # expect performance

# PPM throttling disabled (should show 6)
adb shell 'cat /proc/ppm/policy_status | grep -c disabled'

# Binds active and RW (should show 4 rw entries)
adb shell 'grep -E "data/app|data/dalvik|data/media|gms" /proc/mounts | grep -c rw'

# /system still RO (security)
adb shell "grep '/system ' /proc/mounts | head -1"

# Audio fix intact (should show 0)
adb shell 'grep -c "audio.effect" /vendor/manifest.xml'
adb shell 'ls /vendor/etc/audio_effects.xml'

# Boot time should be ~60s (not 30 min)
adb shell 'uptime'

# /data usage (should show < 30% used)
adb shell 'df -h /data'
```

## Approaches tested and REJECTED

1. **Android 10/11/12 GSI** — kernel 3.18 too old, audio HAL ABI mismatch
2. **init.rc with `seclabel u:r:su:s0`** — SELinux blocks init→su transition
3. **`setenforce 0` in init.rc** — policy prevents init from toggling
4. **Magisk module overlay for /vendor** — module gets auto-disabled on boot failures
5. **Symlink /data/app → /system/data_app** — PM rejects + wipes
6. **Whole /data/data bind mount** — zygote SIGABRT
7. **mount -o remount,bind,rw** — `bind` flag makes kernel re-inherit /system state on 3.18
8. **fastboot flashing unlock** — this device uses `fastboot oem unlock`

## Play Store / Google apps

- Updated to Play Store v50.6.23 via APKMirror .apkm split install
- Google Play Services 19.6.68 (live on device; updating to 26.x would use 248 MB download)
- WebView, Chrome: standard versions from ROM
- After /data wipe, Play Store reverts to /system stub v17.8.14 — needs re-upgrade via Play Store auto-update

## Magisk notes

- Magisk's `post-fs-data.d` runs with full root + system mount namespace
- Scripts run sequentially, error in one may not halt others
- Safe mode disables ALL modules + ALL post-fs-data/service.d scripts
- Keep scripts SIMPLE and robust — no failures = no safe mode
