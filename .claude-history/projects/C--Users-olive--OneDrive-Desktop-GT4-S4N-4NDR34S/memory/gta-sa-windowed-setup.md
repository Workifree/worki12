---
name: gta-sa-windowed-setup
description: GTA SA install at Desktop\GT4_S4N_4NDR34S — windowed mode fix details (June 2026)
metadata: 
  node_type: memory
  type: project
  originSessionId: 0c82f835-d7ca-4077-b3e5-23393b5d9ba1
---

GTA San Andreas 1.0 US (14.383.616-byte exe, "By Thirore" repack) at `C:\Users\olive_\OneDrive\Desktop\GT4_S4N_4NDR34S`, played windowed via ThirteenAG's III.VC.SA.WindowedMode v2.1.

**Fixed on 2026-06-06:** game silently exited (~1.3s, exit code 0) on launch with the WindowedMode ASI. Two-part fix: (1) replaced the 2012-era ASI loader with Ultimate ASI Loader v9.7.2 installed as `vorbisFile.dll` (old loader backed up as `vorbisFile.dll.old-2012-loader.bak`; `vorbisHooked.dll` left in place); (2) the actual trigger was a stale video mode in `gta_sa.set` — reset by renaming to `gta_sa.set.bak` in `C:\Users\olive_\OneDrive\Documentos\GTA San Andreas User Files` (Documents is the Portuguese OneDrive "Documentos" folder).

**How to apply:** if the game silently exits again after mod/GPU changes, reset `gta_sa.set` first. Mods (.asi) go in game root or `scripts\`; UAL loads from root, scripts, plugins, update. Alt+Enter cycles window styles; config in `III.VC.SA.WindowedMode.ini`.

**Final setup (user has 2 monitors):** primary 1920x1080 @125% DPI; secondary ultrawide 2560x1080 at physical (1920,-150). Game runs borderless full-ultrawide on monitor 2: WindowedMode ini has mode=2, position 1920/-150, resolution 2560x1080, autoPause=1/autoResume=1. gta_sa.exe has `~ HIGHDPIAWARE` AppCompatFlags layer in HKCU. GTASA.WidescreenFix.asi (ThirteenAG, tag `gtasa`) in `scripts\` for 21:9 FOV/HUD, with `AllowAltTabbingWithoutPausing=1` (game keeps simulating but releases mouse when focus lost — pair with WM autoPause=1, NOT autoPause=0 which makes the game think it's always focused and input bleeds from the other monitor). `mousefix.asi` (2014) disabled as `.off` — WM v2.1 has its own mouse handling; re-enable only if camera stops rotating.

**Dialogue/speech silent (2026-06-06):** user's Realtek "Alto-falantes" device is configured as 7.1 in Windows (device mix format = 8 channels) but physical speakers are stereo — SA routes dialogue to the center channel → conversations/phone calls inaudible while SFX/music play (classic SA surround bug). Fixed with `alsoft.ini` in game root: `[general] channels = stereo` (OpenAL Soft downmixes center into L/R; verified "Stereo rendering" in ALSOFT log). Debug technique: ALSOFT_LOGFILE/ALSOFT_LOGLEVEL=3 + DSOAL_LOGLEVEL env vars; audio session peak metering via IAudioMeterInformation COM interop proved the game was outputting audio all along.

**Audio (2026-06-06):** radio/dialogue streams went silent — known Windows 11 24H2+ issue (RenderWare games need a DirectSound wrapper). Fixed with DSOAL (kcat/dsoal, `latest-master` release → inner zip → Win32): `dsound.dll` + `dsoal-aldrv.dll` in game root. Verified loaded via EnumProcessModulesEx (tasklist /m can't see 32-bit modules). UAL-as-vorbisFile forwards to the original `vorbisHooked.dll` (legacy name convention), so the Rockstar vorbis decoder stays in the chain. Known DSOAL+SA caveat: crash on mounting a motorcycle unless Radio EQ is toggled off/on in-game.

**Key learnings:** WM v2 sets the D3D9 backbuffer to the window client size and rewrites the current RW video mode entry — the game renders natively at window size, so WSF `ResX/ResY` must stay `-1` (disabled). Setting ResX/ResY patches the requested mode at 0x746362 and the mode must exist in the PRIMARY monitor's adapter-0 list (primary tops out at 1920x1080; 2560x1080 only exists on monitor 2) → otherwise "cannot find 800x600x32 video mode" error. Whenever that error appears, also delete `gta_sa.set`.
