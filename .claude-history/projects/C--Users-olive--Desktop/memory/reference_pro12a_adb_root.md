---
name: Pro12-A — adb root works
description: On Hancdon Pro12-A with phh-Treble Pie + Magisk, `adb root` succeeds and gives direct root via adb shell, bypassing the broken Magisk SU prompt
type: reference
originSessionId: 91e27662-5c30-4745-8778-bbf9fd398292
---
On the Hancdon Pro12-A (phh-Treble Pie GSI v123, Magisk 30.7), `adb root` from PowerShell/bash succeeds:

```
> adb root
restarting adbd as root
> adb shell id
uid=0(root) gid=0(root) groups=0(root),... context=u:r:su:s0
```

This works because phh-Treble's GSI is built with `ro.debuggable=1` (userdebug variant), allowing adbd to restart as root.

**This is the recommended way to do root operations on this device** — much more reliable than `su -c X` from adb shell, which hangs indefinitely due to the Magisk SU prompt bug interaction with phh-su.

After `adb root`, all subsequent `adb shell` commands run as uid=0 with full root: can write to /system (after `mount -o remount,rw /system`), /data/adb, /data/local, etc.

To go back to normal: `adb unroot`.

**When to use adb root**:
- Cleaning up Magisk modules without booting them
- Modifying /data/adb/* (post-fs-data.d, service.d, modules)
- Direct /system writes (with remount,rw)
- Recovery operations
