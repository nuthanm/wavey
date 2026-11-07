export type LegalDoc = 'privacy' | 'terms'

export const LEGAL = {
  privacy: {
    title: 'Privacy Policy',
    updated: 'Nov 7, 2026',
    body: [
      'Wavey processes media URLs you submit so the app can resolve metadata and stream files for personal download. We do not create user accounts or personal profiles.',
      'Submitted URLs are handled by our API to fetch publicly available metadata and media streams. We do not sell your data.',
      'Links and downloads are not stored as a media library. Short-lived signed tokens authorize streaming and expire automatically.',
      'If you grant clipboard access, it is only used when you tap paste. You can deny that permission anytime in your browser settings.',
      'Optional server configuration (such as Instagram session cookies for stories) is controlled by the deployer via environment variables — not collected from end users in the UI.',
      'YouTube, Instagram, and related services are third-party platforms with their own privacy policies. Wavey is not affiliated with Google, YouTube, Meta, or Instagram.',
      'Questions about privacy can be sent to privacy@wavey.app.',
    ],
  },
  terms: {
    title: 'Terms & Conditions',
    updated: 'Nov 7, 2026',
    body: [
      'Wavey is a personal utility for converting and saving media from links you provide. You are solely responsible for how you use downloads. Only save content you own or have explicit rights / permission to keep.',
      'YouTube, Instagram, and other platforms have terms of service that may restrict downloading or redistribution. Respect creators, copyright law, and those platform rules. Do not use Wavey to infringe intellectual property or bypass paywalls / private access controls.',
      'Wavey is an independent open-source project. It is not endorsed by, sponsored by, or affiliated with Google LLC, YouTube, Meta Platforms, Inc., or Instagram.',
      'Instagram stories may require a deployer-configured session cookie and can fail for private, expired, or login-gated content. Public reels are best-effort only.',
      'The software is provided “as is” under the MIT License, without warranty of any kind. Platform changes may break extraction without notice.',
      'We may update these terms. Continued use means you accept the latest version shown in-app.',
    ],
  },
} as const
