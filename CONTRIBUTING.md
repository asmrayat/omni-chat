# Contributing

Thanks for helping improve OmniChat.

## Development Setup

1. Load this repository as an unpacked extension from `chrome://extensions`.
2. Make changes directly in the source files.
3. Run `node scripts/validate-extension.js`.
4. Reload the extension in Chrome and test the affected providers.

## Pull Request Checklist

- Keep the extension single-purpose: broadcasting prompts to selected AI chat providers and comparing responses.
- Do not add remotely hosted executable code.
- Request the narrowest permissions possible.
- Update `README.md`, `PRIVACY.md`, or `STORE_REVIEW.md` when behavior or data handling changes.
- Update `CHANGELOG.md` and `manifest.json` for release changes.

## Coding Style

The project intentionally avoids a build step. Use plain JavaScript, HTML, and CSS, and keep provider-specific behavior easy to audit.
