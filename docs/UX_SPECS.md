# Aloy — UX & Design System Specifications

**Version:** 2.0.0  
**Design Philosophy:** Cyberpunk High-Tech / Glassmorphism / Ambient Cockpit  
**Target Viewports:** Desktop Electron (1440x900+ / Multi-Monitor) & Mobile React Native (OnePlus 15 / 120Hz OLED)  

---

## 1. Visual Hierarchy & Theme Tokens

Aloy's visual identity blends deep Obsidian space tones with radiant cyan and violet neon accents, frosted glass layers, and animated micro-interactions.

### 1.1 Color Palette

| Token | Hex Value | RGBA Equivalent | Semantic Usage |
| :--- | :--- | :--- | :--- |
| **Space Void** | `#07090e` | `rgba(7, 9, 14, 1.0)` | Root application background |
| **Slate Surface** | `#0f172a` | `rgba(15, 23, 42, 0.75)` | Glassmorphism card surfaces & drawers |
| **Card Border** | — | `rgba(255, 255, 255, 0.08)` | Subdued container outline |
| **Focus Border** | — | `rgba(0, 242, 254, 0.40)` | Active input & focus ring highlight |
| **Aloy Cyan** | `#00f2fe` | `rgba(0, 242, 254, 1.0)` | Primary brand accent, user prompts, active tabs |
| **Athena Violet** | `#8b5cf6` | `rgba(139, 92, 246, 1.0)`| Research dossiers, knowledge synthesis, AI thoughts |
| **Hephaestus Amber**| `#f59e0b` | `rgba(245, 158, 11, 1.0)`| Code forge, build tracking, git work orders |
| **Hermes Emerald** | `#10b981` | `rgba(16, 185, 129, 1.0)`| Finances, positive portfolio deltas, health OK |
| **Minerva Rose** | `#f43f5e` | `rgba(244, 63, 94, 1.0)` | Security gates, 2FA alerts, service outages |

---

## 2. Layout & Spacing System

### 2.1 Desktop Layout Blueprint
```
+---------------------------------------------------------------------------------------------------+
|  [Sidebar: 68px/240px]  |  [Header: Breadcrumbs / Quick Toggles / Search Trigger (Ctrl+K)]         |
|                         |-------------------------------------------------------------------------|
|  * Chat Area            |                                                                         |
|  * Command Palette      |  [Active View Canvas]                                                   |
|  * Media Cast           |  - Chat Timeline & Streaming Voice Waveform                             |
|  * Pantheon Hub         |  - Universal Media Cast Grid & Target Cards                             |
|  * Smart Home           |  - DevWorkspace / Athena Workspace Multi-Panes                         |
|  * Skills / Finances    |  - Real-Time System Telemetry & Jellyfin Player                         |
|                         |                                                                         |
+---------------------------------------------------------------------------------------------------+
```

### 2.2 Standard Padding & Corner Radii
* **App Outer Margin:** `1.5rem` (24px)
* **Card Internal Padding:** `1rem - 1.25rem` (16px - 20px)
* **Pill / Button Corner Radius:** `8px` or `10px`
* **Modal / Card Corner Radius:** `12px` or `16px`
* **Backdrop Blur:** `backdrop-filter: blur(16px)`

---

## 3. Motion & Animation Guidelines

All desktop animations use **Framer Motion spring physics** for realistic weight, instant responsiveness, and zero linear artificiality.

### 3.1 Standard Spring Presets

```javascript
// Floating Modal (Command Palette, Settings, Personas)
export const MODAL_SPRING = {
  type: 'spring',
  damping: 25,
  stiffness: 280,
  mass: 0.9
};

// Slide-over Drawers (Smart Home, History, Projects)
export const DRAWER_SPRING = {
  type: 'spring',
  damping: 30,
  stiffness: 320
};

// Micro-interactions (Button scale, Badges, Tabs)
export const TACTILE_TAP = {
  scale: 0.97,
  transition: { duration: 0.08 }
};
```

### 3.2 Animation Rules
1. **Always wrap conditional overlays with `<AnimatePresence>`**.
2. **Never animate the outer backdrop opacity independently**: Use a crisp dark overlay to prevent rendering tears and compositor lag.
3. **Pulsing Status Dots**: Use CSS keyframe `@keyframes pulse-cyan { 0% { box-shadow: 0 0 0 0 rgba(0, 242, 254, 0.7); } 70% { box-shadow: 0 0 0 8px rgba(0, 242, 254, 0); } }`.

---

## 4. Keyboard Shortcuts & Accessibility

| Shortcut | Scope | Action |
| :--- | :--- | :--- |
| **`Ctrl + K` / `Cmd + K`** | Global | Open Spotlight Command Palette |
| **`Escape`** | Global | Close active modal, palette, or drawer |
| **`Enter ↵`** | Chat Input | Send message / execute selected command |
| **`Shift + Enter ↵`** | Chat Input | Insert newline in prompt textarea |
| **`Arrow Up ↑ / Down ↓`** | Command Palette | Navigate search items |
| **`Ctrl + R`** | Desktop App | Reload renderer window |

---

## 5. Responsive Mobile UX (React Native)

1. **Thumb-Driven Ergonomics:** All primary navigation, tab switches, and prompt actions are placed in the bottom 40% of the screen.
2. **Gesture Dismissal:** Drawers and sub-views support swipe-to-dismiss with native spring velocity tracking.
3. **Haptic Feedback:** Interactive toggles (light switches, lock toggles, playback buttons) trigger subtle haptic ticks (`Haptics.impactAsync(ImpactFeedbackStyle.Light)`).
4. **OLED Dark Optimization:** True `#000000` dark backgrounds save battery on 120Hz AMOLED displays.
