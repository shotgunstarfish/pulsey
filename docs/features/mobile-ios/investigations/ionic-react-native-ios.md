# Investigation: Ionic / React Native iOS App

**Feature**: mobile-ios
**Status**: In Progress
**Created**: 2026-03-26

---

## Approach

Build a React Native (or Ionic/Capacitor) iOS app that reuses the entire pure-TypeScript engine layer verbatim and replaces only the platform-specific glue: device communication (HTTP fetch → BLE), audio (Web Audio → AVFoundation), storage (localStorage/IndexedDB → AsyncStorage), and UI components (React DOM → React Native).

### What gets moved as-is (zero changes)

The engine is 100% pure TypeScript with no browser imports:

| File | Lines | Notes |
|------|-------|-------|
| `src/engine/toyPatterns.ts` | 211 | Pure math — all 9 patterns |
| `src/engine/intensityCurves.ts` | 187 | All 6 curves incl. staircase/plateau |
| `src/engine/patternBlock.ts` | 219 | PatternV2 keyframe generator |
| `src/engine/patternPresets.ts` | 465 | Full preset library |
| `src/engine/sessionMachine.ts` | ~400 | Pure useReducer state machine |
| `src/engine/beatDetector.ts` | 60 | Pure FFT math on Uint8Array |
| `src/engine/toyCapabilities.ts` | 174 | Toy metadata |
| `src/engine/randomEvents.ts` | 50 | Event scheduler |
| `src/engine/diceRoll.ts` | 27 | Release probability |
| `src/engine/encouragementText.ts` | — | String arrays |
| `src/devices/DeviceController.ts` | 25 | Interface stays the same |

**~2,200 lines of logic copied unchanged.**

### What gets adapted (~500 lines rewritten, logic unchanged)

#### 1. Lovense device layer

Current: `LovenseDevice.ts` — HTTP POST to Lovense Remote desktop app on `localhost:{port}`.

Mobile replacement: Lovense provides an official **iOS BLE SDK** (Lovense Connect SDK). It handles toy discovery, pairing, and command dispatch natively. The replacement implements the same `DeviceController` interface:

```ts
// Same interface, new implementation
class LovenseBLEDevice implements DeviceController {
  async vibrate(strength: number, toyId?: string) { /* BLE call */ }
  async sendPatternBlock(keyframes, durationMs, toyId?) { /* BLE pattern upload */ }
  // etc.
}
```

The PatternV2 keyframe format (pre-computed 100ms blocks) may need translation to the Lovense Connect SDK's native pattern format, but the generation logic is unchanged.

**Alternative BLE path**: If the Lovense Connect SDK is too restrictive, `react-native-ble-plx` can communicate directly with toys using the documented Lovense BLE GATT characteristic UUIDs. This is more work but gives full control.

#### 2. Audio / beat detection

Current: Web Audio API (`AudioContext`, `AnalyserNode`, `getByteFrequencyData`).

The beat detection math (`beatDetector.ts`) is already pure — it just needs a `Uint8Array` of FFT frequency bins. The question is how to get those bins from the device's music library.

**iOS native path (recommended):**
- `AVAudioEngine` + `AVAudioPlayerNode` for playback
- `AVAudioMixerNode` tap → `vDSP_ctoz` + FFT for frequency bins
- Exposed to React Native via a native module
- `beatDetector.ts` receives the same Uint8Array it does today

**React Native library path:**
- `expo-av` or `react-native-track-player` for music playback
- `react-native-audio-analyzer` or `@react-native-community/audio-toolkit` for FFT
- Less control but faster to ship

**Device music library access:**
- `MPMusicPlayerController` (iOS MediaPlayer framework) — picks songs from the user's Apple Music / local library
- Exposed to RN via a native module or `expo-media-library`
- No streaming/DRM concerns for locally-stored tracks

#### 3. Storage

| Current | Mobile |
|---------|--------|
| `localStorage` (curveRatings, deviceConfig) | `AsyncStorage` or `react-native-mmkv` |
| `IndexedDB` (session history) | SQLite via `expo-sqlite` or `AsyncStorage` |

Session history and device config are small JSON payloads — `AsyncStorage` is sufficient. The video playlist DB is irrelevant (no video on mobile).

#### 4. UI — text-mode session screen

The text-mode `SessionScreen` is a vertical flex stack:

- Phase label + curve name + rating buttons
- Phase progress bar
- Radial gauge (SVG arc around intensity number)
- Event banner
- Encouragement text
- Feeling buttons (1–9) + BEG
- Per-toy panel (name, intensity, pattern, mode toggle)
- Bottom bar (STOP / PAUSE)

