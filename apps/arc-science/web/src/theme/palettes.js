// Blockprint palettes. Each maps onto HeroUI v3 theme variables through applyPalette.
// Hex only; contrast pairs are checked in contrast.test.js. accent, accent2, success, warning and
// danger are fills (3:1 on background and surface); accentText and accent2Text are the same hues
// tuned for coloured text (4.5:1), equal to the fill where the fill already reads as text.
const BASE_STYLE = {outline: 2, offset: 4};

export const PALETTES = [
  {
    id: 'arc-paper', labelKey: 'palette.arc-paper', scheme: 'light', style: BASE_STYLE,
    colors: {
      background: '#F7F5EF', foreground: '#111111',
      surface: '#FFFDF8', surfaceSecondary: '#EFECE3', surfaceTertiary: '#E6E2D6', overlay: '#FFFFFF',
      muted: '#5A5750', default: '#E6E2D6', defaultForeground: '#111111',
      accent: '#2F5B7A', accentForeground: '#FFFFFF', accent2: '#A78908', accent2Foreground: '#111111',
      success: '#2E6B3F', successForeground: '#FFFFFF', warning: '#A78908', warningForeground: '#111111',
      danger: '#A23D3D', dangerForeground: '#FFFFFF',
      border: '#111111', separator: '#8C887E', focus: '#2F5B7A',
      fieldBackground: '#FFFFFF', fieldForeground: '#111111', ink: '#111111', shadow: '#111111',
      accentText: '#2F5B7A', accent2Text: '#856D06',
    },
  },
  {
    id: 'dark-academy', labelKey: 'palette.dark-academy', scheme: 'dark', style: BASE_STYLE,
    colors: {
      background: '#1B1512', foreground: '#EFE6D2',
      surface: '#251D19', surfaceSecondary: '#2E2520', surfaceTertiary: '#382D27', overlay: '#2A211C',
      muted: '#B8AC94', default: '#3A2F29', defaultForeground: '#EFE6D2',
      accent: '#A45249', accentForeground: '#FFF8EC', accent2: '#C9A227', accent2Foreground: '#1B1512',
      success: '#54715F', successForeground: '#FFF8EC', warning: '#C9A227', warningForeground: '#1B1512',
      danger: '#E07A66', dangerForeground: '#1B1512',
      border: '#EFE6D2', separator: '#6E6252', focus: '#8FBF9F',
      fieldBackground: '#251D19', fieldForeground: '#EFE6D2', ink: '#EFE6D2', shadow: '#C9A227',
      accentText: '#C57065', accent2Text: '#C9A227',
    },
  },
  {
    id: 'forest-novel', labelKey: 'palette.forest-novel', scheme: 'light', style: BASE_STYLE,
    colors: {
      background: '#F2EFE3', foreground: '#1E2A1F',
      surface: '#FBF9F1', surfaceSecondary: '#E9E5D5', surfaceTertiary: '#DFDAC7', overlay: '#FBF9F1',
      muted: '#54604F', default: '#E2DDC9', defaultForeground: '#1E2A1F',
      accent: '#3F6B3A', accentForeground: '#FFFFFF', accent2: '#A3542B', accent2Foreground: '#FFFFFF',
      success: '#2D5F3A', successForeground: '#FFFFFF', warning: '#956F01', warningForeground: '#FFFFFF',
      danger: '#9E2F2F', dangerForeground: '#FFFFFF',
      border: '#1E2A1F', separator: '#848A76', focus: '#3F6B3A',
      fieldBackground: '#FFFFFF', fieldForeground: '#1E2A1F', ink: '#1E2A1F', shadow: '#1E2A1F',
      accentText: '#3F6B3A', accent2Text: '#A3542B',
    },
  },
  {
    id: 'american-20s', labelKey: 'palette.american-20s', scheme: 'light', style: BASE_STYLE,
    colors: {
      background: '#F4EBD9', foreground: '#0E0E0E',
      surface: '#FBF6EC', surfaceSecondary: '#EDE2CC', surfaceTertiary: '#E4D7BD', overlay: '#FBF6EC',
      muted: '#5C5446', default: '#E4D7BD', defaultForeground: '#0E0E0E',
      accent: '#A68124', accentForeground: '#0E0E0E', accent2: '#1F6F5C', accent2Foreground: '#FFFFFF',
      success: '#2E6B3F', successForeground: '#FFFFFF', warning: '#A68124', warningForeground: '#0E0E0E',
      danger: '#9B2226', dangerForeground: '#FFFFFF',
      border: '#0E0E0E', separator: '#8A806C', focus: '#1F6F5C',
      // Fields: a warm white. Pure white stands out from this cream page as a colour of its own.
      fieldBackground: '#FFFCF5', fieldForeground: '#0E0E0E', ink: '#0E0E0E', shadow: '#0E0E0E',
      accentText: '#856401', accent2Text: '#1F6F5C',
    },
  },
  {
    id: 'british-breakfast', labelKey: 'palette.british-breakfast', scheme: 'light', style: BASE_STYLE,
    colors: {
      background: '#FBF7EE', foreground: '#2B1D14',
      surface: '#FFFFFF', surfaceSecondary: '#F3EDE0', surfaceTertiary: '#EAE2D1', overlay: '#FFFFFF',
      muted: '#65554A', default: '#EAE2D1', defaultForeground: '#2B1D14',
      accent: '#2E4A7D', accentForeground: '#FFFFFF', accent2: '#DA720C', accent2Foreground: '#2B1D14',
      success: '#2F6B3A', successForeground: '#FFFFFF', warning: '#DA720C', warningForeground: '#2B1D14',
      danger: '#B3272D', dangerForeground: '#FFFFFF',
      border: '#2B1D14', separator: '#958778', focus: '#2E4A7D',
      fieldBackground: '#FFFFFF', fieldForeground: '#2B1D14', ink: '#2B1D14', shadow: '#2B1D14',
      accentText: '#2E4A7D', accent2Text: '#AE5A05',
    },
  },
  {
    id: 'kyoto', labelKey: 'palette.kyoto', scheme: 'light', style: {outline: 1.5, offset: 0},
    colors: {
      background: '#F5F2EA', foreground: '#1A1A1A',
      surface: '#FBF9F4', surfaceSecondary: '#EEEAE0', surfaceTertiary: '#E5E0D4', overlay: '#FBF9F4',
      muted: '#5E5B55', default: '#E8E4DA', defaultForeground: '#1A1A1A',
      accent: '#D0482E', accentForeground: '#FFFFFF', accent2: '#7A8B4A', accent2Foreground: '#1A1A1A',
      success: '#4F6B2E', successForeground: '#FFFFFF', warning: '#B3821F', warningForeground: '#1A1A1A',
      danger: '#A8321F', dangerForeground: '#FFFFFF',
      border: '#1A1A1A', separator: '#9A968C', focus: '#D0482E',
      fieldBackground: '#FFFFFF', fieldForeground: '#1A1A1A', ink: '#1A1A1A', shadow: '#1A1A1A',
      accentText: '#C53E24', accent2Text: '#647434',
    },
  },
  {
    id: 'riso-lab', labelKey: 'palette.riso-lab', scheme: 'light', style: BASE_STYLE,
    colors: {
      background: '#FAF7F2', foreground: '#1D1D1B',
      surface: '#FFFFFF', surfaceSecondary: '#F2EEE7', surfaceTertiary: '#E9E4DB', overlay: '#FFFFFF',
      muted: '#5C5A55', default: '#ECE7DE', defaultForeground: '#1D1D1B',
      accent: '#F942AB', accentForeground: '#1D1D1B', accent2: '#00838A', accent2Foreground: '#FFFFFF',
      success: '#1F7A4D', successForeground: '#FFFFFF', warning: '#B28701', warningForeground: '#1D1D1B',
      danger: '#C8283A', dangerForeground: '#FFFFFF',
      border: '#1D1D1B', separator: '#98958E', focus: '#00838A',
      fieldBackground: '#FFFFFF', fieldForeground: '#1D1D1B', ink: '#1D1D1B', shadow: '#FF48B0',
      accentText: '#D50D8C', accent2Text: '#057D84',
    },
  },
  {
    id: 'night-shift', labelKey: 'palette.night-shift', scheme: 'dark', style: BASE_STYLE,
    colors: {
      background: '#0B0B0B', foreground: '#FFB000',
      surface: '#15120D', surfaceSecondary: '#1E1911', surfaceTertiary: '#282016', overlay: '#18140E',
      muted: '#C8962E', default: '#2A2217', defaultForeground: '#FFB000',
      accent: '#FFB000', accentForeground: '#0B0B0B', accent2: '#FF7A1A', accent2Foreground: '#0B0B0B',
      success: '#7ACB5A', successForeground: '#0B0B0B', warning: '#FFD24D', warningForeground: '#0B0B0B',
      danger: '#FF5C4D', dangerForeground: '#0B0B0B',
      border: '#FFB000', separator: '#6B4C0E', focus: '#FFF1C9',
      fieldBackground: '#120F0B', fieldForeground: '#FFB000', ink: '#FFB000', shadow: '#7A5200',
      accentText: '#FFB000', accent2Text: '#FF7A1A',
    },
  },
];
