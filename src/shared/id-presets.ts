export interface IdTemplateFrontConfig {
  backgroundColor: string;
  secondaryColor: string;
  accentColor: string;
  textColor: string;
  mutedTextColor: string;
  headerStyle: 'solid' | 'split' | 'minimal' | 'gradient' | 'classic_border';
  fontFamily: 'Plus Jakarta Sans' | 'DM Sans' | 'Georgia' | 'JetBrains Mono';
  orientation: 'portrait' | 'landscape';
  logoPosition: 'left' | 'center' | 'split';
  photoShape: 'rounded' | 'square' | 'circle';
  qrPosition: 'bottom-right' | 'bottom-center' | 'top-right';
  bgFit: 'cover' | 'contain' | 'fill';
  bgZoom: number;
  bgPositionX: number;
  bgPositionY: number;
  bgOverlayOpacity: number;
  showUniversityLogo: boolean;
  showFatherName: boolean;
  showSession: boolean;
  borderStyle: 'none' | 'thin' | 'double' | 'gold';
}

export interface IdTemplateBackConfig {
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  showAddress: boolean;
  showContact: boolean;
  showInstructions: boolean;
  showSignature: boolean;
  showIssueExpiry: boolean;
  showVerificationNote: boolean;
  customHeaderText: string;
  customFooterText: string;
}

export const LOCKED_OFFICIAL_FIELDS = [
  'student_id_code',
  'college_name',
  'college_logo',
  'university_logo',
  'college_roll_number',
  'qr_token',
  'verification_status',
  'issue_date',
  'expiry_date',
] as const;

export interface StarterTemplateDefinition {
  presetKey: string;
  name: string;
  slug: string;
  description: string;
  frontConfig: IdTemplateFrontConfig;
  backConfig: IdTemplateBackConfig;
}

const DEFAULT_BACK_LIGHT: IdTemplateBackConfig = {
  backgroundColor: '#FFFFFF',
  textColor: '#0F172A',
  accentColor: '#1E3A8A',
  showAddress: true,
  showContact: true,
  showInstructions: true,
  showSignature: true,
  showIssueExpiry: true,
  showVerificationNote: true,
  customHeaderText: 'OFFICIAL LIBRARY & CAMPUS IDENTITY',
  customFooterText: 'Powered by QIVORA Verification Registry',
};

const DEFAULT_BACK_DARK: IdTemplateBackConfig = {
  ...DEFAULT_BACK_LIGHT,
  backgroundColor: '#0F172A',
  textColor: '#F8FAFC',
  accentColor: '#3B82F6',
};