React Native can replicate this directly. `RadialGauge.tsx` uses SVG (`react-native-svg`). `EnergyEqualizer` uses a Canvas — `react-native-skia` or `react-native-canvas` works. The feeling buttons, bottom bar, and device panel are plain `TouchableOpacity`/`View` components.

The **video panel is dropped entirely** — iOS builds text-mode only.

**Ionic/Capacitor vs React Native:**
- **Ionic/Capacitor** wraps a WebView — React DOM components work unchanged, Web Audio still works, but BLE requires a Capacitor plugin (`@capacitor-community/bluetooth-le`). Simpler port but worse native feel and BLE reliability.
- **React Native** — native rendering, better BLE/audio integration, requires component rewrite from React DOM → React Native. Recommended for a production-quality app.

---

## Tradeoffs

| Pros | Cons |
|------|------|
| ~2,200 lines of core logic ported unchanged | Lovense Connect SDK integration is undocumented / gated |
| Removes desktop dependency entirely | React Native component rewrite (~1,000 lines) |
| Native BLE = lower latency than HTTP | iOS requires Apple Developer account ($99/yr) + TestFlight to test on device |
| Device music library = no upload needed | `beatDetector.ts` FFT path needs native audio bridge |
| Ionic/Capacitor is faster but more fragile | App Store review may flag adult content category |
| Offline-first, no server required | PatternV2 BLE upload may differ from HTTP API |
| Single codebase (RN) could also target Android | React Native SVG/Canvas adds build complexity |

---

## Alignment

- [x] Follows architectural layering rules — engine stays pure, platform adapters implement the same interfaces
- [x] Developer Experience — Expo Go enables on-device testing without full Xcode build
- [ ] Specification compliance — Lovense Connect BLE SDK terms need review for third-party apps
- [x] Consistent with existing patterns — `DeviceController` interface is already the seam; `useReducer` session machine is React-native-compatible

---

## Evidence

### Engine portability confirmed
All files under `src/engine/` use only: `Math.*`, array operations, and TypeScript types. `localStorage` usage is isolated to `sessionHistory.ts` and `curveRatings.ts` — two small files trivially swapped.

### Lovense device layer
`LovenseDevice.ts` is a thin HTTP wrapper. At ceiling intensity the full command is:
```json
{ "command": "PatternV2", "type": "InitPlay", "actions": [...100 keyframes...], "timeMs": 10000, "stopPrevious": 0, "apiVer": 1 }
```
The Lovense Connect iOS SDK exposes equivalent BLE commands. Community documentation confirms `Vibrate:{level}` maps directly to BLE characteristic writes on the standard Lovense GATT service.

### Ionic/Capacitor BLE plugin
`@capacitor-community/bluetooth-le` provides a Web-compatible BLE API usable from Ionic. This is the fastest migration path — the existing `LovenseDevice.ts` could be lightly adapted. However, Capacitor's BLE plugin has known latency issues (~30–50ms per command vs ~5ms for native BLE), which would degrade PatternV2 block transitions.

### Web Audio → iOS Audio
`useBeatDetection.ts` reads 256 FFT bins via `analyser.getByteFrequencyData(dataArray)`. `beatDetector.ts` sums bins 0–10 (bass range) to produce a bass energy float. This is a trivial FFT operation — `AVAudioEngine`'s `installTap` + Accelerate FFT produces the same array on iOS. React Native bridge overhead (~1–2ms) is acceptable for a 50ms beat-detection tick.

### Alternative approaches worth investigating
1. **Pure Capacitor/Ionic with WebBluetooth** — `navigator.bluetooth` is available in WKWebView on iOS 17+ (behind a feature flag). Could mean zero component rewrite, but Web Bluetooth on iOS is still experimental and unreliable.
2. **Native Swift app** — entirely avoids the JS bridge. The pure-TS engine would be rewritten in Swift using the same mathematical formulas. Higher quality result but doubles the maintenance surface. Swift `Combine` maps naturally to the `useReducer` state machine.
3. **Shared TypeScript monorepo** — Expo + Turborepo with a shared `packages/engine` workspace. Web/Electron and iOS share the engine package; each platform has its own UI and device adapter. This is the architecturally cleanest long-term option.

---

## Verdict

*Pending evaluation*

**Initial assessment**: React Native with Lovense Connect SDK is the strongest path. The ~2,200 lines of pure engine code port unchanged; the platform adaptation surface is well-defined and bounded (~500 lines). The main unknowns are Lovense's third-party SDK access policy and PatternV2 BLE upload support on mobile.

A proof-of-concept scoped to: session engine + mock device + text-mode UI + no audio would take ~1 week and validate the React Native architecture before committing to the BLE and audio integrations.
