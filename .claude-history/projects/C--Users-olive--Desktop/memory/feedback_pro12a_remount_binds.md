---
name: Pro12-A — every /system remount,ro must restore RW on existing binds
description: Magisk modules that remount /system without re-applying RW to existing /data binds cause zygote bootloop on MT6755 kernel 3.18.79
type: feedback
originSessionId: 91e27662-5c30-4745-8778-bbf9fd398292
---
On the Hancdon Pro12-A (MT6755 kernel 3.18.79) running phh-Treble Pie + Magisk + 4 active VFS-independent bind mounts (/data/app, /data/dalvik-cache, /data/media, /data/user_de/0/com.google.android.gms ← all from /system), **any subsequent script that does `mount -o remount,ro /system` causes the existing binds to inherit RO**. Result: Android can't write app caches in /data/app → zygote crashes → bootloop.

**Why:** The "VFS-independent bind RW" trick on kernel 3.18 means binds must explicitly be remounted RW (no `bind` flag) AFTER the source `/system` is RO. When a later script remounts /system through RW→RO, the binds revert.

**How to apply:** EVERY script (Magisk module post-fs-data.sh, service.sh, manual) that does `mount -o remount,ro /system` MUST be followed immediately by:
```sh
mount -o remount,rw /data/app 2>/dev/null
mount -o remount,rw /data/dalvik-cache 2>/dev/null
mount -o remount,rw /data/media 2>/dev/null
mount -o remount,rw /data/user_de/0/com.google.android.gms 2>/dev/null
```
Or alternatively: don't remount /system to RO at all (leave RW for the remainder of the boot — security tradeoff).

This bit me twice (termuxtosystem v1, then linuxinstaller_v2 + cleanup_termux_v1), bootlooping the device both times. Recovery via `fastboot boot stock_boot.img` triggers Magisk's auto-disable. Always include the bind RW restore in any future module that touches /system.