export const STARTER_ID_TEMPLATES: StarterTemplateDefinition[] = [
  {
    presetKey: 'classic_university',
    name: 'Classic University',
    slug: 'classic-university',
    description: 'Traditional double-bordered academic credential with crest alignment and timeless typography.',
    frontConfig: {
      backgroundColor: '#FCFBF7',
      secondaryColor: '#1E3A5F',
      accentColor: '#8B6F47',
      textColor: '#1E293B',
      mutedTextColor: '#475569',
      headerStyle: 'classic_border',
      fontFamily: 'Georgia',
      orientation: 'portrait',
      logoPosition: 'split',
      photoShape: 'square',
      qrPosition: 'bottom-right',
      bgFit: 'cover',
      bgZoom: 1,
      bgPositionX: 50,
      bgPositionY: 50,
      bgOverlayOpacity: 0,
      showUniversityLogo: true,
      showFatherName: true,
      showSession: true,
      borderStyle: 'double',
    },
    backConfig: { ...DEFAULT_BACK_LIGHT, backgroundColor: '#FCFBF7', accentColor: '#1E3A5F' },
  },
  {
    presetKey: 'modern_blue',
    name: 'Modern Blue',
    slug: 'modern-blue',
    description: 'Crisp contemporary navy-blue header with structured tabular metadata and sharp readability.',
    frontConfig: {
      backgroundColor: '#FFFFFF',
      secondaryColor: '#1D4ED8',
      accentColor: '#2563EB',
      textColor: '#0F172A',
      mutedTextColor: '#475569',
      headerStyle: 'solid',
      fontFamily: 'Plus Jakarta Sans',
      orientation: 'portrait',
      logoPosition: 'split',
      photoShape: 'rounded',
      qrPosition: 'bottom-right',
      bgFit: 'cover',
      bgZoom: 1,
      bgPositionX: 50,
      bgPositionY: 50,
      bgOverlayOpacity: 0,
      showUniversityLogo: true,
      showFatherName: true,
      showSession: true,
      borderStyle: 'thin',
    },
    backConfig: { ...DEFAULT_BACK_LIGHT, accentColor: '#1D4ED8' },
  },
  {
    presetKey: 'premium_navy',
    name: 'Premium Navy',
    slug: 'premium-navy',
    description: 'Deep Oxford navy executive surface with luminous high-contrast credentials.',
    frontConfig: {
      backgroundColor: '#0F172A',
      secondaryColor: '#1E3A8A',
      accentColor: '#60A5FA',
      textColor: '#F8FAFC',
      mutedTextColor: '#94A3B8',
      headerStyle: 'split',
      fontFamily: 'Plus Jakarta Sans',
      orientation: 'portrait',
      logoPosition: 'split',
      photoShape: 'rounded',
      qrPosition: 'bottom-right',
      bgFit: 'cover',
      bgZoom: 1,
      bgPositionX: 50,
      bgPositionY: 50,
      bgOverlayOpacity: 0.15,
      showUniversityLogo: true,
      showFatherName: true,
      showSession: true,
      borderStyle: 'thin',
    },
    backConfig: DEFAULT_BACK_DARK,
  },
  {
    presetKey: 'minimal_white',
    name: 'Minimal White',
    slug: 'minimal-white',
    description: 'Ultra-clean Swiss gallery card layout prioritizing white space and effortless scanning.',
    frontConfig: {
      backgroundColor: '#FFFFFF',
      secondaryColor: '#F8FAFC',
      accentColor: '#0F172A',
      textColor: '#0F172A',
      mutedTextColor: '#64748B',
      headerStyle: 'minimal',
      fontFamily: 'DM Sans',
      orientation: 'portrait',
      logoPosition: 'left',
      photoShape: 'rounded',
      qrPosition: 'bottom-right',
      bgFit: 'cover',
      bgZoom: 1,
      bgPositionX: 50,
      bgPositionY: 50,
      bgOverlayOpacity: 0,
      showUniversityLogo: true,
      showFatherName: true,
      showSession: true,
      borderStyle: 'thin',
    },
    backConfig: { ...DEFAULT_BACK_LIGHT, accentColor: '#0F172A' },
  },
  {
    presetKey: 'elegant_black',
    name: 'Elegant Black',
    slug: 'elegant-black',
    description: 'Refined obsidian monochrome card with silver hairline accents for postgraduate faculties.',
    frontConfig: {
      backgroundColor: '#111318',
      secondaryColor: '#1E222B',
      accentColor: '#CBD5E1',
      textColor: '#F8FAFC',
      mutedTextColor: '#94A3B8',
      headerStyle: 'minimal',
      fontFamily: 'Plus Jakarta Sans',
      orientation: 'portrait',
      logoPosition: 'split',
      photoShape: 'square',
      qrPosition: 'bottom-right',
      bgFit: 'cover',
      bgZoom: 1,
      bgPositionX: 50,
      bgPositionY: 50,
      bgOverlayOpacity: 0.2,
      showUniversityLogo: true,
      showFatherName: true,
      showSession: true,
      borderStyle: 'thin',
    },
    backConfig: {
      ...DEFAULT_BACK_DARK,
      backgroundColor: '#111318',
      accentColor: '#CBD5E1',
    },
  },
  {
    presetKey: 'modern_gradient',
    name: 'Modern Gradient',
    slug: 'modern-gradient',
    description: 'Subtle slate-to-cobalt institutional gradient banner paired with a bright legible body.',
    frontConfig: {
      backgroundColor: '#FFFFFF',
      secondaryColor: '#0F294A',
      accentColor: '#0284C7',
      textColor: '#0F172A',
      mutedTextColor: '#475569',
      headerStyle: 'gradient',
      fontFamily: 'Plus Jakarta Sans',
      orientation: 'portrait',
      logoPosition: 'split',
      photoShape: 'circle',
      qrPosition: 'bottom-right',
      bgFit: 'cover',
      bgZoom: 1,
      bgPositionX: 50,
      bgPositionY: 50,
      bgOverlayOpacity: 0,
      showUniversityLogo: true,
      showFatherName: true,
      showSession: true,
      borderStyle: 'thin',
    },
    backConfig: { ...DEFAULT_BACK_LIGHT, accentColor: '#0284C7' },
  },
  {
    presetKey: 'corporate_professional',
    name: 'Corporate Professional',
    slug: 'corporate-professional',
    description: 'Structured horizontal-friendly business school credential designed for BBA and MBA programs.',
    frontConfig: {
      backgroundColor: '#F8FAFC',
      secondaryColor: '#1E293B',
      accentColor: '#0F766E',
      textColor: '#0F172A',
      mutedTextColor: '#475569',
      headerStyle: 'solid',
      fontFamily: 'DM Sans',
      orientation: 'portrait',
      logoPosition: 'left',
      photoShape: 'square',
      qrPosition: 'bottom-right',
      bgFit: 'cover',
      bgZoom: 1,
      bgPositionX: 50,
      bgPositionY: 50,
      bgOverlayOpacity: 0,
      showUniversityLogo: true,
      showFatherName: true,
      showSession: true,
      borderStyle: 'thin',
    },
    backConfig: { ...DEFAULT_BACK_LIGHT, backgroundColor: '#F8FAFC', accentColor: '#0F766E' },
  },
  {
    presetKey: 'academic_classic',
    name: 'Academic Classic',
    slug: 'academic-classic',
    description: 'Deep burgundy and ivory collegiate card honoring traditional arts and commerce institutions.',
    frontConfig: {
      backgroundColor: '#FFFDF9',
      secondaryColor: '#7F1D1D',
      accentColor: '#991B1B',
      textColor: '#1C1917',
      mutedTextColor: '#57534E',
      headerStyle: 'classic_border',
      fontFamily: 'Georgia',
      orientation: 'portrait',
      logoPosition: 'split',
      photoShape: 'square',
      qrPosition: 'bottom-right',
      bgFit: 'cover',
      bgZoom: 1,
      bgPositionX: 50,
      bgPositionY: 50,
      bgOverlayOpacity: 0,
      showUniversityLogo: true,
      showFatherName: true,
      showSession: true,
      borderStyle: 'double',
    },
    backConfig: { ...DEFAULT_BACK_LIGHT, backgroundColor: '#FFFDF9', accentColor: '#7F1D1D' },
  },
  {
    presetKey: 'custom_uploaded',
    name: 'Custom Uploaded Template',
    slug: 'custom-uploaded-template',
    description: 'Canvas ready for custom institutional artwork (PNG, JPG, JPEG, WebP) with crop, zoom, and fit controls.',
    frontConfig: {
      backgroundColor: '#FFFFFF',
      secondaryColor: '#1E3A8A',
      accentColor: '#1E3A8A',
      textColor: '#0F172A',
      mutedTextColor: '#334155',
      headerStyle: 'minimal',
      fontFamily: 'Plus Jakarta Sans',
      orientation: 'portrait',
      logoPosition: 'split',
      photoShape: 'rounded',
      qrPosition: 'bottom-right',
      bgFit: 'cover',
      bgZoom: 1,
      bgPositionX: 50,
      bgPositionY: 50,
      bgOverlayOpacity: 0.12,
      showUniversityLogo: true,
      showFatherName: true,
      showSession: true,
      borderStyle: 'thin',
    },
    backConfig: DEFAULT_BACK_LIGHT,
  },
];
