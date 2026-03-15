import { StyleSheet } from 'react-native-unistyles';

// ─── Color Palette ────────────────────────────────────────────────────────────
// From provided palette:
// #30BCED – Bright Sky (primary blue)
// #FFB7C3 – Cherry Blossom (accent pink)
// #F26419 – Blaze Orange (CTA / highlight)
// #E2C044 – Old Gold (warning / badge)
// #F2E2D2 – Almond Cream (background warm)

const palette = {
  brightSky: '#30BCED',
  cherryBlossom: '#FFB7C3',
  blazeOrange: '#F26419',
  oldGold: '#E2C044',
  almondCream: '#F2E2D2',
  white: '#FFFFFF',
  black: '#000000',
  gray50: '#F9FAFB',
  gray100: '#F3F4F6',
  gray200: '#E5E7EB',
  gray400: '#9CA3AF',
  gray600: '#4B5563',
  gray800: '#1F2937',
  gray900: '#111827',
  dark900: '#0F172A',
  dark800: '#1E293B',
  dark700: '#334155',
  dark600: '#475569',
};

const lightTheme = {
  colors: {
    // Brand
    primary: palette.brightSky,
    primaryLight: '#72D4F5',
    primaryDark: '#1A9EC8',
    accent: palette.cherryBlossom,
    cta: palette.blazeOrange,
    badge: palette.oldGold,
    // Backgrounds
    background: palette.white,
    backgroundWarm: palette.almondCream,
    backgroundSecondary: palette.gray50,
    surface: palette.white,
    surfaceSecondary: palette.gray100,
    // Text
    text: palette.gray900,
    textSecondary: palette.gray600,
    textMuted: palette.gray400,
    textInverse: palette.white,
    // UI
    border: palette.gray200,
    divider: palette.gray100,
    tabBar: palette.white,
    tabBarActive: palette.brightSky,
    tabBarInactive: palette.gray400,
    // Status
    success: '#10B981',
    error: '#EF4444',
    warning: palette.oldGold,
    info: palette.brightSky,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
    xxxl: 64,
  },
  radius: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    full: 9999,
  },
  fontSize: {
    xs: 11,
    sm: 13,
    md: 15,
    lg: 17,
    xl: 20,
    xxl: 24,
    xxxl: 30,
    display: 38,
  },
  fontWeight: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
    extrabold: '800' as const,
  },
  shadow: {
    sm: {
      shadowColor: palette.black,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 4,
      elevation: 2,
    },
    md: {
      shadowColor: palette.black,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 12,
      elevation: 5,
    },
    lg: {
      shadowColor: palette.black,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.15,
      shadowRadius: 20,
      elevation: 10,
    },
  },
  gap: (v: number) => v * 8,
};

const darkTheme = {
  colors: {
    // Brand
    primary: palette.brightSky,
    primaryLight: '#72D4F5',
    primaryDark: '#1A9EC8',
    accent: palette.cherryBlossom,
    cta: palette.blazeOrange,
    badge: palette.oldGold,
    // Backgrounds
    background: palette.dark900,
    backgroundWarm: palette.dark800,
    backgroundSecondary: palette.dark800,
    surface: palette.dark800,
    surfaceSecondary: palette.dark700,
    // Text
    text: '#F8FAFC',
    textSecondary: '#94A3B8',
    textMuted: palette.dark600,
    textInverse: palette.gray900,
    // UI
    border: palette.dark700,
    divider: palette.dark700,
    tabBar: palette.dark800,
    tabBarActive: palette.brightSky,
    tabBarInactive: palette.dark600,
    // Status
    success: '#34D399',
    error: '#F87171',
    warning: palette.oldGold,
    info: palette.brightSky,
  },
  spacing: lightTheme.spacing,
  radius: lightTheme.radius,
  fontSize: lightTheme.fontSize,
  fontWeight: lightTheme.fontWeight,
  shadow: {
    sm: {
      shadowColor: palette.black,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.3,
      shadowRadius: 4,
      elevation: 2,
    },
    md: {
      shadowColor: palette.black,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.4,
      shadowRadius: 12,
      elevation: 5,
    },
    lg: {
      shadowColor: palette.black,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.5,
      shadowRadius: 20,
      elevation: 10,
    },
  },
  gap: (v: number) => v * 8,
};

const breakpoints = {
  xs: 0,
  sm: 360,
  md: 576,
  lg: 768,
  xl: 992,
  xxl: 1200,
};

const appThemes = {
  light: lightTheme,
  dark: darkTheme,
};

type AppThemes = typeof appThemes;
type AppBreakpoints = typeof breakpoints;

declare module 'react-native-unistyles' {
  export interface UnistylesThemes extends AppThemes {}
  export interface UnistylesBreakpoints extends AppBreakpoints {}
}

StyleSheet.configure({
  themes: appThemes,
  breakpoints,
  settings: {
    adaptiveThemes: true,
  },
});