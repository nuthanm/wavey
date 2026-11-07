# Security policy

## Supported versions

Security fixes are applied on the default branch (`main` / `master`) of this repository.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security-sensitive reports (for example: open proxy abuse, secret leakage, or authentication bypass).

Instead, email the maintainer at the address listed on the GitHub profile for [@nuthanm](https://github.com/nuthanm), or use GitHub’s private vulnerability reporting if enabled on this repository.

Include:

- A clear description of the issue
- Steps to reproduce (minimal)
- Potential impact
- Any suggested fix (optional)

We will acknowledge receipt when possible and work on a fix before any public disclosure.

## Safe configuration

- Never commit `.env.local`, cookies, or API secrets
- Rotate `WAVEY_TOKEN_SECRET` if it may have been exposed
- Treat Instagram / YouTube cookie env vars as highly sensitive credentials
