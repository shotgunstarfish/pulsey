# Feature: Mobile iOS Port

A native or hybrid iOS application that brings Pulse's full session engine, pattern library, and text-mode UI to iPhone — using the device's own music library for beat detection and communicating with Lovense toys over BLE.

## Motivation

The current Electron app is desktop-only and requires a PC running alongside Lovense Remote. A phone-based version removes that dependency entirely: the user runs one app, connects toys directly over Bluetooth, and plays music from their own library.

## Scope

- Full session engine (all phases, curves, patterns, random events)
- Text-mode display only (no video panel required)
- Device music library as audio source for beat detection
- Direct BLE toy control (no desktop intermediary)
- Persist session history and device preferences on-device

## Investigations

| Topic | File | Status |
|-------|------|--------|
| Ionic React / React Native hybrid app | [ionic-react-native-ios.md](investigations/ionic-react-native-ios.md) | In Progress |
